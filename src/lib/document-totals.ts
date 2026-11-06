// ─── The totals block of an LD quote or work order, as rows ───────────────────
//
// ONE line structure for every LD document screen: the New Quote form, the quote
// editor (draft and sent), the work order form, and QuickWrench's quote tab. They all
// price through lib/document-money; this turns that one answer into the rows they print,
// so a quote and the work order made from it print identical figures in identical rows.
//
// Before it, each screen laid its own rows out: the quote editor printed one combined
// "Tax (7.75%)" line while the work order made from it printed a parts bucket and a
// labor bucket - the same stored tax_breakdown, two different documents to the eye.
//
// Tax is ALWAYS one row per bucket when the split is known, each rounded once
// (lib/tax.computeTax). The single "Tax (x%)" row is only for a document that predates
// the split and has no breakdown to show - claiming one it does not have would misstate
// what the customer was charged.
//
// Shop-facing: these rows include Parts Base and the markup percentage, which the
// customer's copy never prints (lib/customer-copy).

import type { DocumentMoney } from '@/lib/document-money'
import { extrasDisplayRows } from '@/lib/billable-extras'
import { taxDisplayRows } from '@/lib/tax'
import { discountLabel } from '@/lib/document-discount'
import { serviceCallRow } from '@/lib/service-call'

export type TotalsRowKind =
  | 'parts_base' | 'parts_markup' | 'labor' | 'service_call' | 'extra'
  | 'subtotal' | 'discount' | 'tax' | 'total'

export interface TotalsRow {
  key:     string
  kind:    TotalsRowKind
  label:   string
  /** Shown beside the label, smaller: "2 hours × $135.00/hr". */
  detail:  string | null
  /** Null prints a dash: an exempt tax bucket. */
  amount:  number | null
  /** Shown as a reduction. */
  negative?: boolean
}

export interface TotalsRowsOptions {
  /** The markup as the screen should state it: "30%", or "markup not recorded". */
  markupText: string
  /** Labour hours across the document, for the Labor row's detail. */
  laborHours: number
  /** The document's single recorded rate, only for a document with no breakdown. */
  taxPct:     number
}

const trimHours = (n: number) => String(Math.round(n * 100) / 100)

export function documentTotalsRows(m: DocumentMoney, o: TotalsRowsOptions): TotalsRow[] {
  const rows: TotalsRow[] = []
  if (m.partsBase > 0) {
    rows.push({ key: 'parts_base', kind: 'parts_base', label: 'Parts Base', detail: null, amount: m.partsBase })
    rows.push({ key: 'parts_markup', kind: 'parts_markup', label: `Parts Markup (${o.markupText})`, detail: null, amount: m.markupAmt })
  }
  if (m.laborSubtotal > 0) {
    rows.push({ key: 'labor', kind: 'labor', label: 'Labor',
      detail: o.laborHours > 0 ? `${trimHours(o.laborHours)}h` : null, amount: m.laborSubtotal })
  }
  const call = serviceCallRow(m.serviceCall)
  if (call) {
    rows.push({ key: 'service_call', kind: 'service_call', label: call.label,
      detail: m.serviceCall.tax === 'none' ? 'not taxed' : null, amount: call.amount })
  }
  for (const r of extrasDisplayRows(m.extras)) {
    const capped = r.key === 'shop_supplies' && m.extras.shopSupplies.capped
    rows.push({ key: `extra_${r.key}`, kind: 'extra', label: r.label,
      detail: [r.detail, capped ? 'capped' : null].filter(Boolean).join(', ') || null, amount: r.amount })
  }
  rows.push({ key: 'subtotal', kind: 'subtotal', label: 'Subtotal', detail: null, amount: m.subtotal })
  if (m.discount) {
    rows.push({ key: 'discount', kind: 'discount', label: discountLabel(m.discount),
      detail: m.discount.reason ?? null, amount: m.discount.amount, negative: true })
  }
  const taxRows = taxDisplayRows(m.taxBreakdown)
  if (taxRows.length) {
    for (const t of taxRows) {
      rows.push({ key: `tax_${t.category}`, kind: 'tax', label: t.text, detail: null, amount: t.taxed ? t.amount : null })
    }
  } else {
    rows.push({ key: 'tax', kind: 'tax', label: `Tax (${o.taxPct}%)`, detail: null, amount: m.taxAmount })
  }
  rows.push({ key: 'total', kind: 'total', label: 'Total', detail: null, amount: m.grandTotal })
  return rows
}
