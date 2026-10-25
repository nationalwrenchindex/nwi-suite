'use client'

// Financials "By Equipment" - spec section 5. Two tables on one view, per category and
// per unit, over a date range that defaults to the current year in the shop's zone.
//
// Every figure comes from GET /api/hd/financials/equipment, which hands over the rollup
// from equipment-rollup.ts untouched. This component adds nothing up: it filters, sorts
// and prints, through the pure helpers in by-equipment-view.ts. Unknown prints "-", a
// partial sum carries a dagger and says how many jobs it lacks, and invoiced and
// collected stay in their own columns.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { NO_UNIT, type CategoryRollup, type DateRange, type PartialSum, type UnitRollup } from '@/lib/hd/equipment-rollup'
import {
  ALL, DAGGER, DEFAULT_FILTER, DEFAULT_SORT,
  auditHref, categoryOptions, filterUnits, fleetOptions, fmtDay, fmtMoney, nextSort,
  partialCell, sortUnits, sourceBadge, sourceNote, unitLabel,
  type UnitFilter, type UnitSort, type UnitSortKey,
} from '@/lib/hd/by-equipment-view'

const HD_ORANGE = '#E85D24'

interface EquipmentResponse {
  range: DateRange
  timeZone: string
  categories: CategoryRollup[]
  units: UnitRollup[]
  fleets: { id: string; name: string }[]
  jobsCount: number
  jobsFromInvoices: number
  jobsFromWorkOrders: number
}

const muted = (a: number) => ({ color: `rgba(var(--hd-ink-rgb), ${a})` })
const card = { background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }

function PartialTd({ p, kind }: { p: PartialSum; kind: 'money' | 'hours' }) {
  const c = partialCell(p, kind)
  return (
    <td className="px-3 py-2.5 text-right whitespace-nowrap" title={c.note ?? undefined}>
      <span className="text-white">{c.text}</span>
      {c.partial && <span style={{ color: 'var(--hd-accent-text)' }}>{DAGGER}</span>}
      {c.partial && c.note && <span className="block text-[10px]" style={muted(0.35)}>{c.note}</span>}
    </td>
  )
}

function Th({ children, right = false }: { children: ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 text-[10px] uppercase tracking-widest font-semibold whitespace-nowrap ${right ? 'text-right' : 'text-left'}`} style={muted(0.4)}>
      {children}
    </th>
  )
}

function SortTh({ label, k, sort, onSort, right = false }: {
  label: string; k: UnitSortKey; sort: UnitSort; onSort: (k: UnitSortKey) => void; right?: boolean
}) {
  const active = sort.key === k
  return (
    <th className={`px-3 py-2 whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className="text-[10px] uppercase tracking-widest font-semibold"
        style={active ? { color: 'var(--hd-accent-text)' } : muted(0.4)}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  )
}

export default function ByEquipmentTab() {
  const [data,    setData]    = useState<EquipmentResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  // The inputs. Empty until the first response, which fills them with the shop-zone
  // current year the server chose - the browser's zone is not the shop's.
  const [from, setFrom] = useState('')
  const [to,   setTo]   = useState('')
  const [sort,   setSort]   = useState<UnitSort>(DEFAULT_SORT)
  const [filter, setFilter] = useState<UnitFilter>(DEFAULT_FILTER)

  const load = useCallback((range: DateRange | null) => {
    setLoading(true)
    setError(null)
    const qs = range ? `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : ''
    fetch(`/api/hd/financials/equipment${qs}`)
      .then(async r => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body?.error ? `${body.error}${body.detail ? ` (${body.detail})` : ''}` : `Request failed (${r.status})`)
        return body as EquipmentResponse
      })
      .then(d => {
        setData(d)
        setFrom(d.range.from)
        setTo(d.range.to)
        setFilter(DEFAULT_FILTER)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(null) }, [load])

  const catOpts   = useMemo(() => (data ? categoryOptions(data.units, data.categories) : []), [data])
  const fleetOpts = useMemo(() => (data ? fleetOptions(data.units) : []), [data])
  const unitRows  = useMemo(() => (data ? sortUnits(filterUnits(data.units, filter), sort) : []), [data, filter, sort])

  const range = data?.range ?? { from, to }

  return (
    <div className="space-y-5">
      {/* Range + audit link */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs" style={muted(0.5)}>
          From
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="block mt-1 px-2 py-1.5 rounded-lg text-sm text-white" style={card} />
        </label>
        <label className="text-xs" style={muted(0.5)}>
          To
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="block mt-1 px-2 py-1.5 rounded-lg text-sm text-white" style={card} />
        </label>
        <button type="button" onClick={() => load({ from, to })} disabled={!from || !to || loading}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-on-accent disabled:opacity-50" style={{ background: HD_ORANGE }}>
          Apply
        </button>
        <button type="button" onClick={() => load(null)} disabled={loading}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50" style={{ ...muted(0.6), border: '1px solid var(--hd-border)' }}>
          This year
        </button>
        <Link href={auditHref(range)} className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{ color: 'var(--hd-accent-text)', border: `1px solid ${HD_ORANGE}` }}>
          Audit export for this range
        </Link>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ ...card, color: 'var(--hd-negative)' }}>
          By Equipment could not load: {error}
        </div>
      )}

      {loading && !data && <div className="h-40 animate-pulse rounded-xl" style={{ background: 'var(--hd-card)' }} />}

      {data && (
        <>
          <p className="text-xs" style={muted(0.5)}>
            {fmtDay(data.range.from)} to {fmtDay(data.range.to)} ({data.timeZone})
            {' · '}{data.jobsCount} job{data.jobsCount === 1 ? '' : 's'}
            {data.jobsCount > 0 && <> ({sourceNote(data)})</>}
            {loading && ' · refreshing…'}
          </p>

          {/* Per category */}
          <section className="space-y-2">
            <h2 className="font-condensed font-bold text-lg text-white tracking-wide">BY CATEGORY</h2>
            {data.categories.length === 0 ? (
              <div className="py-10 text-center rounded-xl text-sm" style={{ ...card, ...muted(0.3) }}>No jobs or units in this range</div>
            ) : (
              <div className="rounded-xl overflow-x-auto" style={card}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--hd-border)' }}>
                      <Th>Category</Th><Th right>Units serviced</Th><Th right>Jobs</Th><Th right>Labor hours</Th>
                      <Th right>Labor revenue</Th><Th right>Parts revenue</Th><Th right>Other (fees)</Th>
                      <Th right>Total invoiced</Th><Th right>Collected</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.categories.map(c => (
                      <tr key={c.key} style={{ borderTop: '1px solid var(--hd-border)' }}>
                        <td className="px-3 py-2.5 text-white whitespace-nowrap">
                          {c.name}
                          {!c.isActive && <span className="ml-1 text-[10px]" style={muted(0.35)}>(inactive)</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right text-white">{c.key === NO_UNIT ? '-' : c.unitsServiced}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap" title={sourceNote(c)}>
                          <span className="text-white">{c.jobs}</span>
                          {c.jobs > 0 && <span className="block text-[10px]" style={muted(0.35)}>{sourceBadge(c)}</span>}
                        </td>
                        <PartialTd p={c.laborHours} kind="hours" />
                        <PartialTd p={c.laborRevenue} kind="money" />
                        <PartialTd p={c.partsRevenue} kind="money" />
                        <PartialTd p={c.other} kind="money" />
                        <td className="px-3 py-2.5 text-right text-white whitespace-nowrap">{fmtMoney(c.invoiced)}</td>
                        <PartialTd p={c.collected} kind="money" />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Per unit */}
          <section className="space-y-2">
            <div className="flex flex-wrap items-end gap-3">
              <h2 className="font-condensed font-bold text-lg text-white tracking-wide mr-auto">BY UNIT</h2>
              <label className="text-xs" style={muted(0.5)}>
                Category
                <select value={filter.categoryKey} onChange={e => setFilter(f => ({ ...f, categoryKey: e.target.value }))}
                  className="block mt-1 px-2 py-1.5 rounded-lg text-sm text-white" style={card}>
                  <option value={ALL}>All categories</option>
                  {catOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="text-xs" style={muted(0.5)}>
                Fleet account
                <select value={filter.fleetId} onChange={e => setFilter(f => ({ ...f, fleetId: e.target.value }))}
                  className="block mt-1 px-2 py-1.5 rounded-lg text-sm text-white" style={card}>
                  <option value={ALL}>All fleet accounts</option>
                  {fleetOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>
            <p className="text-xs" style={muted(0.4)}>
              {unitRows.length} of {data.units.length} unit{data.units.length === 1 ? '' : 's'} with a job in this range
            </p>
            {unitRows.length === 0 ? (
              <div className="py-10 text-center rounded-xl text-sm" style={{ ...card, ...muted(0.3) }}>
                {data.units.length === 0 ? 'No unit has a job in this range' : 'No unit matches these filters'}
              </div>
            ) : (
              <div className="rounded-xl overflow-x-auto" style={card}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--hd-border)' }}>
                      <SortTh label="Unit" k="unit" sort={sort} onSort={k => setSort(s => nextSort(s, k))} />
                      <SortTh label="Category" k="category" sort={sort} onSort={k => setSort(s => nextSort(s, k))} />
                      <SortTh label="Fleet account" k="fleet" sort={sort} onSort={k => setSort(s => nextSort(s, k))} />
                      <SortTh label="Jobs" k="jobs" sort={sort} onSort={k => setSort(s => nextSort(s, k))} right />
                      <SortTh label="Labor hours" k="laborHours" sort={sort} onSort={k => setSort(s => nextSort(s, k))} right />
                      <SortTh label="Total invoiced" k="invoiced" sort={sort} onSort={k => setSort(s => nextSort(s, k))} right />
                      <SortTh label="Collected" k="collected" sort={sort} onSort={k => setSort(s => nextSort(s, k))} right />
                      <SortTh label="Last service" k="lastService" sort={sort} onSort={k => setSort(s => nextSort(s, k))} right />
                    </tr>
                  </thead>
                  <tbody>
                    {unitRows.map(u => (
                      <tr key={u.unitId} style={{ borderTop: '1px solid var(--hd-border)' }}>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className="text-white">{unitLabel(u)}</span>
                          {(u.manufacturer || u.model) && u.unitNumber && (
                            <span className="block text-[10px]" style={muted(0.35)}>{[u.year, u.manufacturer, u.model].filter(Boolean).join(' ')}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-white">{u.categoryName}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap" style={u.fleetName ? { color: '#fff' } : muted(0.35)}>{u.fleetName ?? '-'}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap" title={sourceNote(u)}>
                          <span className="text-white">{u.jobs}</span>
                          <span className="block text-[10px]" style={muted(0.35)}>{sourceBadge(u)}</span>
                        </td>
                        <PartialTd p={u.laborHours} kind="hours" />
                        <td className="px-3 py-2.5 text-right text-white whitespace-nowrap">{fmtMoney(u.invoiced)}</td>
                        <PartialTd p={u.collected} kind="money" />
                        <td className="px-3 py-2.5 text-right text-white whitespace-nowrap">{fmtDay(u.lastServiceDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Legend - what the marks and the sources mean. */}
          <div className="rounded-xl px-4 py-3 text-xs space-y-1" style={{ ...card, ...muted(0.5) }}>
            <p><span className="text-white">-</span> means not recorded on any job in the row. It is not zero.</p>
            <p><span style={{ color: 'var(--hd-accent-text)' }}>{DAGGER}</span> means the figure covers only some of the row&apos;s jobs; the note under it says how many were not recorded.</p>
            <p><span className="text-white">inv</span> = jobs from invoices. <span className="text-white">WO</span> = closed work orders with no invoice, which includes imported history (a total, but no hours, labor/parts split or payment record).</p>
            <p>Collected is the total of paid invoices. A work order records no payment and a partial invoice records no amount paid, so both count as not recorded rather than as $0.</p>
            <p>Jobs with no unit recorded appear in the category table as &quot;No unit recorded&quot;, not in the unit table. &quot;Uncategorized&quot; is units that have no category yet.</p>
          </div>
        </>
      )}
    </div>
  )
}
