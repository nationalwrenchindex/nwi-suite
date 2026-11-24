import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/fetch-all'

/**
 * The NEXT number an HD shop's invoices, quotes and work orders get (Settings >
 * Document numbers). Brock, Nov 24, 2026: a new shop should not have to tell its
 * customers it is their first job, so INV-2026-0001 can become INV-2026-2847.
 *
 * WHERE THE NUMBERS COME FROM
 *   invoices    hd_document_counters 'hd_invoice', taken by the hd_invoices trigger (186)
 *   quotes      hd_document_counters 'hd_quote',   taken by the hd_quotes trigger   (186)
 *   work orders the highest WO-YYYY-NNNN the account holds + 1 (lib/work-order-number),
 *               and never below the 'hd_work_order' FLOOR row this sets (migration 193)
 *
 * Every row is per account (user_id). The sequence runs across years: it does not
 * reset in January.
 *
 * FORWARD ONLY. The value must be above the highest number already issued on that
 * account for that type - an existing document's number, or a number the counter has
 * already handed out (a deleted invoice still used its number). Setting it changes
 * only the counter row: no document is renumbered or re-saved, and the format
 * (prefix, year, four-digit padding) is unchanged.
 *
 * The counter table is closed to the browser keys, so this runs with the service
 * client, always scoped to the signed-in user's id by the caller.
 */

export type HdDocKind = 'hd_invoice' | 'hd_quote' | 'hd_work_order'

export const HD_DOC_KINDS: readonly HdDocKind[] = ['hd_invoice', 'hd_quote', 'hd_work_order']

export const NEXT_NUMBER_MIN = 1
export const NEXT_NUMBER_MAX = 9999

const SPEC: Record<HdDocKind, { table: string; column: string; prefix: string; noun: string }> = {
  hd_invoice:    { table: 'hd_invoices',    column: 'invoice_number',    prefix: 'INV', noun: 'invoice' },
  hd_quote:      { table: 'hd_quotes',      column: 'quote_number',      prefix: 'Q',   noun: 'quote' },
  hd_work_order: { table: 'hd_work_orders', column: 'work_order_number', prefix: 'WO',  noun: 'work order' },
}

export function docNoun(kind: HdDocKind): string { return SPEC[kind].noun }
export function docPrefix(kind: HdDocKind): string { return SPEC[kind].prefix }

export function isHdDocKind(v: unknown): v is HdDocKind {
  return typeof v === 'string' && (HD_DOC_KINDS as readonly string[]).includes(v)
}

/** "0184" - the four-digit padding every HD number prints with. */
export function padNumber(n: number): string {
  return String(n).padStart(4, '0')
}

/** INV-2026-0184 */
export function formatDocNumber(kind: HdDocKind, year: number, n: number): string {
  return `${SPEC[kind].prefix}-${year}-${padNumber(n)}`
}

/** The highest PREFIX-YYYY-NNNN among `numbers`, across all years. Other shapes are not in the sequence. */
export function highestIssued(kind: HdDocKind, numbers: ReadonlyArray<string | null | undefined>): { n: number; number: string } | null {
  const re = new RegExp(`^${SPEC[kind].prefix}-\\d{4}-(\\d+)$`)
  let best: { n: number; number: string } | null = null
  for (const raw of numbers) {
    const s = String(raw ?? '').trim()
    const m = re.exec(s)
    if (!m) continue
    const n = Number(m[1])
    if (!best || n > best.n) best = { n, number: s }
  }
  return best
}

export interface DocNumberState {
  kind: HdDocKind
  /** The highest number on an existing document, and that document's number as printed. */
  highest: { n: number; number: string } | null
  /** hd_document_counters.last_number, or null when the account has no row yet. */
  counter: number | null
  /** The number the next document of this type will get. */
  next: number
}

export function stateFrom(kind: HdDocKind, numbers: ReadonlyArray<string | null | undefined>, counter: number | null): DocNumberState {
  const highest = highestIssued(kind, numbers)
  return { kind, highest, counter, next: Math.max(highest?.n ?? 0, counter ?? 0) + 1 }
}

/** A typed value as a whole number 1-9999, or the reason it is not one. "0184" is 184. */
export function parseNextNumber(raw: unknown): { ok: true; n: number } | { ok: false; error: string } {
  const s = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : ''
  if (!/^\d{1,4}$/.test(s)) return { ok: false, error: `Enter a whole number from ${NEXT_NUMBER_MIN} to ${NEXT_NUMBER_MAX}.` }
  const n = Number(s)
  if (n < NEXT_NUMBER_MIN || n > NEXT_NUMBER_MAX) return { ok: false, error: `Enter a whole number from ${NEXT_NUMBER_MIN} to ${NEXT_NUMBER_MAX}.` }
  return { ok: true, n }
}

/**
 * Forward only. Refuses a value at or below the highest number already issued and names
 * that document. A value equal to the current next number is accepted (it changes nothing).
 */
export function checkNextNumber(state: DocNumberState, next: number): { ok: true } | { ok: false; error: string } {
  const { highest, counter, kind } = state
  if (highest && next <= highest.n) {
    return { ok: false, error: `You have already issued ${highest.number}. The next number must be ${highest.n + 1} or higher.` }
  }
  if (counter != null && next <= counter) {
    return {
      ok: false,
      error: `Your next ${SPEC[kind].noun} number is already ${padNumber(counter + 1)}. Numbers only move forward: the next number must be ${counter + 1} or higher.`,
    }
  }
  return { ok: true }
}

async function readCounter(svc: SupabaseClient, userId: string, kind: HdDocKind): Promise<number | null> {
  const { data, error } = await svc
    .from('hd_document_counters')
    .select('last_number')
    .eq('user_id', userId)
    .eq('doc_type', kind)
    .maybeSingle()
  if (error) throw new Error(`counter read failed: ${error.message}`)
  return data ? Number((data as { last_number: unknown }).last_number) : null
}

async function readNumbers(svc: SupabaseClient, userId: string, kind: HdDocKind): Promise<string[]> {
  const { table, column, prefix } = SPEC[kind]
  const rows = await fetchAllRows<Record<string, unknown>>((from, to) =>
    svc.from(table).select(column).eq('user_id', userId).like(column, `${prefix}-%`).order('id').range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: PostgrestError | null }>)
  return rows.map(r => String(r[column] ?? ''))
}

export async function readDocNumberState(svc: SupabaseClient, userId: string, kind: HdDocKind): Promise<DocNumberState> {
  const [numbers, counter] = await Promise.all([readNumbers(svc, userId, kind), readCounter(svc, userId, kind)])
  return stateFrom(kind, numbers, counter)
}

/**
 * The work order floor: the 'hd_work_order' counter row, or 0 when there is none (or
 * migration 193 is not applied, so no row can exist). Never throws - a failed read
 * numbers exactly as it did before the setting existed, and says so in the log.
 */
export async function readWorkOrderFloor(svc: SupabaseClient, userId: string): Promise<number> {
  try {
    return (await readCounter(svc, userId, 'hd_work_order')) ?? 0
  } catch (e) {
    console.error('[document-number-start] work order floor read failed - numbering from existing work orders only:', e)
    return 0
  }
}

export type SetNextResult =
  | { ok: true; state: DocNumberState }
  | { ok: false; status: number; error: string }

/** Raise the account's counter so the next `kind` document gets `next`. Forward only. */
export async function setNextDocNumber(svc: SupabaseClient, userId: string, kind: HdDocKind, raw: unknown): Promise<SetNextResult> {
  const parsed = parseNextNumber(raw)
  if (!parsed.ok) return { ok: false, status: 422, error: parsed.error }
  const next = parsed.n

  const before = await readDocNumberState(svc, userId, kind)
  const check = checkNextNumber(before, next)
  if (!check.ok) return { ok: false, status: 422, error: check.error }
  if (next === before.next) return { ok: true, state: before }

  const last = next - 1
  const ins = await svc.from('hd_document_counters').insert({ user_id: userId, doc_type: kind, last_number: last })
  if (ins.error) {
    const code = String(ins.error.code ?? '')
    if (code === '23514' && kind === 'hd_work_order') {
      return { ok: false, status: 503, error: 'Setting the next work order number needs migration 193, which is not applied yet. Nothing was saved.' }
    }
    if (code !== '23505') return { ok: false, status: 500, error: ins.error.message }
    // The account has a row: raise it, and only if it is still below - a document
    // issued while this saved must never be pushed back under.
    const upd = await svc
      .from('hd_document_counters')
      .update({ last_number: last, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('doc_type', kind)
      .lt('last_number', last)
      .select('last_number')
    if (upd.error) return { ok: false, status: 500, error: upd.error.message }
    if (!upd.data || upd.data.length === 0) {
      const now = await readDocNumberState(svc, userId, kind)
      if (now.counter !== last) {
        const again = checkNextNumber(now, next)
        return { ok: false, status: 409, error: again.ok ? 'The number changed while saving. Reload and try again.' : again.error }
      }
    }
  }
  return { ok: true, state: await readDocNumberState(svc, userId, kind) }
}
