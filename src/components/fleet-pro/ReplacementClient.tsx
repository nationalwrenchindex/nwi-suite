'use client'

// ─── Fleet Pro — the replacement recommendation list ──────────────────────────
//
// The page a fleet manager opens before a budget meeting: which units have crossed
// the line from "worth fixing" to "worth replacing", why, and what it has cost to
// keep them running.
//
// ── THIS COMPONENT OWNS THE EDITING, THE CARD DOES NOT ───────────────────────
// ReplacementCard is deliberately data-only so the orchestrator can drop it into the
// dashboard. The dialog that types an estimated value, and the PUT behind it, live
// here; the card merely reports that a value is missing and calls back. That keeps
// exactly one implementation of the write on the client no matter how many surfaces
// render a card.
//
// ── WHY THE WHOLE REPORT RELOADS AFTER A VALUE IS SAVED ──────────────────────
// Setting a value can change the answer: a unit flagged on breakdowns alone may now
// also trip the cost rule and become urgent, and a unit that was not on the list at
// all may appear. Patching the one row in local state would leave a list that is
// quietly out of date with its own rule, so the report is re-fetched.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReplacementReport } from '@/types/fleet-pro-replacement'
import { formatMoney } from '@/types/fleet-pro-replacement'
import ReplacementCard from './ReplacementCard'
import { FleetProWordmark, NWI_ORANGE } from './brand'

const CARD   = '#111920'
const BORDER = '#1e3040'
const REVIEW = '#F59E0B'
const URGENT = '#ef4444'

interface Payload {
  report:          ReplacementReport
  can_edit_values: boolean
}

/** The unit currently being valued, plus whatever the manager has typed so far. */
interface ValueEdit {
  unitId:     string
  unitNumber: string
  current:    number | null
  input:      string
}

export default function ReplacementClient() {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const [edit,       setEdit]       = useState<ValueEdit | null>(null)
  const [saving,     setSaving]     = useState(false)
  const [saveError,  setSaveError]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/fleet-pro/replacement')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Could not load the replacement report.')
      setPayload(json as Payload)
    } catch (err) {
      setPayload(null)
      setError(err instanceof Error ? err.message : 'Could not load the replacement report.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const report   = payload?.report ?? null
  const canEdit  = payload?.can_edit_values ?? false

  // Every unit the manager could be asked to value: the flagged ones missing a value
  // and the un-flagged ones. Built once so the dialog can open from either list.
  const unitNumberById = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of report?.candidates ?? []) map.set(c.unit_id, c.unit_number)
    for (const m of report?.missing_value ?? []) map.set(m.unit_id, m.unit_number)
    return map
  }, [report])

  const valueById = useMemo(() => {
    const map = new Map<string, number | null>()
    for (const c of report?.candidates ?? []) map.set(c.unit_id, c.estimated_value)
    return map
  }, [report])

  const openEdit = useCallback((unitId: string) => {
    const current = valueById.get(unitId) ?? null
    setSaveError(null)
    setEdit({
      unitId,
      unitNumber: unitNumberById.get(unitId) ?? 'Unit',
      current,
      input:      current === null ? '' : String(current),
    })
  }, [unitNumberById, valueById])

  async function saveValue() {
    if (!edit) return
    setSaving(true)
    setSaveError(null)
    try {
      const trimmed = edit.input.trim()
      const res = await fetch(`/api/fleet-pro/units/${edit.unitId}/value`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        // An empty box clears the value rather than being rejected — the route treats
        // null as a real action, so a mistyped price can be taken back.
        body: JSON.stringify({ estimated_value: trimmed === '' ? null : trimmed }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Could not save that value.')
      setEdit(null)
      await load()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save that value.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* ── header ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <FleetProWordmark className="block text-xs uppercase tracking-widest mb-1 font-semibold" />
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
            REPLACEMENT REVIEW
          </h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Units whose repair spend or breakdown record says it is time to price a replacement.
          </p>
        </div>

        {/* A plain link, not a fetch: the route replies with a file, and letting the
            browser handle the download avoids holding the PDF in memory twice. */}
        <a
          href="/api/fleet-pro/replacement/pdf"
          className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white"
          style={{ background: NWI_ORANGE, opacity: report ? 1 : 0.5, pointerEvents: report ? 'auto' : 'none' }}
        >
          Export PDF
        </a>
      </div>

      {error && (
        <div className="rounded-xl p-4" style={{ background: CARD, border: '1px solid #7f1d1d' }}>
          <p className="text-sm" style={{ color: '#F87171' }}>{error}</p>
        </div>
      )}

      {loading && !error && (
        <div className="rounded-xl p-8 text-center" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Reviewing the fleet…</p>
        </div>
      )}

      {report && !loading && !error && (
        <>
          {/* ── summary tiles ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Units reviewed', value: String(report.unit_count) },
              { label: 'Flagged',        value: String(report.candidate_count), tone: report.candidate_count > 0 ? REVIEW : undefined },
              { label: 'Urgent',         value: String(report.urgent_count),    tone: report.urgent_count > 0 ? URGENT : undefined },
              { label: 'Their 12-mo spend', value: formatMoney(report.candidate_spend), tone: NWI_ORANGE },
            ].map(tile => (
              <div key={tile.label} className="rounded-xl p-4" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
                <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  {tile.label}
                </p>
                <p className="font-condensed font-bold text-xl tabular-nums" style={{ color: tile.tone ?? '#fff' }}>
                  {tile.value}
                </p>
              </div>
            ))}
          </div>

          {/* ── the rule, printed where the manager can see it ──
              Somebody will ask why a truck is on the list, and the thresholds are
              per-fleet, so the answer has to be on the page rather than in a settings
              screen nobody present can open. */}
          <div className="rounded-xl p-4" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Rolling {report.window_months} months from {report.window_start}. A unit is flagged when
              its repairs exceed <strong style={{ color: '#fff' }}>{report.thresholds.cost_ratio_pct}%</strong> of
              its estimated value, or it has had <strong style={{ color: '#fff' }}>{report.thresholds.breakdown_min}</strong> or
              more breakdowns. Both rules firing reads as urgent.
            </p>
          </div>

          {/* ── candidates ── */}
          {report.candidates.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
                No unit crossed either threshold in this window.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {report.candidates.map(c => (
                <ReplacementCard
                  key={c.unit_id}
                  candidate={c}
                  thresholds={report.thresholds}
                  href={`/fleet-pro/units/${c.unit_id}`}
                  onSetValue={canEdit ? openEdit : undefined}
                />
              ))}
            </div>
          )}

          {/* ── units the cost rule could not reach ──
              Shown even though they are not candidates. A report that silently
              evaluated half the fleet is worse than one that names the half it
              could not reach. */}
          {report.missing_value.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ background: CARD, border: `1px solid ${REVIEW}55` }}>
              <div className="p-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <h2 className="font-condensed font-bold text-lg" style={{ color: REVIEW }}>
                  NO ESTIMATED VALUE ON FILE ({report.missing_value_count})
                </h2>
                <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  The cost-vs-value rule could not be applied to these units — their breakdown counts
                  were still checked. {canEdit
                    ? 'Set a value to bring them into the cost test.'
                    : 'A fleet manager can set a value to bring them into the cost test.'}
                </p>
              </div>

              <ul>
                {report.missing_value.map(u => (
                  <li
                    key={u.unit_id}
                    className="px-4 py-3 flex items-center justify-between gap-3"
                    style={{ borderBottom: `1px solid ${BORDER}` }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{u.unit_number || 'Unit'}</p>
                      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        {formatMoney(u.cost_12mo)} in repairs over the window
                      </p>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => openEdit(u.unit_id)}
                        className="px-3 min-h-[36px] rounded-lg text-xs font-semibold text-white whitespace-nowrap"
                        style={{ background: REVIEW }}
                      >
                        Set value
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* ── value dialog ── */}
      {edit && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => { if (!saving) setEdit(null) }}
        >
          <div
            className="w-full max-w-md rounded-xl p-5 space-y-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
            onClick={e => e.stopPropagation()}
          >
            <div>
              <h2 className="font-condensed font-bold text-xl text-white">ESTIMATED VALUE</h2>
              <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {edit.unitNumber} — what you believe this unit is worth today. It is the denominator
                of the repair-cost ratio, and it is your figure, not a book value.
              </p>
            </div>

            <label className="block text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Value (USD)
              <input
                type="number"
                min="0"
                step="100"
                inputMode="decimal"
                autoFocus
                value={edit.input}
                onChange={e => setEdit({ ...edit, input: e.target.value })}
                placeholder="e.g. 42000"
                className="block w-full mt-1 px-3 py-2.5 rounded-lg text-sm text-white"
                style={{ background: '#0a0f14', border: `1px solid ${BORDER}` }}
              />
            </label>

            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Leave the box empty to clear the value.
            </p>

            {saveError && (
              <p className="text-sm" style={{ color: '#F87171' }}>{saveError}</p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setEdit(null)}
                className="px-4 min-h-[44px] rounded-lg text-sm font-medium"
                style={{ color: 'rgba(255,255,255,0.6)', border: `1px solid ${BORDER}` }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={saveValue}
                className="px-4 min-h-[44px] rounded-lg text-sm font-semibold text-white"
                style={{ background: NWI_ORANGE, opacity: saving ? 0.5 : 1 }}
              >
                {saving ? 'Saving…' : 'Save value'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
