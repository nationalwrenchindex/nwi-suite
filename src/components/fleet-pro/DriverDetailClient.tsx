'use client'

// ─── Fleet Pro — driver detail ────────────────────────────────────────────────
// One person: who they are, what they inspected, what they fuelled, what has been
// logged against them, and a scorecard.
//
// THE RULE THIS SCREEN IS BUILT AROUND: every table behind it is empty on a new fleet,
// and the subject is a named human being. So nothing here renders a number it cannot
// defend. Scorecard metrics arrive as a discriminated union — a value or a reason —
// and the reason is printed. A "0%" where the truth is "no data" reads as a bad
// employee, and a manager may act on it.
//
// Nothing here classifies anything either. The scorecard math lives in
// src/lib/fleet-pro/scorecard.ts and the fuzzy-match decision in the detail route;
// if this file starts deciding what counts as a missed inspection, the screen and any
// future export will drift.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  INCIDENT_TYPES,
  INCIDENT_TYPE_COLORS,
  INCIDENT_TYPE_LABELS,
  INCIDENT_LIMITS,
  MATCHED_BY_NAME_NOTE,
  type DriverDetailPayload,
  type DriverIncident,
  type IncidentType,
  type Metric,
} from '@/types/fleet-pro-drivers'
import { NWI_BLUE, NWI_ORANGE } from './brand'

const CARD   = { background: '#111920', border: '1px solid #1e3040' }
const INPUT  = { background: '#162030', border: '1px solid #1e3040', color: '#fff' }
const STRIP  = '#162030'
const BORDER = '#1e3040'
const MUTED  = 'rgba(255,255,255,0.45)'
const FAINT  = 'rgba(255,255,255,0.28)'
const RED    = '#ef4444'
const GREEN  = '#22C55E'

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(`${s}T12:00:00`)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function money(n: number | null): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function num(n: number | null, digits = 1): string {
  return n == null ? '—' : n.toFixed(digits)
}

export default function DriverDetailClient({ driverId }: { driverId: string }) {
  const [data,    setData]    = useState<DriverDetailPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [note,    setNote]    = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res  = await fetch(`/api/fleet-pro/drivers/${driverId}/detail`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load this driver')
      setData(json as DriverDetailPayload)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this driver')
    } finally {
      setLoading(false)
    }
  }, [driverId])

  useEffect(() => { void load() }, [load])

  function flash(message: string) {
    setNote(message)
    window.setTimeout(() => setNote(null), 4000)
  }

  if (loading) {
    return <p className="text-sm py-16 text-center" style={{ color: MUTED }}>Loading driver…</p>
  }

  if (error || !data) {
    return (
      <div className="rounded-xl p-8 text-center" style={CARD}>
        <p className="text-sm mb-4" style={{ color: RED }}>{error ?? 'Driver not found'}</p>
        <Link href="/fleet-pro/compliance?tab=drivers" className="text-sm font-semibold" style={{ color: NWI_BLUE }}>
          ← Back to the roster
        </Link>
      </div>
    )
  }

  const { driver, scorecard, recent_unit: recent } = data

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <Link
          href="/fleet-pro/compliance?tab=drivers"
          className="text-xs uppercase tracking-widest"
          style={{ color: MUTED }}
        >
          ← Drivers
        </Link>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
            {driver.full_name}
          </h1>
          {!driver.active && (
            <span
              className="text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(255,255,255,0.06)', color: MUTED }}
            >
              Inactive
            </span>
          )}
        </div>
      </div>

      {note  && <p className="text-sm mb-4" style={{ color: GREEN }}>{note}</p>}
      {error && <p className="text-sm mb-4" style={{ color: RED }}>{error}</p>}

      {/* A single banner for the whole page rather than a badge per row: the caveat is
          about the join, not about any one record, and per-row asterisks trained
          nobody to read it. */}
      {data.has_name_matched_rows && (
        <div
          className="rounded-xl p-3 mb-4 text-xs"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#F59E0B' }}
        >
          {MATCHED_BY_NAME_NOTE}
        </div>
      )}

      {/* ── Scorecard ──────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <MetricCard
          label="Inspection rate"
          metric={scorecard.inspection_rate}
          format={v => `${v}%`}
          caption={scorecard.month_label}
        />
        <MetricCard
          label="Average MPG"
          metric={scorecard.avg_mpg}
          format={v => v.toFixed(1)}
          caption="Across all recorded fill-ups"
        />
        <div className="rounded-xl p-4" style={CARD}>
          <p className="text-[11px] uppercase tracking-widest mb-1" style={{ color: MUTED }}>
            Open incidents
          </p>
          <p
            className="text-3xl font-bold tabular-nums"
            style={{ color: scorecard.open_incidents > 0 ? RED : '#fff' }}
          >
            {scorecard.open_incidents}
          </p>
          <p className="text-[11px] mt-1" style={{ color: FAINT }}>
            {data.incidents.length} logged in total
          </p>
        </div>
      </div>

      {/* ── Details ────────────────────────────────────────────────────────── */}
      <section className="rounded-xl p-4 mb-6" style={CARD}>
        <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: MUTED }}>Driver details</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Phone"  value={driver.phone} />
          <Field label="Email"  value={driver.email} />
          <Field
            label="CDL number"
            value={driver.cdl_number}
            hint={driver.cdl_masked ? 'Masked for your role' : driver.cdl_state ?? null}
          />
          <Field label="CDL expires" value={fmtDate(driver.cdl_expires_on)} />
          <Field label="Medical card expires" value={fmtDate(driver.medical_card_expires_on)} />
          {/* NOT "assigned unit". No driver-to-unit assignment exists in the schema —
              fleet_pro_drivers has no assigned_unit_id and hd_units has no driver_id —
              so this is derived from the newest history row and labelled as such.
              Printing a derived value under an "Assigned" heading would invent a
              relationship the fleet never recorded. */}
          <div>
            <p className="text-[11px] uppercase tracking-widest mb-1" style={{ color: MUTED }}>
              Most recently operated
            </p>
            {recent ? (
              <Link href={`/fleet-pro/units/${recent.id}`} className="text-sm font-semibold" style={{ color: NWI_BLUE }}>
                {recent.unit_number ?? 'Unit'}
                <span className="font-normal" style={{ color: FAINT }}> · {fmtDate(recent.on)}</span>
              </Link>
            ) : (
              <p className="text-sm" style={{ color: FAINT }}>No record yet</p>
            )}
            <p className="text-[11px] mt-1" style={{ color: FAINT }}>
              Derived from history — unit assignment is not tracked
            </p>
          </div>
        </div>
        {driver.notes && (
          <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${BORDER}` }}>
            <p className="text-[11px] uppercase tracking-widest mb-1" style={{ color: MUTED }}>Notes</p>
            <p className="text-sm whitespace-pre-wrap" style={{ color: 'rgba(255,255,255,0.7)' }}>{driver.notes}</p>
          </div>
        )}
      </section>

      {/* ── Incidents ──────────────────────────────────────────────────────── */}
      <IncidentPanel
        driverId={driverId}
        incidents={data.incidents}
        canEdit={data.can_edit}
        onError={setError}
        onDone={async (message) => { flash(message); await load() }}
      />

      {/* ── Inspection history ─────────────────────────────────────────────── */}
      <section className="rounded-xl overflow-hidden mb-6" style={{ border: `1px solid ${BORDER}` }}>
        <div className="px-4 py-3" style={{ background: STRIP }}>
          <h2 className="text-xs uppercase tracking-widest" style={{ color: MUTED }}>
            Pre-trip inspections ({data.inspections.length})
          </h2>
        </div>
        {data.inspections.length === 0 ? (
          <div className="p-8 text-center" style={{ background: '#111920' }}>
            <p className="text-sm" style={{ color: MUTED }}>
              No pre-trip inspections recorded for this driver.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ background: '#111920' }}>
              <thead style={{ background: STRIP }}>
                <tr style={{ color: MUTED }}>
                  <Th>Date</Th><Th>Unit</Th><Th>Result</Th><Th>Defects</Th><Th>Odometer</Th>
                </tr>
              </thead>
              <tbody>
                {data.inspections.map(row => (
                  <tr key={row.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                    <Td>{fmtDate(row.inspection_date)}</Td>
                    <Td>
                      <Link href={`/fleet-pro/units/${row.unit_id}`} style={{ color: NWI_BLUE }}>
                        {row.unit_number ?? 'Unit'}
                      </Link>
                    </Td>
                    <Td>
                      <span style={{ color: row.overall_result === 'pass' ? GREEN : RED, fontWeight: 600 }}>
                        {row.overall_result === 'pass' ? 'Pass' : 'Fail'}
                      </span>
                    </Td>
                    <Td>{row.defect_count > 0 ? row.defect_count : '—'}</Td>
                    <Td>{row.odometer == null ? '—' : row.odometer.toLocaleString()}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Fuel history ───────────────────────────────────────────────────── */}
      <section className="rounded-xl overflow-hidden mb-6" style={{ border: `1px solid ${BORDER}` }}>
        <div className="px-4 py-3" style={{ background: STRIP }}>
          <h2 className="text-xs uppercase tracking-widest" style={{ color: MUTED }}>
            Fuel log ({data.fuel.length})
          </h2>
        </div>
        {/* Three distinct states, not two. "Fuel logging is not set up" and "this
            driver has never fuelled" look identical as an empty table and mean
            completely different things to a manager. */}
        {!data.fuel_log_available ? (
          <div className="p-8 text-center" style={{ background: '#111920' }}>
            <p className="text-sm" style={{ color: MUTED }}>
              Fuel logging is not enabled on this fleet yet.
            </p>
          </div>
        ) : data.fuel.length === 0 ? (
          <div className="p-8 text-center" style={{ background: '#111920' }}>
            <p className="text-sm" style={{ color: MUTED }}>
              No fuel records for this driver yet.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ background: '#111920' }}>
              <thead style={{ background: STRIP }}>
                <tr style={{ color: MUTED }}>
                  <Th>Date</Th><Th>Unit</Th><Th>Gallons</Th><Th>Cost</Th><Th>$/gal</Th><Th>Miles</Th><Th>MPG</Th>
                </tr>
              </thead>
              <tbody>
                {data.fuel.map(row => (
                  <tr key={row.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                    <Td>{fmtDate(row.fuel_date)}</Td>
                    <Td>
                      <Link href={`/fleet-pro/units/${row.unit_id}`} style={{ color: NWI_BLUE }}>
                        {row.unit_number ?? 'Unit'}
                      </Link>
                    </Td>
                    <Td>{num(row.gallons)}</Td>
                    <Td>{money(row.total_cost)}</Td>
                    <Td>{row.price_per_gallon == null ? '—' : `$${row.price_per_gallon.toFixed(3)}`}</Td>
                    <Td>{row.miles_driven == null ? '—' : row.miles_driven.toLocaleString()}</Td>
                    <Td>
                      <span style={{ fontWeight: 600, color: '#fff' }}>{num(row.mpg)}</span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 text-left text-xs uppercase tracking-wider">{children}</th>
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3" style={{ color: 'rgba(255,255,255,0.7)' }}>{children}</td>
}

function Field({ label, value, hint }: { label: string; value: string | null; hint?: string | null }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-widest mb-1" style={{ color: MUTED }}>{label}</p>
      <p className="text-sm" style={{ color: value ? 'rgba(255,255,255,0.85)' : FAINT }}>{value ?? '—'}</p>
      {hint && <p className="text-[11px] mt-1" style={{ color: FAINT }}>{hint}</p>}
    </div>
  )
}

/**
 * A scorecard tile that refuses to invent a number.
 *
 * The `available: false` arm prints the reason in place of the figure, at the same
 * size as body text rather than as a big grey zero — the visual weight has to say
 * "there is nothing here", not "the score is nothing".
 */
function MetricCard({
  label, metric, format, caption,
}: {
  label:   string
  metric:  Metric
  format:  (value: number) => string
  caption: string
}) {
  return (
    <div className="rounded-xl p-4" style={CARD}>
      <p className="text-[11px] uppercase tracking-widest mb-1" style={{ color: MUTED }}>{label}</p>
      {metric.available ? (
        <>
          <p className="text-3xl font-bold tabular-nums text-white">{format(metric.value)}</p>
          <p className="text-[11px] mt-1" style={{ color: FAINT }}>{metric.detail ?? caption}</p>
        </>
      ) : (
        <>
          <p className="text-sm mt-2" style={{ color: MUTED }}>Not enough data</p>
          <p className="text-[11px] mt-1" style={{ color: FAINT }}>{metric.reason}</p>
        </>
      )}
    </div>
  )
}

const EMPTY_INCIDENT = { incident_type: 'complaint' as IncidentType, incident_date: '', description: '' }

function IncidentPanel({
  driverId, incidents, canEdit, onError, onDone,
}: {
  driverId:  string
  incidents: DriverIncident[]
  canEdit:   boolean
  onError:   (message: string | null) => void
  onDone:    (message: string) => Promise<void>
}) {
  const [draft,  setDraft]  = useState({ ...EMPTY_INCIDENT })
  const [adding, setAdding] = useState(false)
  const [busy,   setBusy]   = useState(false)

  async function add() {
    if (!draft.description.trim()) { onError('An incident needs a description.'); return }
    setBusy(true)
    onError(null)
    try {
      const res = await fetch(`/api/fleet-pro/drivers/${driverId}/incidents`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(draft),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not log the incident')
      setDraft({ ...EMPTY_INCIDENT })
      setAdding(false)
      await onDone('Incident logged.')
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not log the incident')
    } finally {
      setBusy(false)
    }
  }

  async function setResolved(incident: DriverIncident, resolved: boolean) {
    setBusy(true)
    onError(null)
    try {
      const res = await fetch(`/api/fleet-pro/drivers/${driverId}/incidents/${incident.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ resolved }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Update failed')
      await onDone(resolved ? 'Marked resolved.' : 'Re-opened.')
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl p-4 mb-6" style={CARD}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-widest" style={{ color: MUTED }}>
          Incidents &amp; complaints ({incidents.length})
        </h2>
        {canEdit && (
          <button
            onClick={() => setAdding(a => !a)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: adding ? 'rgba(255,255,255,0.08)' : NWI_ORANGE, color: '#fff' }}
          >
            {adding ? 'Cancel' : 'Log incident'}
          </button>
        )}
      </div>

      {adding && canEdit && (
        <div className="rounded-lg p-3 mb-4" style={{ background: STRIP, border: `1px solid ${BORDER}` }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[11px] uppercase tracking-widest" style={{ color: MUTED }}>
              Type
              <select
                value={draft.incident_type}
                onChange={e => setDraft(d => ({ ...d, incident_type: e.target.value as IncidentType }))}
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm normal-case tracking-normal"
                style={INPUT}
              >
                {INCIDENT_TYPES.map(t => (
                  <option key={t} value={t}>{INCIDENT_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </label>
            <label className="text-[11px] uppercase tracking-widest" style={{ color: MUTED }}>
              Date
              <input
                type="date"
                value={draft.incident_date}
                onChange={e => setDraft(d => ({ ...d, incident_date: e.target.value }))}
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm normal-case tracking-normal"
                style={INPUT}
              />
            </label>
          </div>
          <label className="block mt-3 text-[11px] uppercase tracking-widest" style={{ color: MUTED }}>
            What happened
            <textarea
              rows={3}
              maxLength={INCIDENT_LIMITS.description}
              value={draft.description}
              onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
              className="mt-1 w-full rounded-lg px-3 py-2 text-sm normal-case tracking-normal"
              style={INPUT}
            />
          </label>
          <button
            onClick={() => void add()}
            disabled={busy}
            className="mt-3 px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ background: NWI_BLUE, color: '#fff', opacity: busy ? 0.5 : 1 }}
          >
            {busy ? 'Saving…' : 'Save incident'}
          </button>
        </div>
      )}

      {incidents.length === 0 ? (
        <p className="text-sm py-6 text-center" style={{ color: MUTED }}>
          Nothing logged against this driver.
        </p>
      ) : (
        <ul className="space-y-3">
          {incidents.map(incident => (
            <li
              key={incident.id}
              className="rounded-lg p-3"
              style={{ background: STRIP, border: `1px solid ${BORDER}`, opacity: incident.resolved ? 0.6 : 1 }}
            >
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span
                  className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                  style={{
                    background: `${INCIDENT_TYPE_COLORS[incident.incident_type]}20`,
                    color:      INCIDENT_TYPE_COLORS[incident.incident_type],
                  }}
                >
                  {INCIDENT_TYPE_LABELS[incident.incident_type]}
                </span>
                <span className="text-xs" style={{ color: MUTED }}>{fmtDate(incident.incident_date)}</span>
                {incident.resolved && (
                  <span className="text-[11px] font-semibold" style={{ color: GREEN }}>Resolved</span>
                )}
              </div>
              <p className="text-sm whitespace-pre-wrap" style={{ color: 'rgba(255,255,255,0.8)' }}>
                {incident.description}
              </p>
              {incident.resolution_notes && (
                <p className="text-xs mt-2 pt-2 whitespace-pre-wrap" style={{ color: MUTED, borderTop: `1px solid ${BORDER}` }}>
                  {incident.resolution_notes}
                </p>
              )}
              {canEdit && (
                <button
                  onClick={() => void setResolved(incident, !incident.resolved)}
                  disabled={busy}
                  className="mt-2 text-xs font-semibold"
                  style={{ color: incident.resolved ? MUTED : GREEN, opacity: busy ? 0.5 : 1 }}
                >
                  {incident.resolved ? 'Re-open' : 'Mark resolved'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
