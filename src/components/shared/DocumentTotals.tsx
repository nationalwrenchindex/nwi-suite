// The totals block every LD quote and work order screen prints - lib/document-totals'
// rows, laid out once. See that file for why there is exactly one.

import type { DocumentMoney } from '@/lib/document-money'
import { documentTotalsRows, type TotalsRowsOptions } from '@/lib/document-totals'
import { money } from '@/lib/format'

const TESTID: Partial<Record<string, string>> = {
  service_call: 'service-call-row',
  discount:     'discount-row',
  tax:          'tax-row',
}

export default function DocumentTotals({ money: m, ...o }: { money: DocumentMoney } & TotalsRowsOptions) {
  const rows = documentTotalsRows(m, o)
  return (
    <div className="space-y-1.5" data-testid="document-totals">
      {rows.map(r => {
        if (r.kind === 'total') {
          return (
            <div key={r.key} className="flex items-baseline justify-between border-t border-white/10 pt-3">
              <span className="font-condensed font-bold text-white text-lg tracking-wide">TOTAL</span>
              <span className={`font-condensed font-bold text-3xl ${(r.amount ?? 0) < 0 ? 'text-danger' : 'text-orange'}`}>
                {money(r.amount ?? 0)}
              </span>
            </div>
          )
        }
        const dim = r.kind === 'parts_markup' || r.kind === 'tax'
        const rule = r.kind === 'subtotal' ? ' border-t border-white/10 pt-2' : ''
        return (
          <div key={r.key} className={`flex justify-between gap-3 text-sm${rule}`} data-testid={TESTID[r.kind]}>
            <span className={dim ? 'text-white/40' : 'text-white/60'}>
              {r.label}
              {r.detail && <span className="text-white/30 text-xs ml-1.5">{r.kind === 'discount' ? `· ${r.detail}` : r.detail}</span>}
            </span>
            <span className={r.negative ? 'text-emerald-400' : dim ? 'text-white/60' : 'text-white'}>
              {r.amount === null ? '—' : `${r.negative ? '-' : r.kind === 'parts_markup' ? '+' : ''}${money(r.amount)}`}
            </span>
          </div>
        )
      })}
    </div>
  )
}
