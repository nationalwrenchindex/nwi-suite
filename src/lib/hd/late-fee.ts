// Shared late-fee calculator for HD invoices.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
// There are two paths that can charge a late fee: the nightly cron at
// src/app/api/cron/late-fees/route.ts, and the tech pressing "Resend with Late
// Fee" on the invoice detail page. The invoice page ALSO has to display the fee
// before it is charged, so the tech knows what they are about to add.
//
// Three call sites, one number. If the screen says $47.25 and the resend charges
// $94.50, or if the cron and the manual button disagree about whether an invoice
// is even late, the tech has no defensible answer for the customer. So the
// settings lookup, the eligibility rules and the arithmetic all live here, and
// every caller asks this module rather than reimplementing it.
//
// ── ONE SOURCE OF CONFIGURATION ──────────────────────────────────────────────
// The rate, the fee type and the grace period come from `late_fee_settings`
// (migration 078) — the same table the cron reads and the same table
// src/components/hd/LateFeeSettingsForm.tsx writes. No second column, no second
// table, no hard-coded per-invoice override. The only value this module supplies
// on its own is the fallback used when a tech has never configured anything, and
// that fallback is the table's own DEFAULTs, not a competing opinion.
//
// ── THE FALLBACK, AND WHY IT DIFFERS FROM THE CRON ───────────────────────────
// `late_fee_settings` currently has zero rows, which is why the cron has never
// fired: it selects `.eq('active', true)` and finds nothing, so no invoice is
// ever touched. That is correct for an automatic job — nobody should wake up to
// discover a robot has been charging their customers interest they never
// switched on.
//
// A tech clicking "Resend with Late Fee" has switched it on, explicitly, for
// that one invoice. So this module resolves a missing settings row to the
// documented default (1.5% per month, no grace period) rather than refusing.
// The distinction is consent, not arithmetic: the fee is computed identically
// either way, and the moment a tech saves real settings both paths read them.

import type { SupabaseClient } from '@supabase/supabase-js'

export type LateFeeType = 'flat' | 'percentage'

export interface LateFeeSettings {
  graceDays:      number
  feeType:        LateFeeType
  flatFeeAmount:  number
  percentageRate: number
  /** Master switch from the settings row. True for the fallback. */
  active:         boolean
  /** True when no settings row existed and DEFAULT_LATE_FEE_SETTINGS was used. */
  isDefault:      boolean
}

/**
 * The fallback configuration, mirroring the DEFAULTs on `late_fee_settings` in
 * migration 078 so that saving the settings form without changing anything
 * produces exactly this.
 */
export const DEFAULT_LATE_FEE_SETTINGS: LateFeeSettings = {
  graceDays:      0,
  feeType:        'percentage',
  flatFeeAmount:  25,
  percentageRate: 1.5,
  active:         true,
  isDefault:      true,
}

/** Statuses that can carry a late fee. Kept identical to the cron's filter. */
const CHARGEABLE_STATUSES = ['sent', 'overdue'] as const

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Why a fee is not available. Rendered to the tech verbatim rather than the
 * button silently doing nothing — "why can't I charge this?" is a question the
 * UI should be able to answer.
 */
export type LateFeeBlockReason =
  | 'paid'
  | 'void'
  | 'partial'
  | 'not_sent'
  | 'no_due_date'
  | 'already_applied'
  | 'not_yet_due'
  | 'within_grace'
  | 'zero_fee'
  | null

export interface LateFeeAssessment {
  /** Past the due date at all, grace period ignored. Drives the OVERDUE badge. */
  isOverdue:   boolean
  /** Whole days past due_date, floor, minimum 1 once overdue. 0 when not overdue. */
  daysOverdue: number
  /** The fee in dollars, already rounded to cents. 0 when no fee can be charged. */
  feeAmount:   number
  /** The monthly rate used, or null for a flat fee. Stored on the invoice. */
  percentage:  number | null
  /** Days of grace after the due date, from settings. */
  graceDays:   number
  /** True only when a fee can actually be charged right now. */
  chargeable:  boolean
  /** Populated whenever chargeable is false. */
  reason:      LateFeeBlockReason
}

export interface LateFeeInvoice {
  id?:                string
  status?:            string | null
  total?:             number | string | null
  due_date?:          string | null
  late_fee_applied?:  boolean | null
}

/** A line item in `hd_invoices.line_items` (JSONB array — there is no line-items table). */
export interface LateFeeLineItem {
  id:          string
  type:        'parts'
  description: string
  part_number: string
  quantity:    number
  unit_cost:   number
  amount:      number
}

function toNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
  return fallback
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * The tech's late-fee configuration, or the documented default when they have
 * never saved any. Never throws: a settings read that fails falls back rather
 * than blocking the invoice page from rendering.
 *
 * `active: false` is preserved rather than swallowed — a tech who deliberately
 * switched the engine off should not find the manual button charging fees anyway.
 */
export async function resolveLateFeeSettings(
  client: SupabaseClient,
  userId: string,
): Promise<LateFeeSettings> {
  const { data, error } = await client
    .from('late_fee_settings')
    .select('grace_period_days, fee_type, flat_fee_amount, percentage_rate, active')
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !data) {
    if (error) {
      console.error('[late-fee] settings read failed, using defaults:', error.message)
    }
    return { ...DEFAULT_LATE_FEE_SETTINGS }
  }

  return {
    graceDays:      Math.max(0, Math.round(toNumber(data.grace_period_days, DEFAULT_LATE_FEE_SETTINGS.graceDays))),
    feeType:        data.fee_type === 'flat' ? 'flat' : 'percentage',
    flatFeeAmount:  toNumber(data.flat_fee_amount, DEFAULT_LATE_FEE_SETTINGS.flatFeeAmount),
    percentageRate: toNumber(data.percentage_rate, DEFAULT_LATE_FEE_SETTINGS.percentageRate),
    active:         data.active !== false,
    isDefault:      false,
  }
}

/**
 * Is this invoice late, and what would the fee be?
 *
 * ── THE RATE IS PER MONTH. THE CHARGE IS ONE MONTH. ──────────────────────────
 * `percentage_rate` is a MONTHLY rate — the settings form labels it "Monthly
 * Rate (% of invoice total)" — and the default is the industry-standard 1.5% per
 * month. So a partial month has to resolve one way or the other, and the answer
 * here is WHOLE MONTHS, ROUNDED UP: one day past due and past grace charges a
 * full month's 1.5%, exactly as a card issuer or a net-terms supplier bills it.
 * Pro-rating by the day was the alternative and is rejected because it makes the
 * fee on a bill that is two days late a rounding artifact (~$3 on a $3,000
 * invoice) — too small to change a customer's behaviour, which is the entire
 * point of a late fee, and too fiddly to explain over the phone.
 *
 * And the charge is capped at ONE month, because `late_fee_applied` is a boolean,
 * not an accrual ledger. Both paths refuse an invoice that already carries a fee
 * — the cron via `.eq('late_fee_applied', false)`, this module via the
 * 'already_applied' reason — so no invoice can ever be charged twice, and
 * months 2, 3 and 4 are never billed by either path. That is a deliberate
 * limitation of the 078 schema and NOT something to "fix" on one side only:
 * genuine multi-month accrual needs a per-period fee ledger, and it would have to
 * land in the cron and here in the same change or the two paths would start
 * quoting different totals for the same invoice.
 *
 * ── THE BASE IS `total` ──────────────────────────────────────────────────────
 * "Outstanding balance" and `total` are the same number here: hd_invoices records
 * no paid-to-date amount, so a fee can only be computed against the invoice
 * total. That is also why 'partial' is refused below rather than charged — with
 * no record of what was paid, 1.5% of the full total would overcharge a customer
 * who has already sent most of the money.
 */
export function assessLateFee(
  invoice:  LateFeeInvoice,
  settings: LateFeeSettings,
  now:      Date = new Date(),
): LateFeeAssessment {
  const graceDays = settings.graceDays
  const blocked = (reason: LateFeeBlockReason, over = false, days = 0): LateFeeAssessment => ({
    isOverdue:   over,
    daysOverdue: days,
    feeAmount:   0,
    percentage:  null,
    graceDays,
    chargeable:  false,
    reason,
  })

  const status = (invoice.status ?? '').toLowerCase()
  if (status === 'paid')    return blocked('paid')
  if (status === 'void')    return blocked('void')
  if (status === 'partial') return blocked('partial')
  // An invoice that has never reached the customer cannot be late. Matches the
  // cron's `.in('status', ['sent','overdue'])`, and matters more since migration
  // 130 backfills due dates onto old rows that were never delivered.
  if (!(CHARGEABLE_STATUSES as readonly string[]).includes(status)) return blocked('not_sent')
  if (invoice.late_fee_applied === true) return blocked('already_applied')

  if (!invoice.due_date) return blocked('no_due_date')
  // Parsed as UTC midnight, the same way the cron parses it, so both paths agree
  // to the day on when "past due" begins. due_date is a DATE column with no zone.
  const dueMs = Date.parse(`${invoice.due_date}T00:00:00Z`)
  if (Number.isNaN(dueMs)) return blocked('no_due_date')

  const nowMs     = now.getTime()
  const isOverdue = nowMs > dueMs
  if (!isOverdue) return blocked('not_yet_due')

  const daysOverdue = Math.max(1, Math.floor((nowMs - dueMs) / DAY_MS))

  // Grace is a delay on the CHARGE, not on being overdue: the invoice is shown as
  // overdue from day one so the tech can chase it, while the fee waits.
  if (nowMs <= dueMs + graceDays * DAY_MS) return blocked('within_grace', true, daysOverdue)

  // A tech who switched the engine off should not find the manual button
  // charging fees anyway. Reported as a zero fee rather than its own copy.
  if (!settings.active) return blocked('zero_fee', true, daysOverdue)

  const total      = toNumber(invoice.total, 0)
  const percentage = settings.feeType === 'percentage' ? settings.percentageRate : null
  const feeAmount  = round2(
    settings.feeType === 'percentage'
      ? total * (settings.percentageRate / 100)
      : settings.flatFeeAmount,
  )

  if (feeAmount <= 0) return blocked('zero_fee', true, daysOverdue)

  return {
    isOverdue:   true,
    daysOverdue,
    feeAmount,
    percentage,
    graceDays,
    chargeable:  true,
    reason:      null,
  }
}

/**
 * The late-fee line item, byte-for-byte the shape the cron appends, so a fee
 * applied automatically at 9am and one applied by a tech pressing Resend are
 * indistinguishable on the invoice, in the PDF and in the QuickBooks export.
 *
 * type is 'parts' rather than a 'fee' of its own because the renderers only know
 * 'labor' and 'parts', and a fee is not labour — the same compromise the cron made.
 * The id is deterministic (`late-fee-<invoiceId>`) so a fee can never be appended
 * twice under two different ids.
 */
export function buildLateFeeLineItem(
  invoiceId:   string,
  daysOverdue: number,
  feeAmount:   number,
): LateFeeLineItem {
  return {
    id:          `late-fee-${invoiceId}`,
    type:        'parts',
    description: `Late Fee — ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue`,
    part_number: '',
    quantity:    1,
    unit_cost:   feeAmount,
    amount:      feeAmount,
  }
}

/**
 * The full column update that applies a fee, ready to hand to `.update()`.
 *
 * Same columns and same values as the cron, plus `late_fee_percentage`, which
 * migration 130 adds so the rate that produced the amount is recorded on the row
 * (late_fee_settings is mutable and keeps no history). The cron predates that
 * column and will leave it NULL until it is pointed at this module — the column
 * comment in 130 documents NULL as exactly that case.
 *
 * Status moves to 'overdue': the invoice is, by definition, and the cron sets it
 * too, so the two paths leave the row in the same state.
 */
export function buildLateFeeUpdate(
  invoice:    LateFeeInvoice & { subtotal_parts?: number | string | null; line_items?: unknown },
  assessment: LateFeeAssessment,
  invoiceId:  string,
  now:        Date = new Date(),
): Record<string, unknown> {
  const items = Array.isArray(invoice.line_items) ? [...invoice.line_items] : []
  items.push(buildLateFeeLineItem(invoiceId, assessment.daysOverdue, assessment.feeAmount))

  const iso = now.toISOString()
  return {
    line_items:          items,
    subtotal_parts:      round2(toNumber(invoice.subtotal_parts, 0) + assessment.feeAmount),
    total:               round2(toNumber(invoice.total, 0) + assessment.feeAmount),
    late_fee_applied:    true,
    late_fee_amount:     assessment.feeAmount,
    late_fee_percentage: assessment.percentage,
    late_fee_applied_at: iso,
    status:              'overdue',
    updated_at:          iso,
  }
}

/**
 * True when a write failed only because `late_fee_percentage` (migration 130) has
 * not been applied to this database yet.
 *
 * Same escape hatch as isMissingCostingColumn in src/lib/hd/invoice-costing.ts,
 * and for the same reason: code ships before migrations are run, and a tech
 * pressing "Resend with Late Fee" against a pre-130 database should still get the
 * fee and the send — it is only the audit column that cannot be written. The
 * caller retries the update without that one key.
 */
export function isMissingLateFeePercentageColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const message = String((error as { message?: unknown }).message ?? '').toLowerCase()
  return (
    message.includes('late_fee_percentage') &&
    (message.includes('does not exist') || message.includes('could not find') || message.includes('schema cache'))
  )
}

/**
 * One sentence explaining why "Resend with Late Fee" is not available, shown to
 * the tech instead of an inert button. Returns '' when a fee IS chargeable.
 */
export function lateFeeBlockMessage(a: LateFeeAssessment): string {
  switch (a.reason) {
    case 'paid':            return 'This invoice is paid — no late fee can be added.'
    case 'void':            return 'This invoice is void — no late fee can be added.'
    case 'partial':         return 'This invoice is part-paid. A late fee would be charged on the full total, so it has to be added by hand.'
    case 'not_sent':        return 'This invoice has not been sent yet, so it cannot be late. Send it first.'
    case 'no_due_date':     return 'This invoice has no due date, so there is nothing to be late against. Set payment terms on the invoice.'
    case 'already_applied': return 'A late fee has already been applied to this invoice.'
    case 'not_yet_due':     return 'This invoice is not past its due date yet.'
    case 'within_grace':    return a.graceDays === 1
      ? 'Still inside the 1-day grace period after the due date.'
      : `Still inside the ${a.graceDays}-day grace period after the due date.`
    case 'zero_fee':        return 'Your late-fee settings work out to $0 on this invoice.'
    default:                return ''
  }
}
