import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  MAX_WORK_ORDER_LINES,
  normalizeLine,
  sumLines,
  type WorkOrderLineInput,
} from '@/lib/hd/work-order-lines'

import { allocateForWorkOrder, partLinesFromRows } from '@/lib/inventory/ledger'
import { isJobStatus, isMissingJobsSchema, type WorkOrderJob } from '@/lib/hd/work-order-jobs'
import { LINE_SELECT, loadLinesAndJobs } from '@/lib/hd/work-order-jobs-load'
import { isMissingRepairItemColumn, isUuid, usableCardIds, withoutRepairItem } from '@/lib/hd/labor-card-link'

export const dynamic = 'force-dynamic'

// Line items on an HD work order (migration 120), grouped into jobs (migration 177).
//
// RLS already scopes these rows to the owner of the parent work order, but every
// handler re-checks ownership explicitly so a missing row and someone else's row
// both answer 404 — a 403 would confirm the id exists.

// Either half is spelled with the other key optional-undefined so `if (gate.error)`
// narrows to the client in the success branch without a cast.
type Gate =
  | { error: NextResponse; supabase?: undefined; userId?: undefined }
  // userId is carried out of the gate because the allocation below needs it and the
  // gate has already fetched the user. Re-reading it would be a second round trip to
  // learn something this function just proved.
  | { error?: undefined; supabase: Awaited<ReturnType<typeof createClient>>; userId: string }

type Supabase = Awaited<ReturnType<typeof createClient>>

// Shared ownership gate. Returns an authed client scoped to the caller, or a
// response to hand straight back.
async function requireOwnedWorkOrder(workOrderId: string): Promise<Gate> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: wo } = await supabase
    .from('hd_work_orders')
    .select('id')
    .eq('id', workOrderId)
    .eq('user_id', user.id)
    .single()
  if (!wo) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }

  return { supabase, userId: user.id }
}

const totalsOf = (lines: Array<Record<string, unknown>>) =>
  sumLines(lines as unknown as Parameters<typeof sumLines>[0])

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workOrderId } = await params
  const gate = await requireOwnedWorkOrder(workOrderId)
  if (gate.error) return gate.error

  // The jobs come with the lines. Before migration 177, jobs is [] and has_jobs false,
  // and the card shows one job holding every line, as the work order always was.
  const { lines, jobs, hasJobs, error } = await loadLinesAndJobs(gate.supabase, workOrderId)

  if (error) {
    console.error('[hd/work-orders/line-items GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ line_items: lines, jobs, has_jobs: hasJobs, totals: totalsOf(lines) })
}

// PUT replaces the whole set rather than patching rows.
//
// The editor is a spreadsheet-style card where the tech reorders and deletes rows
// freely, so a per-row diff would need the client to track which ids it removed and
// send three request kinds. Replacing the set makes the sent array the truth, which
// is also what makes reordering work at all — sort_order is positional.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workOrderId } = await params
  const gate = await requireOwnedWorkOrder(workOrderId)
  if (gate.error) return gate.error
  const supabase = gate.supabase

  // AN INVOICED WORK ORDER'S LINES ARE LOCKED - on the server, not only on the screen
  // (WorkOrderDetail's canEdit). Its lines are what the invoice billed; changing them
  // under it leaves the two disagreeing with nothing to say so. Reopen the work order
  // (back to completed), correct the lines, then refresh the invoice from it.
  const { data: woStatus } = await supabase.from('hd_work_orders').select('status').eq('id', workOrderId).maybeSingle()
  if (String(woStatus?.status ?? '') === 'invoiced') {
    return NextResponse.json({
      error: 'This work order is invoiced, so its lines are locked. Reopen it to correct them, then refresh the invoice from it.',
      reason: 'invoiced',
    }, { status: 409 })
  }

  let body: { line_items?: unknown; jobs?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const raw = body.line_items
  if (!Array.isArray(raw)) return NextResponse.json({ error: 'line_items array required' }, { status: 400 })
  if (raw.length > MAX_WORK_ORDER_LINES) {
    return NextResponse.json({ error: `Too many line items (max ${MAX_WORK_ORDER_LINES})` }, { status: 400 })
  }

  // JOBS. The card sends its jobs beside the lines, and each line names its job by
  // number. A job is a grouping only: normalizeLine prices every line exactly as it
  // always has, and nothing here touches an amount.
  //
  // A client that sends no jobs (a page loaded before this change) gets every line on
  // the work order's first job, which is what the work order was before jobs existed.
  const sentJobs = parseJobs(body.jobs)
  if (sentJobs && 'error' in sentJobs) return NextResponse.json({ error: sentJobs.error }, { status: 400 })
  const jobNumbers = new Set((sentJobs ?? []).map(j => j.job_number))

  // Position in the sent array IS the sort order, so the tech's arrangement survives
  // the round trip without the client inventing index numbers.
  const rows: Array<Record<string, unknown>> = []
  const lineJob: number[] = []
  for (let i = 0; i < raw.length; i++) {
    const line = normalizeLine(raw[i] as WorkOrderLineInput, i)
    // A row with no usable type is a client bug, not something to silently drop —
    // dropping it would lose a billable line without telling anyone.
    if (!line) return NextResponse.json({ error: `Line ${i + 1}: type must be "labor" or "part"` }, { status: 400 })
    const n = Number((raw[i] as { job_number?: unknown }).job_number ?? 1)
    if (sentJobs && !jobNumbers.has(n)) {
      return NextResponse.json({ error: `Line ${i + 1} names job ${n}, which is not on this work order.` }, { status: 400 })
    }
    rows.push({ ...line, work_order_id: workOrderId })
    lineJob.push(sentJobs ? n : 1)
  }

  // The jobs, written before the lines so each line can point at its job's id.
  const jobIds = await writeJobs(supabase, workOrderId, gate.userId, sentJobs)
  if ('error' in jobIds) return NextResponse.json({ error: jobIds.error }, { status: jobIds.status })
  const ids = jobIds.ids
  if (ids) rows.forEach((r, i) => { r.job_id = ids.get(lineJob[i]) ?? null })

  // THE LABOR CARD each labor line came from (migration 187). Kept only when it is a
  // card this shop may use - its own or the catalog's; anything else is stored as no
  // card, never refused (lib/hd/labor-card-link).
  const sentCards = raw.map(r => (r as { repair_item_id?: unknown } | null)?.repair_item_id)
  const usable = await usableCardIds(supabase, gate.userId, sentCards)
  rows.forEach((r, i) => {
    const c = sentCards[i]
    r.repair_item_id = r.type === 'labor' && isUuid(c) && usable.has(c) ? c : null
  })

  // Delete-then-insert. Supabase's REST client has no multi-statement transaction, so
  // the window between the two is real: a failed insert leaves the set empty. The
  // insert is checked and reported rather than swallowed so the tech re-saves from a
  // form that still holds their rows, instead of discovering the loss later.
  const { error: delError } = await supabase
    .from('hd_work_order_line_items')
    .delete()
    .eq('work_order_id', workOrderId)

  if (delError) {
    console.error('[hd/work-orders/line-items PUT delete]', delError)
    return NextResponse.json({ error: delError.message }, { status: 500 })
  }

  let lines: Array<Record<string, unknown>> = []
  if (rows.length > 0) {
    const base = ids ? `${LINE_SELECT}, job_id` : LINE_SELECT
    const insert = (rs: Array<Record<string, unknown>>, sel: string) => supabase
      .from('hd_work_order_line_items')
      .insert(rs)
      .select(sel)
      .order('sort_order', { ascending: true })
    let { data, error } = await insert(rows, `${base}, repair_item_id`)
    // Before 187: the same lines, without the card. Nothing else changes.
    if (error && isMissingRepairItemColumn(error)) ({ data, error } = await insert(withoutRepairItem(rows), base))

    if (error) {
      console.error('[hd/work-orders/line-items PUT insert]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    lines = (data ?? []) as unknown as Array<Record<string, unknown>>
  }

  // Jobs the card no longer has, now that no line points at them.
  if (ids && sentJobs) await dropUnsentJobs(supabase, workOrderId, sentJobs)
  const jobs = ids ? (await loadLinesAndJobs(supabase, workOrderId)).jobs : []

  if (lines.length === 0) return NextResponse.json({ line_items: [], jobs, has_jobs: !!ids, totals: totalsOf([]) })

  // ------------------------------------------------------------ ALLOCATE
  //
  // THE SAME SHARED FUNCTION the LD work-order PATCH calls. HD keeps its lines in their
  // own table rather than a JSONB column, so only the reader differs -
  // partLinesFromRows instead of partLinesFromJson. Everything past that point is one
  // implementation, which is what stops the two products disagreeing about what is
  // committed to a job.
  //
  // Allocated, not deducted: on_hand does not move until the invoice exists.
  try {
    await allocateForWorkOrder({
      userId:      gate.userId,
      kind:        'hd',
      workOrderId: workOrderId,
      lines:       partLinesFromRows(lines),
    })
  } catch (err: unknown) {
    console.error('[hd/work-orders/line-items PUT] allocation failed, lines still saved:',
      err instanceof Error ? err.message : String(err))
  }

  return NextResponse.json({ line_items: lines, jobs, has_jobs: !!ids, totals: totalsOf(lines) })
}

/** The jobs the card sent, checked. null when it sent none (an older page). */
function parseJobs(v: unknown): WorkOrderJob[] | { error: string } | null {
  if (v === undefined || v === null) return null
  if (!Array.isArray(v) || v.length === 0) return { error: 'jobs must be a non-empty array' }
  const out: WorkOrderJob[] = []
  for (const j of v as Array<Record<string, unknown>>) {
    const n = Number(j.job_number)
    if (!Number.isInteger(n) || n < 1) return { error: 'Every job needs a whole job number of 1 or more.' }
    if (out.some(o => o.job_number === n)) return { error: `Job ${n} is listed twice.` }
    const description = typeof j.description === 'string' && j.description.trim() ? j.description.trim() : null
    out.push({ job_number: n, description, status: isJobStatus(j.status) ? j.status : 'open' })
  }
  return out
}

/**
 * Upsert the sent jobs (or, when none were sent, make sure a first job exists) and
 * return job_number -> id. `ids` is null when migration 177 is not applied: the lines
 * then save exactly as before, and more than one job - or a job description - is
 * refused rather than silently flattened into one.
 */
async function writeJobs(
  supabase: Supabase, workOrderId: string, userId: string, sent: WorkOrderJob[] | null,
): Promise<{ ids: Map<number, string> | null } | { error: string; status: number }> {
  const existing = await supabase
    .from('hd_work_order_jobs')
    .select('id, job_number')
    .eq('work_order_id', workOrderId)
  if (existing.error) {
    if (!isMissingJobsSchema(existing.error)) return { error: existing.error.message, status: 500 }
    if (sent && (sent.length > 1 || sent[0].description)) {
      return { error: 'Separate jobs need migration 177, which is not applied yet. Apply it, then save again. Nothing was saved.', status: 409 }
    }
    return { ids: null }
  }
  // No jobs sent: keep whatever jobs exist and put the lines on the first one.
  const have = [...(existing.data ?? [])].sort((a, b) => Number(a.job_number) - Number(b.job_number))
  if (!sent && have.length > 0) return { ids: new Map([[1, String(have[0].id)]]) }

  const want = sent ?? [{ job_number: 1, description: null, status: 'open' as const }]
  const { data, error } = await supabase
    .from('hd_work_order_jobs')
    .upsert(want.map(j => ({
      work_order_id: workOrderId, user_id: userId, job_number: j.job_number,
      description: j.description, status: j.status, updated_at: new Date().toISOString(),
    })), { onConflict: 'work_order_id,job_number' })
    .select('id, job_number')
  if (error) return { error: error.message, status: 500 }
  return { ids: new Map((data ?? []).map(r => [Number(r.job_number), String(r.id)])) }
}

/** Delete the jobs the card did not send. Runs after the lines, so none points at them. */
async function dropUnsentJobs(supabase: Supabase, workOrderId: string, sent: WorkOrderJob[]): Promise<void> {
  const { error } = await supabase
    .from('hd_work_order_jobs')
    .delete()
    .eq('work_order_id', workOrderId)
    .not('job_number', 'in', `(${sent.map(j => j.job_number).join(',')})`)
  if (error) console.error('[hd/work-orders/line-items PUT] could not drop removed jobs:', error.message)
}
