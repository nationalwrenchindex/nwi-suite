'use client'

// ─── Fleet Pro — twelve-month cost trend ──────────────────────────────────────
// Renders the `months[]` series the cost engine produces (src/lib/fleet-pro/cost.ts),
// oldest month on the left.
//
// ── WHY CSS BARS AND NOT A CHART LIBRARY ─────────────────────────────────────
// Deliberately no dependency. The portal ships one chart shape — twelve bars, one
// series, no zoom, no legend — and Recharts would put ~90kB of client JS in the
// bundle to draw it. UnitDetailClient already draws its meter trend as a bare inline
// SVG path for the same reason; this is the same decision applied to a bar series.
//
// ── WHY BARS AND NOT A LINE ──────────────────────────────────────────────────
// Repair spend is not a continuous quantity that "was" something between two
// invoices. A line drawn through $0, $4,200, $0 implies the truck was costing money
// on the way up and on the way down; it wasn't. Discrete months, discrete bars.
//
// Colors are inline literals like every other component in this folder (see brand.tsx
// on why the palette is restated rather than pulled through Tailwind). The portal has
// one treatment — the dark navy ground — so there is no light variant to match.

import type { MonthlyCost } from '@/types/fleet-pro-cost'
import { NWI_ORANGE } from './brand'
import { money as sharedMoney } from '@/lib/format'

const DIM  = 'rgba(255,255,255,0.4)'
const DIM2 = 'rgba(255,255,255,0.55)'
const RULE = 'rgba(255,255,255,0.08)'

// Whole-dollar abbreviation was dropped here deliberately: a chart caption that
// disagrees with the invoice it summarises is the bug this replaced.
const usd = { format: (n: number) => sharedMoney(n) }

/** 'YYYY-MM' -> 'Jan'. Pinned to midday so the local timezone cannot shift the month. */
function monthLabel(month: string): string {
  const d = new Date(`${month}-01T12:00:00`)
  if (Number.isNaN(d.getTime())) return month
  return d.toLocaleDateString('en-US', { month: 'short' })
}

function monthTitle(month: string): string {
  const d = new Date(`${month}-01T12:00:00`)
  if (Number.isNaN(d.getTime())) return month
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function CostTrendChart({
  months,
  color = NWI_ORANGE,
  height = 132,
}: {
  months: MonthlyCost[]
  color?: string
  height?: number
}) {
  if (!months || months.length === 0) return null

  const peak  = Math.max(...months.map(m => m.cost), 0)
  const total = months.reduce((sum, m) => sum + m.cost, 0)

  // A fleet that has spent nothing all year still gets the axis and the twelve
  // month labels. An empty box says "no data"; a flat baseline says "no spend",
  // which is the true and far more useful statement.
  const hasSpend = peak > 0

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between mb-2 gap-3">
        <p className="text-[10px] uppercase tracking-widest" style={{ color: DIM }}>
          12-Month Trend
        </p>
        <p className="text-xs whitespace-nowrap" style={{ color: DIM2 }}>
          Peak {usd.format(peak)} · Total {usd.format(total)}
        </p>
      </div>

      {/* Bars. `items-end` is what makes each bar grow up from the baseline, and
          min-w-0 on the columns is what lets twelve of them survive a 360px phone
          without forcing the page into a horizontal scroll. */}
      <div
        className="flex items-end gap-[3px] sm:gap-1"
        style={{ height, borderBottom: `1px solid ${RULE}` }}
        role="img"
        aria-label={
          hasSpend
            ? `Twelve month cost trend. Total ${usd.format(total)}, peak month ${usd.format(peak)}.`
            : 'Twelve month cost trend. No spend recorded in this window.'
        }
      >
        {months.map(m => {
          // Proportion of the peak, floored at 2% so a small-but-real month is still
          // a visible mark. A true zero gets the 1px sliver below instead — the two
          // must not look alike.
          const pct = hasSpend && m.cost > 0
            ? Math.max(2, (m.cost / peak) * 100)
            : 0

          return (
            <div key={m.month} className="flex-1 min-w-0 flex flex-col justify-end h-full">
              <div
                title={`${monthTitle(m.month)} — ${usd.format(m.cost)}`}
                style={{
                  height:       m.cost > 0 ? `${pct}%` : '1px',
                  background:   m.cost > 0 ? color : RULE,
                  borderRadius: '2px 2px 0 0',
                  minHeight:    '1px',
                }}
              />
            </div>
          )
        })}
      </div>

      {/* Month labels ride in their own row on the same flex geometry so each one
          stays under its bar. Single letter on a phone, 'Jan' once there is room —
          twelve three-letter labels do not fit at 360px and truncating them to
          ellipses would read as a rendering bug. */}
      <div className="flex gap-[3px] sm:gap-1 mt-1">
        {months.map(m => {
          const label = monthLabel(m.month)
          return (
            <div key={m.month} className="flex-1 min-w-0 text-center" style={{ color: DIM }}>
              <span className="text-[10px] sm:hidden">{label.slice(0, 1)}</span>
              <span className="hidden sm:inline text-[10px]">{label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
