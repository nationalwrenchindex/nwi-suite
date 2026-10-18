// HD quote approval, and the quote -> work order conversion.
//
// ===========================================================================
// THE FOUR RULES THIS FILE EXISTS TO HOLD
// ===========================================================================
//
//   1. THE APPROVAL IS THE AUTHORIZATION. approved_at, approval_method and the
//      customer's PO are copied onto the work order. The tech does not re-authorize
//      what the customer signed, and nothing here lets them.
//
//   2. THE QUOTE'S RECORDED TERMS TRAVEL. Every rate, markup, travel, mileage, supplies
//      and tax figure is read off THE QUOTE ROW, never from the shop's current
//      settings. A quote approved tonight produces a work order at tonight's numbers
//      even if Settings changes tomorrow. This is the rule that cost a week on billable
//      extras; it is not re-derived here, it is copied.
//
//   3. CONVERT ONCE. The guard is the partial unique index
//      hd_work_orders_one_per_quote (migration 153), not a read-then-write check. A
//      second concurrent approval loses the insert race and is handed the work order
//      that already exists. Every other double-convert guard in this codebase is an
//      application-level check with a real race window; this one is not.
//
//   4. LINES LAND IN hd_work_order_line_items. That is the table the HD work order UI
//      already edits. work_order_segments is deliberately NOT used: it has never held a
//      single HD row and tonight is not the night to prove a new surface.
//
// WHAT THIS FILE DOES NOT DO
//
// It does not touch LD. It does not create an invoice. It does not price anything - it
// copies figures the quote already computed and stored.

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingPaymentTermsColumn } from '@/lib/hd/payment-terms'
import { isMissingMigration159Column, withoutMigration159Columns } from '@/lib/hd/migration-159'

/** 32 hex characters, the same shape LD's quote token uses. */
export function generateQuoteToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export type ApprovalMethod = 'customer_link' | 'verbal'

/** Absolute URL for a minted quote token. Safe to put in an SMS body. */
export function publicQuoteUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://tools.nationalwrenchindex.com')
    .replace(/\/$/, '')
  return `${base}/hd/quote/${token}`
}

/**
 * Return the quote's public token, creating one if it does not have one yet.
 *
 * IDEMPOTENT BY DESIGN. Re-sending a quote must not rotate the token: the customer may
 * have the first message open, and a link that dies between the text and the tap looks
 * like a dead business. It is also the link the approval is recorded against.
 *
 * Scoped by BOTH id and user_id so an id lifted from another subscriber's quote cannot
 * mint a live public URL onto their row.
 *
 * Throws if the quote does not exist or is not owned by userId.
 */
export async function mintQuoteToken(quoteId: string, userId: string): Promise<string> {
  const svc = createServiceClient()

  const { data: existing, error: readErr } = await svc
    .from('hd_quotes')
    .select('public_token')
    .eq('id', quoteId)
    .eq('user_id', userId)
    .maybeSingle()

  if (readErr) throw new Error(`Failed to read quote: ${readErr.message}`)
  if (!existing) throw new Error('Quote not found')

  const current = (existing.public_token as string | null) ?? null
  if (current) return current

  const token = generateQuoteToken()

  // .is('public_token', null) makes this a compare-and-set. Two sends firing at once
  // would otherwise both generate a token and the second would overwrite the first,
  // invalidating a link that had already gone out.
  const { data: updated, error: writeErr } = await svc
    .from('hd_quotes')
    .update({ public_token: token })
    .eq('id', quoteId)
    .eq('user_id', userId)
    .is('public_token', null)
    .select('public_token')
    .maybeSingle()

  if (writeErr) throw new Error(`Failed to mint quote token: ${writeErr.message}`)
  if (updated?.public_token) return String(updated.public_token)

  // Lost the race: another request minted first, and its token is the live one.
  const { data: raced } = await svc
    .from('hd_quotes')
    .select('public_token')
    .eq('id', quoteId)
    .eq('user_id', userId)
    .maybeSingle()

  const settled = (raced?.public_token as string | null) ?? null
  if (!settled) throw new Error('Failed to mint quote token')
  return settled
}

/**
 * The columns the public approval page is allowed to read.
 *
 * Explicit rather than `*` because this is served to an UNAUTHENTICATED visitor who
 * has a link. internal_notes, user_id and the shop's own bookkeeping must not travel
 * to the customer's browser, and a `*` select would ship whatever the next migration
 * adds without anyone deciding to.
 */
export const HD_QUOTE_PUBLIC_SELECT = [
  'id', 'quote_number', 'status', 'public_token',
  'customer_name', 'customer_phone', 'customer_email',
  'unit_manufacturer', 'unit_model', 'unit_serial', 'unit_year', 'unit_number',
  'truck_make', 'truck_model', 'truck_year', 'vin',
  'complaint', 'diagnosis', 'notes',
  'line_items', 'labor_hours', 'labor_rate', 'parts_markup_percent',
  'subtotal_labor', 'subtotal_parts',
  'diagnostic_fee', 'road_call_fee',
  'travel_hours', 'travel_rate', 'travel_amount',
  'mileage_miles', 'mileage_rate', 'mileage_amount',
  'shop_supplies_percent_applied', 'shop_supplies_cap_applied', 'shop_supplies_fee',
  'tax_rate', 'tax_amount', 'tax_breakdown', 'total',
  'payment_terms', 'valid_until', 'created_at',
  'approved_at', 'declined_at', 'approval_method',
  'customer_response_note', 'customer_po_number',
].join(', ')

/**
 * EVERY pricing term the work order inherits, read off the quote row.
 *
 * Listed in one place so a term cannot be added to hd_quotes later and silently fail
 * to travel. The names on the left are hd_work_orders columns; on the right,
 * hd_quotes.
 *
 * NOTE THE TAX NAME CHANGE: hd_quotes calls it tax_rate, hd_work_orders calls it
 * tax_percent (migration 153). Same value, different column name on each side. This is
 * the one field whose name differs, which is exactly why it is written down here
 * rather than left to a spread.
 */
export function termsFromQuote(q: Record<string, unknown>): Record<string, unknown> {
  return {
    labor_rate:                    q.labor_rate ?? null,
    labor_hours:                   q.labor_hours ?? null,
    parts_markup_percent:          q.parts_markup_percent ?? null,

    tax_percent:                   q.tax_rate ?? null,
    tax_amount:                    q.tax_amount ?? null,
    tax_breakdown:                 q.tax_breakdown ?? null,

    travel_hours:                  q.travel_hours ?? null,
    travel_rate:                   q.travel_rate ?? null,
    travel_amount:                 q.travel_amount ?? null,

    mileage_miles:                 q.mileage_miles ?? null,
    mileage_rate:                  q.mileage_rate ?? null,
    mileage_amount:                q.mileage_amount ?? null,

    shop_supplies_percent_applied: q.shop_supplies_percent_applied ?? null,
    shop_supplies_cap_applied:     q.shop_supplies_cap_applied ?? null,
    shop_supplies_fee:             q.shop_supplies_fee ?? null,

    // THE FEES. Absent from this list, they had nowhere to go: the quote's tax had
    // already taxed them in the labor bucket and that tax WAS copied, so the invoice
    // taxed a $35.00 road call it no longer charged. Migration 159 gives the work
    // order the columns; until it is applied the insert retries without them and the
    // invoice converter reads the fees off the quote instead.
    diagnostic_fee:                q.diagnostic_fee ?? null,
    road_call_fee:                 q.road_call_fee ?? null,
  }
}

/** A quote line as hd_quotes stores it, loosely typed because it is JSONB. */
interface QuoteLine {
  type?: unknown
  description?: unknown
  part_number?: unknown
  quantity?: unknown
  /**
   * THE SELL PRICE. Not the cost.
   *
   * On an hd_quotes part line, `unit_cost` is what the CUSTOMER pays - see
   * addPartsItem in src/app/hd/quotes/new/page.tsx, which writes
   * `unit_cost: sellPrice(cost, markup)` and keeps the shop's own cost in
   * `unit_cost_base`. The name is a trap and it has now cost money twice: the
   * work-order-to-invoice converter documents it at the top of
   * src/lib/hd/wo-to-invoice.ts, and this module did not know about it at all.
   */
  unit_cost?: unknown
  /** What the SHOP paid. This is the cost, despite the other field's name. */
  unit_cost_base?: unknown
  unit_price?: unknown
  markup_percent?: unknown
  amount?: unknown
  mobile_hours?: unknown
  book_hours?: unknown
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Turn the quote's line_items JSONB into hd_work_order_line_items rows.
 *
 * The two shapes genuinely differ and the mapping is not a rename:
 *
 *   quote line   { type, description, mobile_hours, amount, part_number, quantity,
 *                  unit_cost, ... }
 *   wo line row  { type, description, part_number, quantity, unit_cost, unit_price,
 *                  markup_percent, total, sort_order }
 *
 * For a LABOR line the quote carries HOURS in mobile_hours and the money in amount,
 * while hd_work_order_line_items has no hours column at all - its labor rows carry
 * hours in `quantity` and the rate in `unit_price` (confirmed against the editor in
 * src/components/hd/WorkOrderLineItems.tsx). So hours land in quantity and the
 * quote's own labor_rate lands in unit_price, which reproduces the same total without
 * re-pricing anything.
 *
 * For a PART line the fields line up directly.
 */
export function workOrderLinesFromQuote(
  lineItems: unknown,
  quoteLaborRate: number | null,
): Array<Record<string, unknown>> {
  if (!Array.isArray(lineItems)) return []

  const rows: Array<Record<string, unknown>> = []
  let sort = 0

  for (const raw of lineItems) {
    if (!raw || typeof raw !== 'object') continue
    const li = raw as QuoteLine
    const kind = String(li.type ?? '').toLowerCase()
    const isLabor = kind === 'labor' || kind === 'labour'

    const description = typeof li.description === 'string' ? li.description.trim() : ''
    const partNumber = typeof li.part_number === 'string' && li.part_number.trim()
      ? li.part_number.trim() : null

    // A row with neither a description nor a part number carries nothing a technician
    // could act on, and skipping it silently is how a billable line disappears - so an
    // empty line is dropped only when it is genuinely empty of both.
    if (!description && !partNumber) continue

    if (isLabor) {
      // Hours into quantity, the quote's rate into unit_price. total copied from the
      // quote's own amount where it has one, so the work order shows the figure the
      // customer approved rather than a recomputation that could land a cent away.
      const hours = num(li.mobile_hours) ?? num(li.book_hours) ?? num(li.quantity) ?? 0
      const rate = quoteLaborRate ?? num(li.unit_price) ?? 0
      const amount = num(li.amount)
      rows.push({
        type:           'labor',
        description:    description || 'Labor',
        part_number:    null,
        quantity:       hours,
        unit_cost:      null,
        unit_price:     rate,
        markup_percent: null,
        total:          amount ?? Number((hours * rate).toFixed(2)),
        sort_order:     sort++,
      })
      continue
    }

    // =========================================================================
    // THE MARKUP WAS BEING APPLIED TWICE. This is that fix.
    // =========================================================================
    //
    // A part quoted at cost $3.00 with 30% markup, sell $3.90, landed on the work
    // order as cost 3.90 / markup 30 / sell 5.07 - and $5.07 is what the invoice
    // would have billed for a part the customer approved at $3.90.
    //
    // Because the two sides name the same thing differently:
    //
    //   hd_quotes line_items    unit_cost      = the SELL price
    //                           unit_cost_base = what the shop paid
    //   hd_work_order_line_items
    //                           unit_cost      = what the shop paid
    //                           unit_price     = the SELL price
    //
    // This read li.unit_cost and wrote it to unit_cost, so the sell price went into
    // the cost column; the work order then applied the markup to it a second time.
    // Nothing recomputed wrongly - the arithmetic was right on a wrong input.
    const quantity = num(li.quantity) ?? 1
    // The sell price as the quote recorded it. unit_price is checked too so a future
    // line shape that uses the honest name still works.
    const quotedSell = num(li.unit_cost) ?? num(li.unit_price)
    const markup = num(li.markup_percent)
    const amount = num(li.amount)

    // NULL WHEN THE QUOTE DID NOT RECORD A COST, and deliberately not derived back
    // out of the sell price. A null cost means "not known", which is exactly what
    // migration 119 established for parts_cost, and it is also the SAFE value: the
    // work order only re-prices a part when cost AND markup are both present
    // (lineTotal in lib/shared/work-order-lines.ts), so a null cost leaves the
    // recorded sell standing rather than inviting another recomputation.
    const unitCost = num(li.unit_cost_base)

    rows.push({
      type:           'part',
      description:    description || partNumber || 'Part',
      part_number:    partNumber,
      quantity,
      unit_cost:      unitCost,
      // The price the customer agreed to, copied. Same rule as the labor rate and
      // the tax: a document's recorded terms beat any recalculation.
      unit_price:     quotedSell,
      // Carried only alongside a real cost. Markup with no cost is a percentage of
      // nothing, and storing it would make the work order's editor think it could
      // re-price the line.
      markup_percent: unitCost != null ? markup : null,
      total:          amount ?? (quotedSell != null ? Number((quantity * quotedSell).toFixed(2)) : null),
      sort_order:     sort++,
    })
  }

  return rows
}

/** Postgres unique violation. Here it means this quote already has a work order. */
const UNIQUE_VIOLATION = '23505'

export interface ConversionResult {
  workOrderId: string
  workOrderNumber: string
  created: boolean
  lineCount: number
  /** Set when the quote already had a work order and this call returned that one. */
  alreadyExisted: boolean
  lineError?: string
}

/**
 * Create the work order for an APPROVED quote.
 *
 * Idempotent by database constraint, not by checking first. Call it twice and the
 * second call is handed the same work order.
 */
export async function createWorkOrderFromQuote(
  quote: Record<string, unknown>,
): Promise<{ ok: true; result: ConversionResult } | { ok: false; error: string }> {
  const supabase = createServiceClient()
  const userId = String(quote.user_id)
  const quoteId = String(quote.id)

  // If one already exists, hand it back without attempting an insert. This is a
  // convenience, NOT the guard - the index below is the guard. Doing it first simply
  // avoids burning a work order number on a collision.
  {
    const { data: existing } = await supabase
      .from('hd_work_orders')
      .select('id, work_order_number')
      .eq('quote_id', quoteId)
      .maybeSingle()
    if (existing?.id) {
      const { count } = await supabase
        .from('hd_work_order_line_items')
        .select('id', { count: 'exact', head: true })
        .eq('work_order_id', existing.id)
      return {
        ok: true,
        result: {
          workOrderId: String(existing.id),
          workOrderNumber: String(existing.work_order_number),
          created: false,
          alreadyExisted: true,
          lineCount: count ?? 0,
        },
      }
    }
  }

  const year = new Date().getFullYear()
  const { count } = await supabase
    .from('hd_work_orders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  const seq = String((count ?? 0) + 1).padStart(4, '0')

  const insertRow: Record<string, unknown> = {
    user_id:           userId,
    work_order_number: `WO-${year}-${seq}`,
    status:            'open',
    quote_id:          quoteId,

    // Identity, carried so nothing is retyped.
    customer_id:       quote.customer_id ?? null,
    customer_name:     quote.customer_name ?? null,
    customer_phone:    quote.customer_phone ?? null,
    unit_manufacturer: quote.unit_manufacturer ?? null,
    unit_model:        quote.unit_model ?? null,
    unit_serial:       quote.unit_serial ?? null,
    unit_number:       quote.unit_number ?? null,
    // The Intel Hub links. hd_quotes gains these in migration 158; a quote saved
    // before it reads undefined here and carries null, which is what it carried before.
    fleet_account_id:  quote.fleet_account_id ?? null,
    unit_id:           quote.unit_id ?? null,
    // What the customer agreed to pay on. The invoice reads it from here; without it
    // the invoice fell back to "Due on receipt", a term the quote does not even offer.
    payment_terms:     quote.payment_terms ?? null,
    address_line1:     quote.address_line1 ?? null,
    address_line2:     quote.address_line2 ?? null,
    city:              quote.city ?? null,
    state:             quote.state ?? null,
    zip:               quote.zip ?? null,

    // The quote's complaint is what the customer agreed to have looked at, so it
    // becomes the job's service request. diagnosis is the tech's finding and belongs in
    // comments, not in what the customer asked for.
    service_requests:  quote.complaint ?? null,
    comments:          quote.diagnosis ?? null,
    internal_notes:    quote.notes ?? null,
    service_type:      'Quote Approved',
    total_amount:      quote.total ?? null,

    // THE AUTHORIZATION RECORD. Copied, never generated here.
    authorized_at:        quote.approved_at ?? null,
    authorization_method: quote.approval_method ?? null,
    customer_po_number:   quote.customer_po_number ?? null,

    // THE RECORDED TERMS.
    ...termsFromQuote(quote),
  }

  // ===========================================================================
  // UNIT NOT IDENTIFIED, recorded rather than left silent.
  // ===========================================================================
  //
  // The quote form requires a manufacturer and model but NOT a serial - on the phone
  // it is often not in hand, and refusing the quote over it would just get the field
  // filled with a guess. So the job carries a flag instead, and the work order screen
  // shows it, so "we never pinned down which unit this was" is visible to whoever
  // picks the job up.
  //
  // A TRUCK job with a VIN is identified; a reefer with no serial is not. flagged_items
  // is JSONB and already on hd_work_orders (migration 047), so this needs no migration.
  {
    const hasSerial = String(quote.unit_serial ?? '').trim() !== ''
    const hasVin    = String(quote.vin ?? '').trim() !== ''
    if (!hasSerial && !hasVin) {
      insertRow.flagged_items = {
        unit_not_identified: true,
        reason: 'No serial number or VIN was recorded on the approved quote.',
        flagged_at: new Date().toISOString(),
      }
    }
  }

  // ===========================================================================
  // LOCATION, defaulted from the address on the quote.
  // ===========================================================================
  //
  // hd_work_orders.location was left null by this converter, so every quote-approved
  // job reached the schedule with no address on it and the tech had to go back to the
  // quote to find out where he was going.
  //
  // THE SERVICE ADDRESS WINS where the quote has one. has_corp_address on an HD
  // document means "the billing address and the service address are different", and
  // the unit is at the service address - sending a tech to a head office because that
  // is where the invoice goes is the specific mistake worth avoiding here.
  //
  // It is only a DEFAULT. The work order screen can edit it, because the unit is
  // often at neither address on file.
  if (insertRow.location == null) {
    const useCorp = Boolean(quote.has_corp_address)
    const line1 = useCorp ? quote.corp_address_line1 : quote.address_line1
    const line2 = useCorp ? quote.corp_address_line2 : quote.address_line2
    const city  = useCorp ? quote.corp_city  : quote.city
    const state = useCorp ? quote.corp_state : quote.state
    const zip   = useCorp ? quote.corp_zip   : quote.zip
    const location = [
      line1, line2,
      [city, state].filter(v => String(v ?? '').trim() !== '').join(', '),
      zip,
    ]
      .map(v => String(v ?? '').trim())
      .filter(v => v !== '')
      .join(', ')
    if (location) insertRow.location = location
  }

  // LABOR HOURS, SUMMED FROM THE LINES WHEN THE QUOTE HAS NO FIGURE OF ITS OWN.
  //
  // The HD quote form never writes hd_quotes.labor_hours - the hours live on each
  // labor line - so termsFromQuote copied a null and the work order screen printed
  // "Labor —" beside a Parts & Labor total of $405.00. A job with four hundred
  // dollars of labor on it saying it has no labor reads as a broken screen.
  //
  // This is a SUM of hours the quote already recorded, not a re-price: no rate is
  // touched and no money is derived. A figure the quote did record always wins.
  if (insertRow.labor_hours == null) {
    const laborHours = workOrderLinesFromQuote(quote.line_items, num(quote.labor_rate))
      .filter(l => l.type === 'labor')
      .reduce((sum, l) => sum + (num(l.quantity) ?? 0), 0)
    if (laborHours > 0) insertRow.labor_hours = Number(laborHours.toFixed(2))
  }

  // THE UNIT, resolved when the quote did not record which hd_units row it was.
  //
  // Quotes saved before migration 158 have no unit_id, and neither does one where the
  // tech typed the serial rather than picking the unit. A serial that matches EXACTLY
  // ONE of this shop's units is that unit; zero or several and nothing is guessed.
  // The fleet comes with it only when the quote did not name one.
  if (!insertRow.unit_id) {
    const serial = String(quote.unit_serial ?? '').trim()
    if (serial) {
      const { data: matches } = await supabase
        .from('hd_units')
        .select('id, fleet_account_id, unit_number')
        .eq('user_id', userId)
        .eq('serial_number', serial)
        .limit(2)
      if (matches?.length === 1) {
        const u = matches[0]
        insertRow.unit_id = u.id
        if (!insertRow.fleet_account_id) insertRow.fleet_account_id = u.fleet_account_id ?? null
        if (!insertRow.unit_number)      insertRow.unit_number      = u.unit_number ?? null
      }
    }
  }

  // Migrations 158 (payment_terms) and 159 (fees, unit year/truck/VIN) are applied by
  // hand. Until they are, the work order saves without those columns rather than not
  // saving at all; the invoice converter reads them from the quote in that window.
  // A loop, because both can be pending at once and each retry strips only its own.
  let row: Record<string, unknown> = insertRow
  let { data: wo, error } = await supabase
    .from('hd_work_orders')
    .insert(row)
    .select('id, work_order_number')
    .single()

  for (let attempt = 0; error && attempt < 2; attempt++) {
    if (isMissingPaymentTermsColumn(error) && 'payment_terms' in row) {
      console.error('[hd quote->wo] payment_terms missing - run migration 158', error.message)
      const { payment_terms: _drop, ...withoutTerms } = row
      void _drop
      row = withoutTerms
    } else if (isMissingMigration159Column(error) && 'road_call_fee' in row) {
      console.error('[hd quote->wo] fee/unit columns missing - run migration 159', error.message)
      row = withoutMigration159Columns(row)
    } else {
      break
    }
    ;({ data: wo, error } = await supabase
      .from('hd_work_orders')
      .insert(row)
      .select('id, work_order_number')
      .single())
  }

  if (error || !wo) {
    if (!error) return { ok: false, error: 'work order insert returned no row' }
    if (error.code === UNIQUE_VIOLATION) {
      // Lost the race to a concurrent approval - the customer clicked twice, or
      // forwarded the link. The index did its job; fetch the winner.
      const { data: winner } = await supabase
        .from('hd_work_orders')
        .select('id, work_order_number')
        .eq('quote_id', quoteId)
        .maybeSingle()
      if (winner?.id) {
        const { count: lines } = await supabase
          .from('hd_work_order_line_items')
          .select('id', { count: 'exact', head: true })
          .eq('work_order_id', winner.id)
        return {
          ok: true,
          result: {
            workOrderId: String(winner.id),
            workOrderNumber: String(winner.work_order_number),
            created: false,
            alreadyExisted: true,
            lineCount: lines ?? 0,
          },
        }
      }
    }
    console.error('[hd quote->wo] insert failed:', error.message)
    return { ok: false, error: error.message }
  }

  // The lines. A failure here must NOT lose the work order - the authorization has
  // already happened and the job is real; an empty line list is recoverable by the
  // tech, a missing work order is not. Reported back so the caller can say so.
  const lines = workOrderLinesFromQuote(quote.line_items, num(quote.labor_rate))
  let lineError: string | undefined
  let lineCount = 0

  if (lines.length) {
    const { error: lineErr } = await supabase
      .from('hd_work_order_line_items')
      .insert(lines.map(l => ({ ...l, work_order_id: wo.id })))
    if (lineErr) {
      console.error('[hd quote->wo] line items failed, work order kept:', lineErr.message)
      lineError = lineErr.message
    } else {
      lineCount = lines.length
    }
  }

  return {
    ok: true,
    result: {
      workOrderId: String(wo.id),
      workOrderNumber: String(wo.work_order_number),
      created: true,
      alreadyExisted: false,
      lineCount,
      lineError,
    },
  }
}
