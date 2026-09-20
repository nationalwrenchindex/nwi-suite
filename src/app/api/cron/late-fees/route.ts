import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendSmsResult } from '@/lib/twilio'
import { getContactSuppression } from '@/lib/customer-contact'
import { authorizeCron } from '@/lib/cron-auth'
import { fetchAllRows } from '@/lib/supabase/fetch-all'

export const dynamic = 'force-dynamic'

// Paging multiplies this sweep's round trips — a tenant past the 1,000-row cap now
// costs several sequential requests per table where it used to cost one. The default
// function timeout is short enough that a large fleet could be cut off mid-sweep, which
// would reintroduce the skipped-rows bug through the back door. 60s matches the other
// long-running crons (see api/directory-agent/*).
export const maxDuration = 60

// PostgREST answers 200 with at most 1,000 rows, so an unpaged sweep quietly
// stops charging late fees on every invoice past the cap. Both loads below page.
const PAGE_SIZE = 500

// An `.in()` list rides in the query string; once the settings load is unbounded
// the tech list can outgrow the URL, so it goes out in batches.
const IN_CHUNK = 200

type Row = Record<string, unknown>

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// ─── GET /api/cron/late-fees ─────────────────────────────────────────────────
// Runs daily at 9am (see vercel.json). Applies a late fee to overdue HD invoices
// for techs who have an active late_fee_settings row. Gated by CRON_SECRET.
export async function GET(request: NextRequest) {
  const denied = authorizeCron(request)
  if (denied) return denied

  const supabase = createServiceClient()
  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000

  // 1. Techs with an active late-fee configuration.
  //    `.order('id')` is load-bearing: range paging an unordered query can repeat
  //    or skip rows, and a skipped tech is a tech whose invoices go unfee'd.
  let settingsList: Row[]
  try {
    settingsList = await fetchAllRows<Row>(
      (from, to) => supabase
        .from('late_fee_settings')
        .select('*')
        .eq('active', true)
        .order('id', { ascending: true })
        .range(from, to),
      PAGE_SIZE,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'settings load failed'
    console.error('[late-fees] settings load failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  if (settingsList.length === 0) {
    return NextResponse.json({ processed: 0, applied: 0, smsSent: 0 })
  }

  const settingsMap = new Map(settingsList.map(s => [s.user_id as string, s]))
  const userIds = [...settingsMap.keys()]

  // 2. Candidate invoices: sent/overdue, not yet fee'd, with a due date, for those techs.
  const invoices: Row[] = []
  try {
    for (const ids of chunk(userIds, IN_CHUNK)) {
      const page = await fetchAllRows<Row>(
        (from, to) => supabase
          .from('hd_invoices')
          .select('id, invoice_number, user_id, customer_phone, total, subtotal_parts, line_items, due_date, status, late_fee_applied, customer_id')
          .in('user_id', ids)
          .in('status', ['sent', 'overdue'])
          .eq('late_fee_applied', false)
          .not('due_date', 'is', null)
          .order('id', { ascending: true })
          .range(from, to),
        PAGE_SIZE,
      )
      invoices.push(...page)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invoice load failed'
    console.error('[late-fees] invoice load failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  if (invoices.length === 0) {
    return NextResponse.json({ processed: 0, applied: 0, smsSent: 0 })
  }

  // 3. Tech display names for the SMS. A failure here is logged and tolerated —
  //    it only costs the SMS its greeting, and the fees themselves are still owed.
  const nameMap = new Map<string, string>()
  try {
    for (const ids of chunk(userIds, IN_CHUNK)) {
      const profiles = await fetchAllRows<Row>(
        (from, to) => supabase
          .from('profiles')
          .select('id, hd_tech_name, business_name, full_name')
          .in('id', ids)
          .order('id', { ascending: true })
          .range(from, to),
        PAGE_SIZE,
      )
      for (const p of profiles) {
        nameMap.set(p.id as string,
          (p.hd_tech_name as string) || (p.business_name as string) || (p.full_name as string) || 'your mechanic')
      }
    }
  } catch (err) {
    console.error('[late-fees] profile load failed:', err instanceof Error ? err.message : err)
  }

  let applied = 0, smsSent = 0

  for (const inv of invoices) {
    const settings = settingsMap.get(inv.user_id as string)
    if (!settings) continue

    const dueMs   = Date.parse(`${inv.due_date}T00:00:00Z`)
    if (Number.isNaN(dueMs)) continue
    const graceMs = ((settings.grace_period_days as number) ?? 0) * DAY
    if (now <= dueMs + graceMs) continue // still within grace period

    const daysOverdue = Math.max(1, Math.floor((now - dueMs) / DAY))
    const invTotal    = Number(inv.total ?? 0)

    // 4. Calculate the fee.
    let fee = settings.fee_type === 'percentage'
      ? invTotal * (Number(settings.percentage_rate ?? 0) / 100)
      : Number(settings.flat_fee_amount ?? 0)
    fee = Math.round(fee * 100) / 100
    if (fee <= 0) continue

    // 5. Append a line item and update the invoice totals + late-fee tracking.
    const items = Array.isArray(inv.line_items) ? [...inv.line_items] : []
    items.push({
      id: `late-fee-${inv.id}`,
      type: 'parts',
      description: `Late Fee — ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue`,
      part_number: '',
      quantity: 1,
      unit_cost: fee,
      amount: fee,
    })

    const { error: updErr } = await supabase
      .from('hd_invoices')
      .update({
        line_items:         items,
        subtotal_parts:     Math.round((Number(inv.subtotal_parts ?? 0) + fee) * 100) / 100,
        total:              Math.round((invTotal + fee) * 100) / 100,
        late_fee_applied:   true,
        late_fee_amount:    fee,
        // Record the rate this fee was actually computed from (migration 130). The
        // manual "Resend with Late Fee" path writes it too, so a fee can be explained
        // months later even if late_fee_settings has moved since. Null on a flat fee,
        // where a percentage would be a fiction.
        late_fee_percentage: settings.fee_type === 'percentage'
          ? Number(settings.percentage_rate ?? 0)
          : null,
        late_fee_applied_at: new Date().toISOString(),
        status:             'overdue',
        updated_at:         new Date().toISOString(),
      })
      .eq('id', inv.id)
      .eq('user_id', inv.user_id)

    if (updErr) {
      console.error(`[late-fees] update failed for ${inv.id}:`, updErr.message)
      continue
    }
    applied++

    // 6. Optional SMS to the customer.
    // The late fee is still applied to the invoice — the money is owed either way.
    // Only the notification is suppressed, because that is what the customer opted
    // out of. Suppressing the fee itself would let an opt-out cancel a charge.
    const suppressed = (await getContactSuppression(supabase, inv.customer_id as string | null)).no_sms

    if (settings.send_sms_notification !== false && inv.customer_phone && !suppressed) {
      const techName = nameMap.get(inv.user_id as string) ?? 'your mechanic'
      const body =
        `Invoice #${inv.invoice_number} from ${techName} is overdue. ` +
        `A late fee of $${fee.toFixed(2)} has been applied. ` +
        `Please remit payment at your earliest convenience. Thank you.`
      const result = await sendSmsResult({ to: inv.customer_phone as string, body })
      if (result.success) smsSent++
      else console.error(`[late-fees] SMS failed for ${inv.id}: ${result.error}`)
    }
  }

  console.log(`[late-fees] done: processed=${invoices.length} applied=${applied} smsSent=${smsSent}`)
  return NextResponse.json({ processed: invoices.length, applied, smsSent })
}
