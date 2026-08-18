import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { AERIAL_INTERVAL_DAYS, AERIAL_TYPE_LABEL, FREQUENT_INTERVAL_HOURS } from '@/lib/hd/aerial/forms'
import type { AerialInspectionType } from '@/types/aerial'

export const metadata = { title: 'Unit Inspection Status — NWI HD Suite' }

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

/**
 * DOT lives in its own table (hd_dot_inspections) but reads as a fourth cadence
 * on this dashboard, so the column set is the three aerial types plus 'dot'.
 */
type InspectionColumn = AerialInspectionType | 'dot'

const COLUMNS: readonly InspectionColumn[] = ['pre_use', 'frequent', 'annual', 'dot']

const COLUMN_LABEL: Record<InspectionColumn, string> = {
  ...AERIAL_TYPE_LABEL,
  dot: 'DOT',
}

const INTERVAL_DAYS: Record<InspectionColumn, number> = {
  ...AERIAL_INTERVAL_DAYS,
  dot: 365, // 49 CFR 396.17 — periodic inspection, every 12 months.
}

const DAY_MS = 86_400_000

/**
 * Inspection dates are DATE columns with no zone. Anchoring at noon local time
 * avoids the off-by-one that UTC-midnight parsing produces west of Greenwich,
 * which would otherwise flip a pre-use inspection (1-day interval) to overdue.
 */
function parseDate(iso: string): number {
  return new Date(`${iso}T12:00:00`).getTime()
}

function formatDate(iso: string): string {
  return new Date(parseDate(iso)).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function isValidDateParam(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v)
}

/** Postgres DECIMAL/NUMERIC can arrive as a string; anything unparseable is "no data". */
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

interface UnitRow {
  id:           string
  unit_number:  string
  manufacturer: string | null
  model:        string | null
  total_hours:  number | string | null
}

interface AerialRow {
  unit_id:         string | null
  inspection_type: AerialInspectionType
  inspection_date: string
  hour_meter:      number | string | null
}

interface DotRow {
  unit_id:         string | null
  inspection_date: string
}

interface CellState {
  date:    string | null
  overdue: boolean
  /** Frequent only — the 150-hour limit tripped before the 90-day one did. */
  byHours: boolean
}

interface UnitStatus {
  unit:  UnitRow
  cells: Record<InspectionColumn, CellState>
  overdueTypes: InspectionColumn[]
}

function InspectionCell({ state }: { state: CellState }) {
  if (!state.date) {
    // Never inspected is still overdue, but must not read as a stale date — the
    // dash plus the explicit NEVER tag keeps the two cases distinguishable.
    return (
      <td className="px-4 py-3 text-sm bg-red-500/10">
        <span className="text-red-400">—</span>
        <span className="block text-[10px] font-bold tracking-wider text-red-400">NEVER</span>
      </td>
    )
  }
  if (!state.overdue) {
    return (
      <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
        {formatDate(state.date)}
      </td>
    )
  }
  return (
    <td className="px-4 py-3 text-sm bg-red-500/10">
      <span className="text-red-400">{formatDate(state.date)}</span>
      <span className="block text-[10px] font-bold tracking-wider text-red-400">
        {state.byHours ? `OVERDUE · ${FREQUENT_INTERVAL_HOURS} HRS` : 'OVERDUE'}
      </span>
    </td>
  )
}

export default async function UnitInspectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const params  = await searchParams
  const rawType = typeof params.type === 'string' ? params.type : ''
  const rawFrom = typeof params.from === 'string' ? params.from : ''
  const rawTo   = typeof params.to   === 'string' ? params.to   : ''

  const typeFilter = (COLUMNS as readonly string[]).includes(rawType)
    ? (rawType as InspectionColumn)
    : null
  const from = isValidDateParam(rawFrom) ? rawFrom : null
  const to   = isValidDateParam(rawTo)   ? rawTo   : null

  const { data: unitData } = await supabase
    .from('hd_units')
    .select('id, unit_number, manufacturer, model, total_hours')
    .eq('user_id', user.id)
    .order('unit_number')

  const units = (unitData ?? []) as unknown as UnitRow[]
  const unitIds = units.map(u => u.id)

  // Two queries for the whole fleet rather than one per unit: both tables are
  // indexed on (user_id, inspection_date DESC), so newest-first ordering lets a
  // single pass keep the first row seen per unit+type as the latest one.
  let aerialRows: AerialRow[] = []
  let dotRows:    DotRow[]    = []

  if (unitIds.length > 0) {
    let aerialQuery = supabase
      .from('hd_aerial_inspections')
      .select('unit_id, inspection_type, inspection_date, hour_meter')
      .eq('user_id', user.id)
      .in('unit_id', unitIds)
      .order('inspection_date', { ascending: false })

    let dotQuery = supabase
      .from('hd_dot_inspections')
      .select('unit_id, inspection_date')
      .eq('user_id', user.id)
      .in('unit_id', unitIds)
      .order('inspection_date', { ascending: false })

    // Bounding at the query level means the date window also drives the overdue
    // maths — an inspection outside the window is treated as not having happened.
    if (from) {
      aerialQuery = aerialQuery.gte('inspection_date', from)
      dotQuery    = dotQuery.gte('inspection_date', from)
    }
    if (to) {
      aerialQuery = aerialQuery.lte('inspection_date', to)
      dotQuery    = dotQuery.lte('inspection_date', to)
    }

    const [{ data: aerialData }, { data: dotData }] = await Promise.all([aerialQuery, dotQuery])
    aerialRows = (aerialData ?? []) as unknown as AerialRow[]
    dotRows    = (dotData    ?? []) as unknown as DotRow[]
  }

  const latestDate  = new Map<string, string>()  // `${unitId}:${column}` → inspection_date
  const latestHours = new Map<string, number>()  // unitId → hour meter at the last frequent

  for (const row of aerialRows) {
    if (!row.unit_id) continue
    const key = `${row.unit_id}:${row.inspection_type}`
    if (latestDate.has(key)) continue // rows are date-descending, so the first wins
    latestDate.set(key, row.inspection_date)
    if (row.inspection_type === 'frequent') {
      const hours = toNumber(row.hour_meter)
      if (hours !== null) latestHours.set(row.unit_id, hours)
    }
  }
  for (const row of dotRows) {
    if (!row.unit_id) continue
    const key = `${row.unit_id}:dot`
    if (latestDate.has(key)) continue
    latestDate.set(key, row.inspection_date)
  }

  const now = Date.now()

  const statuses: UnitStatus[] = units.map(unit => {
    const currentHours = toNumber(unit.total_hours)
    const cells = {} as Record<InspectionColumn, CellState>
    const overdueTypes: InspectionColumn[] = []

    for (const column of COLUMNS) {
      const date = latestDate.get(`${unit.id}:${column}`) ?? null
      let overdue = true
      let byHours = false

      if (date) {
        overdue = (now - parseDate(date)) / DAY_MS > INTERVAL_DAYS[column]

        // ANSI A92: frequent is due at 3 months OR 150 hours, whichever comes
        // first. Only checkable when both the unit's current reading and the
        // meter recorded at the last frequent inspection are present.
        if (column === 'frequent' && !overdue && currentHours !== null) {
          const hoursAtLast = latestHours.get(unit.id)
          if (hoursAtLast !== undefined && currentHours - hoursAtLast > FREQUENT_INTERVAL_HOURS) {
            overdue = true
            byHours = true
          }
        }
      }

      cells[column] = { date, overdue, byHours }
      if (overdue) overdueTypes.push(column)
    }

    return { unit, cells, overdueTypes }
  })

  // Summary describes the whole fleet under the current date window; the type
  // filter narrows only the table, so the cards stay a stable reference point.
  const totalUnits     = statuses.length
  const overdueUnits   = statuses.filter(s => s.overdueTypes.length > 0).length
  const compliantUnits = totalUnits - overdueUnits

  const rows = typeFilter
    ? statuses.filter(s => s.overdueTypes.includes(typeFilter))
    : statuses

  // Every filter link carries the other params forward so the two filters compose.
  const hrefWith = (next: { type?: string | null }) => {
    const qs = new URLSearchParams()
    const type = next.type === undefined ? typeFilter : next.type
    if (type) qs.set('type', type)
    if (from)  qs.set('from', from)
    if (to)    qs.set('to', to)
    const s = qs.toString()
    return s ? `/hd/units/inspections?${s}` : '/hd/units/inspections'
  }

  const inputStyle = { background: '#162030', border: '1px solid #1e3040' }
  const hasFilters = !!typeFilter || !!from || !!to

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            HD Suite — Compliance
          </p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">UNIT INSPECTION STATUS</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Latest pre-use, frequent, annual and DOT inspection per unit — overdue cadences flagged in red.
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl p-5 flex flex-col gap-1" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>Total Units</p>
          <p className="font-condensed font-bold text-3xl leading-none text-white">{totalUnits}</p>
        </div>
        <div className="rounded-xl p-5 flex flex-col gap-1" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>Units Overdue</p>
          <p className="font-condensed font-bold text-3xl leading-none" style={{ color: '#EF4444' }}>{overdueUnits}</p>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>Any cadence past due</p>
        </div>
        <div className="rounded-xl p-5 flex flex-col gap-1" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>Units Compliant</p>
          <p className="font-condensed font-bold text-3xl leading-none" style={{ color: '#22C55E' }}>{compliantUnits}</p>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>All four cadences current</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3">
        <Link
          href={hrefWith({ type: null })}
          className="px-3 py-1 rounded-full text-xs font-medium"
          style={!typeFilter
            ? { background: `${HD_ORANGE}25`, color: HD_ORANGE, border: `1px solid ${HD_ORANGE}50` }
            : { color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }
          }
        >
          All Units
        </Link>
        {COLUMNS.map(c => (
          <Link
            key={c}
            href={hrefWith({ type: c })}
            className="px-3 py-1 rounded-full text-xs font-medium"
            style={typeFilter === c
              ? { background: `${HD_ORANGE}25`, color: HD_ORANGE, border: `1px solid ${HD_ORANGE}50` }
              : { color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }
            }
          >
            {COLUMN_LABEL[c]} Overdue
          </Link>
        ))}
      </div>

      <form method="GET" className="mb-5 flex flex-wrap items-end gap-3">
        {/* Preserved so the date form does not drop the active type chip. */}
        {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
        <div>
          <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>From</label>
          <input name="from" type="date" defaultValue={from ?? ''} className="px-3 py-2.5 rounded-lg text-base sm:text-sm text-white" style={inputStyle} />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>To</label>
          <input name="to" type="date" defaultValue={to ?? ''} className="px-3 py-2.5 rounded-lg text-base sm:text-sm text-white" style={inputStyle} />
        </div>
        <button type="submit" className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: HD_BLUE }}>
          Apply
        </button>
        {hasFilters && (
          <Link href="/hd/units/inspections" className="px-4 py-2.5 rounded-lg text-sm" style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }}>
            Clear
          </Link>
        )}
      </form>

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
        {rows.length === 0 ? (
          <div className="py-16 text-center" style={{ background: '#111920' }}>
            <svg className="w-10 h-10 mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.15)' }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <rect x="1" y="3" width="15" height="13" rx="2" />
              <path d="M16 8h4l3 5v3h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
            </svg>
            <p className="text-sm mb-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
              {totalUnits === 0 ? 'No fleet units yet' : 'No units match these filters'}
            </p>
            {totalUnits === 0 && (
              <>
                <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.2)' }}>Add your units to start tracking inspection compliance</p>
                <Link href="/hd/fleet-units?new=1" className="text-xs px-4 py-2 rounded-lg font-semibold" style={{ background: HD_ORANGE, color: '#fff' }}>
                  + Add First Unit
                </Link>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]" style={{ background: '#111920' }}>
              <thead style={{ background: '#162030' }}>
                <tr>
                  {['Unit #', 'Make / Model', 'Pre-Use', 'Frequent', 'Annual', 'DOT', 'Status'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((s, i) => (
                  <tr key={s.unit.id} style={{ borderTop: i > 0 ? '1px solid #1e3040' : undefined }}>
                    <td className="px-4 py-3 text-sm text-white font-medium">{s.unit.unit_number}</td>
                    <td className="px-4 py-3 text-sm text-white">
                      {[s.unit.manufacturer, s.unit.model].filter(Boolean).join(' ') || '—'}
                    </td>
                    {COLUMNS.map(c => <InspectionCell key={c} state={s.cells[c]} />)}
                    <td className="px-4 py-3">
                      {s.overdueTypes.length > 0 ? (
                        <>
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full text-red-400 bg-red-500/10">
                            OVERDUE
                          </span>
                          <span className="block text-[10px] mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                            {s.overdueTypes.map(t => COLUMN_LABEL[t]).join(' · ')}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#22C55E20', color: '#22C55E' }}>
                          COMPLIANT
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
