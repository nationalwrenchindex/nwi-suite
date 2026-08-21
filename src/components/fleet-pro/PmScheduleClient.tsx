'use client'

import { useCallback, useEffect, useState } from 'react'
import type { FleetProRole, PmScheduleRow, PmState } from '@/types/fleet-pro'
import { canManagePmSchedules } from '@/types/fleet-pro'
import { FleetProWordmark, NWI_ORANGE } from './brand'

const FP_ORANGE = NWI_ORANGE
const RED       = '#ef4444'
const GREEN     = '#22C55E'
const MUTED     = 'rgba(255,255,255,0.4)'

const STATE_COLOR: Record<PmState, string> = {
  overdue:     RED,
  due_soon:    FP_ORANGE,
  scheduled:   GREEN,
  unscheduled: MUTED,
}

const STATE_LABEL: Record<PmState, string> = {
  overdue:     'OVERDUE',
  due_soon:    'DUE SOON',
  scheduled:   'SCHEDULED',
  unscheduled: 'NOT SCHEDULED',
}

const inputStyle = { background: '#162030', border: '1px solid #1e3040', color: '#fff' }

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(`${s}T12:00:00`)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function dueNote(row: PmScheduleRow): string | null {
  if (row.days_until_due == null) return null
  const d = row.days_until_due
  if (d < 0)   return `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} overdue`
  if (d === 0) return 'due today'
  return `in ${d} day${d === 1 ? '' : 's'}`
}

interface Draft { interval: string; lastService: string }

export default function PmScheduleClient({ role }: { role: FleetProRole }) {
  const canManage = canManagePmSchedules(role)

  const [rows,    setRows]    = useState<PmScheduleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [drafts,  setDrafts]  = useState<Record<string, Draft>>({})
  const [busy,    setBusy]    = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/fleet-pro/pm-schedules')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load PM schedules')
      const list = (json.schedules ?? []) as PmScheduleRow[]
      setRows(list)
      setDrafts(Object.fromEntries(list.map(r => [r.unit_id, {
        interval:    r.interval_days ? String(r.interval_days) : '',
        lastService: r.last_service_date ?? '',
      }])))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load PM schedules')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function setDraft(unitId: string, patch: Partial<Draft>) {
    setDrafts(prev => ({ ...prev, [unitId]: { ...(prev[unitId] ?? { interval: '', lastService: '' }), ...patch } }))
  }

  async function save(row: PmScheduleRow) {
    const draft = drafts[row.unit_id] ?? { interval: '', lastService: '' }
    const interval = Number(draft.interval)
    if (!Number.isInteger(interval) || interval < 1 || interval > 3650) {
      setError(`Unit ${row.unit_number}: interval must be a whole number of days between 1 and 3650.`)
      return
    }

    setBusy(row.unit_id)
    setError(null)
    try {
      const hasSchedule = !!row.id
      const res = hasSchedule
        ? await fetch(`/api/fleet-pro/pm-schedules/${row.id}`, {
            method:  'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              interval_days:     interval,
              last_service_date: draft.lastService || null,
            }),
          })
        : await fetch('/api/fleet-pro/pm-schedules', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              unit_id:           row.unit_id,
              interval_days:     interval,
              last_service_date: draft.lastService || null,
            }),
          })

      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')

      setSavedId(row.unit_id)
      setTimeout(() => setSavedId(null), 2500)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(null)
    }
  }

  async function remove(row: PmScheduleRow) {
    if (!row.id) return
    setBusy(row.unit_id)
    setError(null)
    try {
      const res = await fetch(`/api/fleet-pro/pm-schedules/${row.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Delete failed')
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusy(null)
    }
  }

  const overdue  = rows.filter(r => r.pm_state === 'overdue').length
  const dueSoon  = rows.filter(r => r.pm_state === 'due_soon').length
  const unsched  = rows.filter(r => r.pm_state === 'unscheduled').length

  const th = 'px-4 py-3 text-left text-xs uppercase tracking-wider'

  return (
    <div className="max-w-7xl mx-auto w-full">
      <div className="mb-5">
        <FleetProWordmark className="block text-xs uppercase tracking-widest mb-1 font-semibold" />
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">PM SCHEDULE</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
          Calendar-based preventive maintenance. Managers and supervisors are emailed
          once when a unit comes within 30 days of its due date.
        </p>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Overdue',       value: overdue, color: RED },
          { label: 'Due in 30 Days', value: dueSoon, color: FP_ORANGE },
          { label: 'Unscheduled',   value: unsched, color: MUTED },
        ].map(card => (
          <div key={card.label} className="rounded-xl p-4" style={{ background: '#111920', border: '1px solid #1e3040' }}>
            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{card.label}</p>
            <p className="font-condensed font-bold text-2xl" style={{ color: card.color }}>{card.value}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3 mb-4 text-sm" style={{ background: 'rgba(239,68,68,0.12)', border: `1px solid ${RED}`, color: RED }}>
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Loading PM schedules…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
            No units on this fleet account yet. Your maintenance contractor adds units as they come into service.
          </p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ background: '#111920' }}>
              <thead style={{ background: '#162030' }}>
                <tr style={{ color: 'rgba(255,255,255,0.4)' }}>
                  <th className={th}>Unit</th>
                  <th className={th}>Interval</th>
                  <th className={th}>Last Service</th>
                  <th className={th}>Next Due</th>
                  <th className={th}>Status</th>
                  {canManage && <th className={th}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const draft = drafts[row.unit_id] ?? { interval: '', lastService: '' }
                  const rowBusy = busy === row.unit_id
                  return (
                    <tr key={row.unit_id} style={{ borderTop: '1px solid #1e3040' }}>
                      <td className="px-4 py-3 font-semibold text-white whitespace-nowrap">{row.unit_number}</td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        {canManage ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              max={3650}
                              value={draft.interval}
                              onChange={e => setDraft(row.unit_id, { interval: e.target.value })}
                              placeholder="days"
                              className="w-24 px-2 py-1.5 rounded-lg text-sm"
                              style={inputStyle}
                            />
                            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>days</span>
                          </div>
                        ) : (
                          <span style={{ color: row.interval_days ? 'rgba(255,255,255,0.75)' : MUTED }}>
                            {row.interval_days ? `${row.interval_days} days` : '—'}
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        {canManage ? (
                          <input
                            type="date"
                            value={draft.lastService}
                            onChange={e => setDraft(row.unit_id, { lastService: e.target.value })}
                            className="px-2 py-1.5 rounded-lg text-sm"
                            style={inputStyle}
                          />
                        ) : (
                          <span style={{ color: 'rgba(255,255,255,0.75)' }}>{fmtDate(row.last_service_date)}</span>
                        )}
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <span style={{ color: row.next_due_date ? 'rgba(255,255,255,0.85)' : MUTED }}>
                          {fmtDate(row.next_due_date)}
                        </span>
                        {dueNote(row) && (
                          <span className="block text-xs" style={{ color: STATE_COLOR[row.pm_state] }}>
                            {dueNote(row)}
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className="inline-block text-xs font-bold px-2.5 py-1 rounded-full tracking-wide"
                          style={{
                            color: STATE_COLOR[row.pm_state],
                            background: row.pm_state === 'unscheduled'
                              ? 'rgba(255,255,255,0.06)'
                              : `${STATE_COLOR[row.pm_state]}20`,
                          }}
                        >
                          {STATE_LABEL[row.pm_state]}
                        </span>
                      </td>

                      {canManage && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void save(row)}
                              disabled={rowBusy}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide disabled:opacity-50"
                              style={{ background: FP_ORANGE, color: '#fff' }}
                            >
                              {rowBusy ? 'Saving…' : row.id ? 'Save' : 'Schedule'}
                            </button>
                            {row.id && (
                              <button
                                type="button"
                                onClick={() => void remove(row)}
                                disabled={rowBusy}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}
                              >
                                Clear
                              </button>
                            )}
                            {savedId === row.unit_id && (
                              <span className="text-xs font-semibold" style={{ color: GREEN }}>Saved</span>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!canManage && !loading && rows.length > 0 && (
        <p className="text-xs mt-3" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Read-only. Ask your fleet manager to change a PM interval.
        </p>
      )}
    </div>
  )
}
