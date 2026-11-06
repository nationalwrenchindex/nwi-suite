// ─── A QuickWrench quote's money, through the shared calculator ──────────────
//
// QuickWrench builds a quote from jobs: each job's parts (the tech's store cost and
// the customer price, which is cost marked up unless the tech overrode it) and its
// labour hours, plus any extra labour lines. This turns that into the line items
// lib/document-money prices, so a QuickWrench quote is priced EXACTLY as the New
// Quote form prices the same job: shop supplies on the marked-up parts, drive time and
// mileage per the billing method picker, the service call fee taxed per its setting,
// and the tax split into a parts bucket and a labor bucket, each rounded once.
//
// Before it, QuickWrench totalled parts + labour + tax itself and its save route stored
// those figures as sent - no shop supplies, no travel, no mileage, no service call,
// tax_percent back-derived from the total, and parts_subtotal holding the COST. The
// client (what the tech sees) and the save route (what is stored) both call this, so
// the stored quote is the one that was on screen.

import type { EditItem } from '@/components/shared/line-items'
import { documentMoney, type DocumentMoney } from '@/lib/document-money'
import type { DocumentDefaults } from '@/lib/document-defaults'
import type { TaxSettings } from '@/lib/tax'

/** One part on a job: the tech's store cost and the customer's per-unit price. */
export interface QwPart { name: string; qty: number; unit_cost: number; unit_price: number }
/** One job: its labour hours, under the quote's one labour rate, and its parts. */
export interface QwJob { subtype: string; labor_hours: number; parts: QwPart[] }
export interface QwExtraLabor { description: string; hours: number }

/**
 * The editor rows, in the order the quote prints: each job's parts then its labour,
 * then the extra labour lines. `costs` runs alongside: the store cost of each part row
 * (null for labour), which the stored line keeps as `unit_cost` for profit tracking.
 *
 * A part's customer price P is stored post-markup; the calculator holds the pre-markup
 * base, so base = P / (1 + markup). The calculator multiplies it back, landing on P.
 */
export function quickwrenchItems(
  jobs: QwJob[], extraLabor: QwExtraLabor[], laborRate: number, markupPct: number,
): { items: EditItem[]; costs: Array<number | null> } {
  const factor = 1 + (markupPct > 0 ? markupPct : 0) / 100
  const items: EditItem[] = []
  const costs: Array<number | null> = []
  jobs.forEach((j, ji) => {
    j.parts.forEach((p, pi) => {
      items.push({
        _id: `qw-${ji}-p${pi}`, description: p.name, part_number: '',
        quantity: Number(p.qty) || 0, unit_price: Math.max(0, Number(p.unit_price) || 0) / factor,
      })
      costs.push(Math.round((Number(p.unit_cost) || 0) * 100) / 100)
    })
    items.push({
      _id: `qw-${ji}-labor`, kind: 'labor', description: `Labor — ${j.subtype}`, part_number: '',
      quantity: Number(j.labor_hours) || 0, unit_price: laborRate,
    })
    costs.push(null)
  })
  extraLabor.forEach((l, i) => {
    items.push({
      _id: `qw-extra-${i}`, kind: 'labor', description: `Labor — ${l.description || 'Additional labor'}`, part_number: '',
      quantity: Number(l.hours) || 0, unit_price: laborRate,
    })
    costs.push(null)
  })
  return { items, costs }
}

/** The stored line_items with each part's store cost put back on it, as QuickWrench always stored them. */
export function withPartCosts<T extends object>(lines: T[], costs: Array<number | null>): T[] {
  return lines.map((l, i) => (costs[i] != null ? { ...l, unit_cost: costs[i] } : l))
}

/** Store cost across every part: the quote's parts_cost_total (COGS). */
export function partsCostTotal(jobs: QwJob[]): number {
  const t = jobs.reduce((s, j) => s + j.parts.reduce((ss, p) => ss + (Number(p.unit_cost) || 0) * (Number(p.qty) || 0), 0), 0)
  return Math.round(t * 100) / 100
}

export interface QuickwrenchMoneyInput {
  jobs:          QwJob[]
  extraLabor:    QwExtraLabor[]
  /** The tech's rates on the Quote tab, seeded from Settings (lib/document-defaults). */
  laborRate:     number
  markupPct:     number
  taxPct:        number
  /** The shop's split. Null only on the client before Settings land: then one rate. */
  taxSettings:   TaxSettings | null
  /** The shop's travel / mileage / supplies settings and its service call setting. */
  defaults:      DocumentDefaults
  travelHours:   number
  mileageMiles:  number
  /** The fee as on the Quote tab; its tax treatment is always the shop's setting. */
  serviceCallFee: number
}

/** The quote's money and every column to store, part costs kept on their lines. */
export function quickwrenchMoney(i: QuickwrenchMoneyInput): { money: DocumentMoney; columns: Record<string, unknown> } {
  const { items, costs } = quickwrenchItems(i.jobs, i.extraLabor, i.laborRate, i.markupPct)
  const money = documentMoney({
    items, markupPct: i.markupPct, laborRate: i.laborRate, taxPct: i.taxPct,
    taxSettings:    i.taxSettings,
    extrasSettings: i.defaults.extras,
    extras:         { travelHours: i.travelHours, mileageMiles: i.mileageMiles },
    serviceCall:    i.defaults.serviceCallAvailable ? { fee: i.serviceCallFee, tax: i.defaults.serviceCall.tax } : null,
  })
  const lines = Array.isArray(money.columns.line_items) ? money.columns.line_items as object[] : []
  return { money, columns: { ...money.columns, line_items: withPartCosts(lines, costs) } }
}
