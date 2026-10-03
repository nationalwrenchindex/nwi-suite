'use client'

// ─── Model-specific PM items, on the unit detail page ─────────────────────────
//
// ITS OWN LIST, separate from the general PM schedule. hd_units.next_pm_due_hours
// is the shop's service interval for the whole unit; these are individual parts
// with their own clocks, and averaging them into one "PM due" figure is how a
// 4-month filter hides behind a 2,000-hour service.
//
// NOTHING HERE KNOWS WHAT A FUEL FILTER IS. The name, the part number, the
// interval and the reason are all row data from pm_items.

import { useEffect, useState, useCallback } from 'react'
import type { PmItem, UnitPmItemStatus, PmItemDue } from '@/lib/fleet-pro/pm-items'

interface Row {
  item:   PmItem
  status: UnitPmItemStatus | null
  due:    PmItemDue
}

// Never red for "never recorded" — that is an unknown, not a failure. Amber says
// "find out", which is the honest instruction.
const STATE_STYLE: Record<PmItemDue['state'], { color: string; bg: string; label: string }> = {
  overdue:        { color: '#f87171', bg: 'rgba(248,113,113,0.12)', label: 'Overdue' },
  due_soon:       { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)',  label: 'Due soon' },
  never_recorded: { color: '#fbbf24', bg: 'rgba(251,191,36,0.08)',  label: 'Never recorded' },
  ok:             { color: '#34d399', bg: 'rgba(52,211,153,0.10)',  label: 'OK' },
}

export default function PmItemsSection({ unitId, canEdit }: { unitId: string; canEdit: boolean }) {
  const [rows,    setRows]    = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [err,     setErr]     = useState<string | null>(null)
  const [msg,     setMsg]     = useState<string | null>(null)
  const [openWhy, setOpenWhy] = useState<string | null>(null)
  /** True when migration 144 has not been applied. Says so rather than showing nothing. */
  const [migrationPending, setMigrationPending] = useState(false)

  const load = useCallback(async () => {
    try {
      const res  = await fetch(`/api/fleet-pro/units/${unitId}/pm-items`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load PM items')
      setRows(Array.isArray(json.items) ? json.items : [])
      setMigrationPending(json.migration_pending === true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load PM items')
    }
    setLoading(false)
  }, [unitId])

  useEffect(() => { void load() }, [load])

  async function markComplete(row: Row) {
    setPending(true); setErr(null); setMsg(null)
    try {
      const res = await fetch(`/api/fleet-pro/units/${unitId}/pm-items`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // No date or hours sent: the route stamps today and the unit's current
        // meter, which is what "I just did this" means.
        body:    JSON.stringify({ pm_item_id: row.item.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not record it')
      setMsg(`${row.item.name} marked complete.`)
      setTimeout(() => setMsg(null), 4000)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not record it')
    }
    setPending(false)
  }

  // Nothing applies to this unit, and the migration IS applied: say nothing at all
  // rather than render an empty heading.
  if (!loading && rows.length === 0 && !migrationPending && !err) return null

  return (
    <section className="mb-8">
      <h2 className="font-condensed font-bold text-xl text-white tracking-wide mb-1">
        MODEL-SPECIFIC PM ITEMS
      </h2>
      <p className="text-white/35 text-xs mb-3">
        Parts with their own interval for this model. Tracked separately from the unit&apos;s
        service schedule.
      </p>

      {err && <div className="alert-error mb-3">{err}</div>}
      {msg && <div className="alert-success mb-3">{msg}</div>}

      {migrationPending && (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/50">
          Model-specific PM items need migration 144 applied before they appear here.
        </div>
      )}

      {loading && !migrationPending && (
        <p className="text-white/30 text-sm">Loading…</p>
      )}

      {rows.length > 0 && (
        <div className="rounded-xl border border-white/10 overflow-hidden">
          {rows.map(row => {
            const s = STATE_STYLE[row.due.state]
            return (
              <div key={row.item.id} className="border-b border-white/5 last:border-0">
                <div className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white text-sm font-medium">{row.item.name}</span>
                      {row.item.is_critical && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                              style={{ color: '#f87171', background: 'rgba(248,113,113,0.12)' }}>
                          Critical
                        </span>
                      )}
                      <span className="text-[10px] uppercase tracking-wider text-white/30">
                        {row.item.component_type}
                      </span>
                    </div>
                    {row.item.part_number && (
                      <p className="text-xs font-mono text-white/40 mt-0.5">{row.item.part_number}</p>
                    )}
                    {/* THE STATE NAMES THE REASON — "overdue by date" reads
                        differently to a tech than "overdue by hours". */}
                    <p className="text-xs mt-1" style={{ color: s.color }}>{row.due.label}</p>
                    <p className="text-[11px] text-white/30 mt-0.5">
                      {intervalText(row.item)}
                      {row.status?.last_completed_on
                        ? ` · last done ${row.status.last_completed_on}`
                        : ' · never recorded'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded"
                          style={{ color: s.color, background: s.bg }}>
                      {s.label}
                    </span>
                    {canEdit && (
                      <button
                        onClick={() => markComplete(row)}
                        disabled={pending}
                        className="text-xs text-orange hover:underline disabled:opacity-50"
                      >
                        Mark done
                      </button>
                    )}
                    {row.item.why && (
                      <button
                        onClick={() => setOpenWhy(openWhy === row.item.id ? null : row.item.id)}
                        className="text-xs text-white/40 hover:text-white/70"
                      >
                        {openWhy === row.item.id ? 'Hide why' : 'Why'}
                      </button>
                    )}
                  </div>
                </div>
                {/* The reason, in the words of someone who has seen it fail. For the
                    TECH — this is not customer-facing copy. */}
                {openWhy === row.item.id && row.item.why && (
                  <div className="px-4 pb-3 -mt-1">
                    <p className="text-xs text-white/60 leading-relaxed bg-white/5 rounded-lg px-3 py-2">
                      {row.item.why}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** "Every 4 months" / "Every 2,000 hrs" / "Every 2,000 hrs or 6 months". */
function intervalText(item: PmItem): string {
  const parts: string[] = []
  if (item.interval_hours  != null) parts.push(`${item.interval_hours.toLocaleString('en-US')} hrs`)
  if (item.interval_months != null) parts.push(`${item.interval_months} month${item.interval_months === 1 ? '' : 's'}`)
  if (parts.length === 0) return 'No interval set'
  // first_of_either is the only rule where both clocks run, so it is the only one
  // that says "or".
  return `Every ${parts.join(item.interval_rule === 'first_of_either' ? ' or ' : ', ')}`
}
