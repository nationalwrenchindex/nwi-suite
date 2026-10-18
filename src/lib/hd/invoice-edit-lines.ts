// The HD invoice edit form's lines, read off the stored line_items JSONB.

export interface EditLine {
  id: string
  type: 'labor' | 'parts'
  description: string
  book_hours?: number
  mobile_hours: number
  part_number: string
  quantity: number
  unit_cost: number
  amount: number
  // The shop's cost and the markup on a part line. Not edited by the form, but
  // CARRIED: it used to rebuild every line from the fields above only, so one save of
  // an invoice wiped the cost basis that margin reporting and the business health
  // score read (the PUT re-derives parts_cost from it).
  unit_cost_base?: number | null
  markup_percent?: number | null
}

const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

/**
 * ...li FIRST, so every key the line was stored with survives the round trip, and only
 * the fields the form edits are normalised over it.
 */
export function editableLines(lineItems: unknown): EditLine[] {
  const raw = Array.isArray(lineItems) ? lineItems as Record<string, unknown>[] : []
  return raw.map(li => ({
    ...li,
    id: str(li.id) || crypto.randomUUID(),
    type: li.type === 'parts' ? 'parts' : 'labor',
    description: str(li.description),
    book_hours: li.book_hours != null ? num(li.book_hours) : undefined,
    mobile_hours: num(li.mobile_hours),
    part_number: str(li.part_number),
    quantity: num(li.quantity),
    unit_cost: num(li.unit_cost),
    amount: num(li.amount),
  }))
}
