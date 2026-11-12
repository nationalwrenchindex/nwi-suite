// The ADD LABOR LINE arithmetic, shared by the quote, the work order and the invoice
// (components/hd/LaborLineModal). Pure: no React, no fetch. Smoke tests it directly.
//
// It is the quote modal's addLaborItem, moved here unchanged in what it produces for a
// quote. Two things are new:
//   - repair_item_id: the labor card the line came from, set only while the line still
//     carries that card's name (see sameOperationName). It is how the labor guide will
//     learn from completed work: the work order records which card each line was.
//   - allowRange: the quote may quote a spread ("+ add a range"); a work order and an
//     invoice record what the job took, one number, so a range never reaches them.

export interface LaborLineInput {
  description: string
  /** Book / shop reference hours, as typed or picked. '' when the job has none. */
  bookMin: string
  bookMax: string
  /** Billed hours. mobileMax is read only in range mode. */
  mobileMin: string
  mobileMax: string
  range: boolean
  /** The fixed 1.5-2.5 hr refrigeration recovery add-on (quote only - it is a spread). */
  recharge: boolean
  /** A picked card's explicit refrigeration service: billed as its own line. */
  refrig: { hours: number; service: string | null } | null
  /** null when the document has no labor rate. */
  rate: number | null
  /** The labor card the line is, or null. */
  cardId: string | null
  /** False on a work order and an invoice. */
  allowRange: boolean
}

export interface LaborLinePick {
  description: string
  book_hours: number
  book_hours_max: number
  mobile_hours: number
  mobile_hours_max: number
  requires_refrigeration: boolean
  recharge_added: boolean
  amount: number
  amount_max: number
  /** The labor card this line came from (hd_repair_items.id). Absent when none. */
  repair_item_id?: string
}

const RECHARGE_MIN = 1.5
const RECHARGE_MAX = 2.5
const r2 = (n: number) => parseFloat(n.toFixed(2))

/** The billed hours, both ends. Without a range the max IS the min. */
export function billedHours(i: Pick<LaborLineInput, 'mobileMin' | 'mobileMax' | 'range' | 'recharge' | 'allowRange'>): { min: number; max: number } {
  const range    = i.allowRange && i.range
  const recharge = i.allowRange && i.recharge
  const baseMin  = parseFloat(i.mobileMin) || 0
  const baseMax  = range ? (parseFloat(i.mobileMax) || baseMin) : baseMin
  return { min: baseMin + (recharge ? RECHARGE_MIN : 0), max: baseMax + (recharge ? RECHARGE_MAX : 0) }
}

/**
 * The lines Add puts on the document, or an error to show. An EMPTY hours field is
 * refused (it is what a card with no field time leaves behind); a typed 0 is allowed.
 */
export function buildLaborLines(i: LaborLineInput): { lines: LaborLinePick[] } | { error: string } {
  const description = i.description.trim()
  if (!description) return { error: 'Enter a labor description.' }
  if (!i.mobileMin.trim()) return { error: 'Enter the billable hours for this job.' }
  const rate = i.rate ?? 0
  const bookMin = parseFloat(i.bookMin) || 0
  const bookMax = parseFloat(i.bookMax) || bookMin
  const { min, max } = billedHours(i)
  const recharge = i.allowRange && i.recharge
  const card = i.cardId ? { repair_item_id: i.cardId } : {}

  const lines: LaborLinePick[] = [{
    description,
    book_hours: bookMin,
    book_hours_max: bookMax,
    mobile_hours: r2(min),
    mobile_hours_max: r2(max),
    requires_refrigeration: recharge || i.refrig != null,
    recharge_added: recharge,
    amount: r2(min * rate),
    amount_max: r2(max * rate),
    ...card,
  }]

  // The card's refrigeration service is its own line, never folded into the base hours.
  // It is not the card itself, so it carries no card id.
  if (i.refrig) {
    const rh  = i.refrig.hours
    const svc = i.refrig.service ? ` ${i.refrig.service}` : ''
    const amt = r2(rh * rate)
    lines.push({
      description: `Refrigeration Service${svc} — recover, evacuate & charge`.replace(/\s+/g, ' ').trim(),
      book_hours: rh, book_hours_max: rh,
      mobile_hours: rh, mobile_hours_max: rh,
      requires_refrigeration: true,
      recharge_added: true,
      amount: amt, amount_max: amt,
    })
  }
  return { lines }
}

/**
 * The labor library's unit-type filter, from the unit on the document - the quote
 * form's rule: a reefer unit (manufacturer filled) is primary; a truck alone gets the
 * truck categories; neither filters nothing. Cards with no category always pass.
 */
export function laborCategories(unitManufacturer?: string | null, truckMake?: string | null, truckModel?: string | null): string[] | null {
  if ((unitManufacturer ?? '').trim()) return ['refrigeration', 'electrical', 'mechanical', 'sensors']
  if ((truckMake ?? '').trim() || (truckModel ?? '').trim()) return ['engine', 'fuel', 'electrical', 'brakes', 'suspension', 'cooling']
  return null
}

/** A guide entry's spread, as one number where no range is allowed: its midpoint. */
export { rangeMidpoint } from '@/lib/labor-estimate'
