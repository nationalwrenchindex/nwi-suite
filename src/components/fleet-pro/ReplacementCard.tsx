'use client'

// ─── One replacement candidate, as a card ─────────────────────────────────────
//
// SELF-CONTAINED BY DESIGN. Every piece of data arrives through props and the only
// imports are the shared types and the brand palette, so this renders identically on
// the replacement page and inside the fleet dashboard without either surface having
// to pass a context, a fetcher or a store. Nothing here calls an API.
//
// ── THE WARNING TREATMENT ────────────────────────────────────────────────────
// Two levels, matching ReplacementLevel: 'urgent' (both rules fired) gets the red
// left rail and red heading, 'review' (one rule) gets amber. The level is computed
// server-side by classifyReplacement so this component never re-derives it — a card
// that disagreed with the PDF about the same truck would destroy the report's
// credibility in the one meeting it exists for.
//
// ── "VALUE NOT SET" IS A PROMPT, NOT A DASH ──────────────────────────────────
// A unit with no estimated_value has no cost ratio, so it reached this card on the
// breakdown rule alone. The card says so in words and, when the viewer may edit,
// offers the button that fixes it. Rendering a bare '—' there would read as "we
// looked and there was nothing", when the truth is "nobody has told us yet".

import type {
  ReplacementCandidate,
  ReplacementThresholds,
} from '@/types/fleet-pro-replacement'
import {
  formatDaysDown,
  formatMoney,
  replacementReason,
  unitLabel,
} from '@/types/fleet-pro-replacement'
import { NWI_ORANGE } from './brand'

const CARD   = '#111920'
const BORDER = '#1e3040'

// Status colours are literals here rather than brand tokens, for the reason stated in
// brand.tsx: urgent has to read as an alarm, and routing it through a brand palette
// invites someone to harmonise it later.
const URGENT = '#ef4444'
const REVIEW = '#F59E0B'

export interface ReplacementCardProps {
  /** The flagged unit. Produced by /api/fleet-pro/replacement. */
  candidate:  ReplacementCandidate
  /** The fleet's own thresholds, so the card can print the limit it was judged against. */
  thresholds: ReplacementThresholds
  /**
   * Optional. When given, the card renders a link to the unit — the dashboard passes
   * `/fleet-pro/units/${id}`. Omitted, the card renders no navigation at all.
   */
  href?:      string
  /**
   * Optional. When given, a "Set value" / "Update value" button appears and calls
   * back with the unit id. The PARENT owns the editing UI and the PUT; the card only
   * asks. Pass nothing for viewers and supervisors and the button never renders.
   */
  onSetValue?: (unitId: string) => void
  /**
   * Compact drops the secondary metrics and keeps the headline three, for a
   * dashboard tile where the card is a summary rather than the subject of the page.
   */
  compact?:   boolean
  className?: string
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
        {label}
      </p>
      <p className="font-condensed font-bold text-lg tabular-nums leading-tight" style={{ color: tone ?? '#fff' }}>
        {value}
      </p>
    </div>
  )
}

export default function ReplacementCard({
  candidate,
  thresholds,
  href,
  onSetValue,
  compact = false,
  className,
}: ReplacementCardProps) {
  const urgent = candidate.level === 'urgent'
  const accent = urgent ? URGENT : REVIEW
  const detail = unitLabel(candidate)
  const valueMissing = candidate.value_status === 'not_set'

  return (
    <article
      className={`rounded-xl overflow-hidden ${className ?? ''}`}
      style={{ background: CARD, border: `1px solid ${BORDER}`, borderLeft: `4px solid ${accent}` }}
    >
      <div className="p-4 space-y-3">
        {/* ── heading ── */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-condensed font-bold text-xl text-white leading-tight truncate">
              {href
                ? <a href={href} className="hover:underline">{candidate.unit_number || 'Unit'}</a>
                : (candidate.unit_number || 'Unit')}
            </h3>
            {detail && (
              <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>{detail}</p>
            )}
          </div>

          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full whitespace-nowrap"
            style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}55` }}
          >
            {urgent ? 'Urgent' : 'Review'}
          </span>
        </div>

        {/* ── why it is on the list ── */}
        <p className="text-xs leading-relaxed" style={{ color: accent }}>
          {replacementReason(candidate, thresholds)}
        </p>

        {/* ── the metrics the brief calls for ── */}
        <div className="grid grid-cols-3 gap-3">
          <Metric label="12-mo repairs" value={formatMoney(candidate.cost_12mo)} tone={NWI_ORANGE} />
          <Metric
            label="Est. value"
            value={valueMissing ? 'Not set' : formatMoney(candidate.estimated_value)}
            tone={valueMissing ? REVIEW : undefined}
          />
          <Metric
            label="% of value"
            value={candidate.cost_ratio_pct === null ? '—' : `${candidate.cost_ratio_pct.toFixed(0)}%`}
            tone={candidate.triggers.includes('cost_ratio') ? accent : undefined}
          />
        </div>

        {!compact && (
          <div className="grid grid-cols-3 gap-3">
            <Metric
              label="Breakdowns"
              value={String(candidate.breakdown_count)}
              tone={candidate.triggers.includes('breakdowns') ? accent : undefined}
            />
            <Metric label="Avg days down" value={formatDaysDown(candidate.avg_days_down)} />
            <Metric label="Billable events" value={String(candidate.repair_events)} />
          </div>
        )}

        {/* ── the honest footnotes ── */}
        {!compact && candidate.avg_days_down === null && candidate.breakdown_count > 0 && (
          <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
            No dated work orders behind these breakdowns, so downtime could not be measured.
          </p>
        )}

        {!compact
          && candidate.avg_days_down !== null
          && candidate.measured_downtime_events < candidate.breakdown_count && (
          <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Averaged over {candidate.measured_downtime_events} of {candidate.breakdown_count} breakdowns —
            the rest have no recorded dates.
          </p>
        )}

        {!compact && candidate.open_work_orders > 0 && (
          <p className="text-[11px]" style={{ color: REVIEW }}>
            {candidate.open_work_orders} work order{candidate.open_work_orders === 1 ? ' is' : 's are'} still
            open. This unit is counted as down right now, so its downtime is still growing.
          </p>
        )}

        {/* ── value prompt ── */}
        {valueMissing && (
          <div
            className="rounded-lg p-3 flex flex-wrap items-center justify-between gap-2"
            style={{ background: 'rgba(245,158,11,0.08)', border: `1px solid ${REVIEW}55` }}
          >
            <p className="text-xs" style={{ color: REVIEW }}>
              No estimated value on file — flagged on breakdown count alone. The cost test cannot
              run until someone sets what this unit is worth.
            </p>
            {onSetValue && (
              <button
                type="button"
                onClick={() => onSetValue(candidate.unit_id)}
                className="px-3 min-h-[36px] rounded-lg text-xs font-semibold text-white whitespace-nowrap"
                style={{ background: REVIEW }}
              >
                Set value
              </button>
            )}
          </div>
        )}

        {!valueMissing && onSetValue && !compact && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {candidate.value_updated_at ? `Value last set ${candidate.value_updated_at}` : 'Value set'}
            </p>
            <button
              type="button"
              onClick={() => onSetValue(candidate.unit_id)}
              className="px-3 min-h-[36px] rounded-lg text-xs font-medium whitespace-nowrap"
              style={{ color: 'rgba(255,255,255,0.6)', border: `1px solid ${BORDER}` }}
            >
              Update value
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

export { ReplacementCard }
