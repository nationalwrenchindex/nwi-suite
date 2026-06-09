import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Intel Hub — NWI HD Suite' }

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

// Approximate TK/Carrier PM interval: 180 days
const PM_INTERVAL_DAYS = 180

function getPMDateStatus(lastPmDate: string | null): 'overdue' | 'due_soon' | null {
  if (!lastPmDate) return null
  const last     = new Date(lastPmDate)
  const nextDue  = new Date(last.getTime() + PM_INTERVAL_DAYS * 24 * 60 * 60 * 1000)
  const daysLeft = Math.floor((nextDue.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  if (daysLeft < 0) return 'overdue'
  if (daysLeft <= 30) return 'due_soon'
  return null
}

export default async function IntelHubPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const params = await searchParams
  const q      = typeof params.q === 'string' ? params.q.trim() : ''
  const view   = typeof params.view === 'string' ? params.view : 'accounts'

  // Fleet accounts with unit counts
  const { data: accounts } = await supabase
    .from('hd_fleet_accounts')
    .select('id, fleet_name, contact_name, contact_phone, contact_email, address, created_at')
    .eq('user_id', user.id)
    .order('fleet_name')

  // Units — filtered by search query
  let unitsQuery = supabase
    .from('hd_units')
    .select('id, unit_number, manufacturer, model, unit_type, status, total_hours, serial_number, next_pm_due_hours, last_pm_date, last_pm_type, fleet_account_id')
    .eq('user_id', user.id)
    .order('unit_number')

  if (q) {
    unitsQuery = unitsQuery.or(
      `unit_number.ilike.%${q}%,serial_number.ilike.%${q}%,model.ilike.%${q}%,manufacturer.ilike.%${q}%`
    )
  }

  const { data: units } = await unitsQuery.limit(50)

  // Unit detail panel
  const selectedUnitId = typeof params.unit === 'string' ? params.unit : null
  const { data: unitPMs } = selectedUnitId ? await supabase
    .from('hd_pm_checklists')
    .select('id, pm_type, completed_at, flagged_items, alarm_codes_found, battery_cca')
    .eq('user_id', user.id)
    .eq('unit_id', selectedUnitId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(20)
    : { data: null }

  const { data: unitWOs } = selectedUnitId ? await supabase
    .from('hd_work_orders')
    .select('id, work_order_number, status, service_type, total_amount, created_at, completed_at')
    .eq('user_id', user.id)
    .eq('unit_id', selectedUnitId)
    .order('created_at', { ascending: false })
    .limit(20)
    : { data: null }

  const selectedUnit = selectedUnitId ? (units ?? []).find(u => u.id === selectedUnitId) : null

  // Account → unit count map
  const accountUnitMap: Record<string, number> = {}
  for (const u of units ?? []) {
    if (u.fleet_account_id) {
      accountUnitMap[u.fleet_account_id] = (accountUnitMap[u.fleet_account_id] ?? 0) + 1
    }
  }

  // PM alert count across all units
  const pmAlertCount = (units ?? []).filter(u => {
    const hoursUntil = u.next_pm_due_hours !== null && u.total_hours !== null
      ? Number(u.next_pm_due_hours) - Number(u.total_hours)
      : null
    const hoursAlert = hoursUntil !== null && hoursUntil <= 200
    const dateStatus = getPMDateStatus(u.last_pm_date as string | null)
    return hoursAlert || dateStatus !== null
  }).length

  return (
    <main className="flex-1 p-4 sm:p-6">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">INTEL HUB</h1>
          <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Fleet accounts, unit profiles &amp; service history</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {pmAlertCount > 0 && (
            <span
              className="text-xs font-bold px-3 py-1.5 rounded-full"
              style={{ background: '#EF444420', color: '#EF4444' }}
            >
              {pmAlertCount} PM alert{pmAlertCount !== 1 ? 's' : ''}
            </span>
          )}
          <Link
            href="/hd/fleet-accounts?new=1"
            className="px-3 py-2 rounded-lg text-xs font-semibold text-white"
            style={{ background: `${HD_BLUE}cc` }}
          >
            + Customer
          </Link>
          <Link
            href="/hd/fleet-units?new=1"
            className="px-3 py-2 rounded-lg text-xs font-semibold text-white"
            style={{ background: HD_ORANGE }}
          >
            + Unit
          </Link>
        </div>
      </div>

      {/* Search */}
      <form method="GET" className="mb-5">
        <div className="flex gap-3">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by unit #, serial, model, manufacturer…"
            className="flex-1 min-w-0 px-4 py-2.5 rounded-lg text-sm text-white placeholder-white/30"
            style={{ background: '#111920', border: '1px solid #1e3040' }}
          />
          <button
            type="submit"
            className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: HD_BLUE }}
          >
            Search
          </button>
          {q && (
            <Link
              href="/hd/intel"
              className="px-4 py-2.5 rounded-lg text-sm"
              style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }}
            >
              Clear
            </Link>
          )}
        </div>
      </form>

      {/* Tab nav */}
      {!q && !selectedUnitId && (
        <div className="flex items-center gap-1 mb-5 border-b" style={{ borderColor: '#1e3040' }}>
          {[
            { key: 'accounts', label: 'Fleet Accounts', count: (accounts ?? []).length },
            { key: 'units',    label: 'All Units',      count: (units ?? []).length },
          ].map(tab => (
            <Link
              key={tab.key}
              href={`/hd/intel?view=${tab.key}`}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap relative transition-colors"
              style={view === tab.key ? { color: HD_ORANGE } : { color: 'rgba(255,255,255,0.4)' }}
            >
              {tab.label}
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={view === tab.key
                  ? { background: `${HD_ORANGE}25`, color: HD_ORANGE }
                  : { background: '#1e3040', color: 'rgba(255,255,255,0.35)' }
                }
              >
                {tab.count}
              </span>
              {view === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t" style={{ background: HD_ORANGE }} />
              )}
            </Link>
          ))}
        </div>
      )}

      {/* Unit detail panel */}
      {selectedUnit && (
        <div className="mb-6">
          <Link
            href={`/hd/intel${q ? `?q=${encodeURIComponent(q)}` : `?view=${view}`}`}
            className="inline-flex items-center gap-1.5 text-xs mb-4"
            style={{ color: 'rgba(255,255,255,0.4)' }}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </Link>

          <div className="rounded-xl p-5 mb-4" style={{ background: '#111920', border: `1px solid ${HD_BLUE}50` }}>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <p className="font-condensed font-bold text-white text-2xl tracking-wide leading-tight">
                  {selectedUnit.unit_number}
                </p>
                <p className="text-base font-medium mt-0.5" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  {selectedUnit.manufacturer} {selectedUnit.model}
                </p>
                <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  {selectedUnit.unit_type ?? 'Unknown type'}
                  {selectedUnit.serial_number ? ` · SN: ${selectedUnit.serial_number}` : ''}
                  {selectedUnit.total_hours ? ` · ${Number(selectedUnit.total_hours).toLocaleString()} hrs` : ''}
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {(() => {
                  const hoursUntil = selectedUnit.next_pm_due_hours !== null && selectedUnit.total_hours !== null
                    ? Number(selectedUnit.next_pm_due_hours) - Number(selectedUnit.total_hours)
                    : null
                  const dateStatus = getPMDateStatus(selectedUnit.last_pm_date as string | null)
                  const isOverdue  = (hoursUntil !== null && hoursUntil <= 0) || dateStatus === 'overdue'
                  const isDueSoon  = !isOverdue && ((hoursUntil !== null && hoursUntil <= 200) || dateStatus === 'due_soon')
                  return (
                    <>
                      {isOverdue  && <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: '#EF444420', color: '#EF4444' }}>PM OVERDUE</span>}
                      {isDueSoon  && <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: `${HD_ORANGE}25`, color: HD_ORANGE }}>PM DUE SOON</span>}
                    </>
                  )
                })()}
              </div>
            </div>

            {selectedUnit.last_pm_date && (
              <p className="text-xs mb-4" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Last PM: {new Date(selectedUnit.last_pm_date as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                {selectedUnit.last_pm_type ? ` (${String(selectedUnit.last_pm_type).replace(/_/g, ' ')})` : ''}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* PM history */}
            <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
              <p className="font-condensed font-bold text-white text-lg tracking-wide mb-4">PM HISTORY</p>
              {!unitPMs || unitPMs.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm" style={{ color: 'rgba(255,255,255,0.25)' }}>No PMs recorded</p>
                  <Link href="/hd/pm-checklist" className="text-xs mt-2 block" style={{ color: HD_ORANGE }}>
                    Start a PM checklist →
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {unitPMs.map(pm => (
                    <div key={pm.id} className="rounded-lg p-3" style={{ background: '#162030' }}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm text-white font-medium capitalize">
                          {(pm.pm_type as string).replace(/_/g, ' ')} PM
                        </p>
                        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                          {pm.completed_at ? new Date(pm.completed_at as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                        </p>
                      </div>
                      <div className="flex gap-3 flex-wrap text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                        {pm.battery_cca     && <span>Battery: {String(pm.battery_cca)} CCA</span>}
                        {pm.alarm_codes_found && <span style={{ color: '#EF4444' }}>Alarms: {String(pm.alarm_codes_found)}</span>}
                        {pm.flagged_items   && <span style={{ color: HD_ORANGE }}>Flagged items</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Work order history */}
            <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
              <p className="font-condensed font-bold text-white text-lg tracking-wide mb-4">SERVICE HISTORY</p>
              {!unitWOs || unitWOs.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm" style={{ color: 'rgba(255,255,255,0.25)' }}>No work orders recorded</p>
                  <Link href="/hd/work-orders?new=1" className="text-xs mt-2 block" style={{ color: HD_ORANGE }}>
                    Create first work order →
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {unitWOs.map(wo => (
                    <div key={wo.id} className="rounded-lg p-3" style={{ background: '#162030' }}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm text-white font-medium">
                          {wo.work_order_number ?? `WO-${(wo.id as string).slice(0, 6).toUpperCase()}`}
                        </p>
                        {wo.total_amount && (
                          <p className="text-sm font-semibold" style={{ color: HD_ORANGE }}>
                            ${Number(wo.total_amount).toFixed(0)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        <span className="capitalize">{wo.service_type ?? 'Service'}</span>
                        <span className="capitalize">{(wo.status as string).replace(/_/g, ' ')}</span>
                      </div>
                      {(wo.completed_at || wo.created_at) && (
                        <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.25)' }}>
                          {new Date((wo.completed_at ?? wo.created_at) as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Search results */}
      {q && !selectedUnitId && (
        <div>
          <p className="text-xs uppercase tracking-widest mb-4" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {(units ?? []).length} unit{(units ?? []).length !== 1 ? 's' : ''} matching &quot;{q}&quot;
          </p>
          <UnitGrid units={units ?? []} />
        </div>
      )}

      {/* Fleet accounts view */}
      {!q && !selectedUnitId && view === 'accounts' && (
        <div>
          {!accounts || accounts.length === 0 ? (
            <div className="py-20 text-center rounded-xl" style={{ background: '#111920', border: '1px solid #1e3040' }}>
              <p className="text-sm mb-2" style={{ color: 'rgba(255,255,255,0.3)' }}>No fleet accounts yet</p>
              <Link href="/hd/fleet-accounts?new=1" className="text-xs" style={{ color: HD_ORANGE }}>
                + Add your first fleet account
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {accounts.map(acct => {
                const unitCount = accountUnitMap[acct.id] ?? 0
                return (
                  <div
                    key={acct.id}
                    className="rounded-xl p-5 flex flex-col"
                    style={{ background: '#111920', border: '1px solid #1e3040' }}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <p className="font-condensed font-bold text-white text-lg tracking-wide leading-tight">
                        {acct.fleet_name as string}
                      </p>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-bold flex-shrink-0 ml-2"
                        style={{ background: `${HD_BLUE}25`, color: '#60A5FA' }}
                      >
                        {unitCount} unit{unitCount !== 1 ? 's' : ''}
                      </span>
                    </div>

                    <div className="space-y-2 flex-1">
                      {acct.contact_name && (
                        <p className="text-sm font-medium text-white">{acct.contact_name as string}</p>
                      )}
                      {acct.contact_phone && (
                        <a
                          href={`tel:${acct.contact_phone}`}
                          className="flex items-center gap-2 text-sm"
                          style={{ color: '#60A5FA' }}
                        >
                          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.69 12 19.79 19.79 0 011.61 3.44 2 2 0 013.6 1.27h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.91 8.91a16 16 0 006 6l.92-.92a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
                          </svg>
                          {acct.contact_phone as string}
                        </a>
                      )}
                      {acct.contact_email && (
                        <a
                          href={`mailto:${acct.contact_email}`}
                          className="flex items-center gap-2 text-sm truncate"
                          style={{ color: '#60A5FA' }}
                        >
                          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                          </svg>
                          <span className="truncate">{acct.contact_email as string}</span>
                        </a>
                      )}
                      {acct.address && (
                        <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.35)' }}>
                          {acct.address as string}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: '1px solid #1e3040' }}>
                      <Link
                        href={`/hd/intel?view=units&q=`}
                        className="text-xs font-medium"
                        style={{ color: HD_ORANGE }}
                      >
                        View units →
                      </Link>
                      <Link
                        href={`/hd/fleet-accounts/${acct.id}`}
                        className="text-xs"
                        style={{ color: 'rgba(255,255,255,0.3)' }}
                      >
                        Edit
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* All units view */}
      {!q && !selectedUnitId && view === 'units' && (
        <div>
          {(units ?? []).length === 0 ? (
            <div className="py-20 text-center rounded-xl" style={{ background: '#111920', border: '1px solid #1e3040' }}>
              <p className="text-sm mb-2" style={{ color: 'rgba(255,255,255,0.3)' }}>No units found</p>
              <Link href="/hd/fleet-units?new=1" className="text-xs" style={{ color: HD_ORANGE }}>
                + Add first unit
              </Link>
            </div>
          ) : (
            <UnitGrid units={units ?? []} />
          )}
        </div>
      )}
    </main>
  )
}

type UnitRow = {
  id: unknown
  unit_number: unknown
  manufacturer: unknown
  model: unknown
  unit_type: unknown
  total_hours: unknown
  serial_number: unknown
  next_pm_due_hours: unknown
  last_pm_date: unknown
  fleet_account_id: unknown
}

function UnitGrid({ units }: { units: UnitRow[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {units.map(u => {
        const hoursUntil = u.next_pm_due_hours !== null && u.total_hours !== null
          ? Number(u.next_pm_due_hours) - Number(u.total_hours)
          : null
        const dateStatus = getPMDateStatus(u.last_pm_date as string | null)
        const isOverdue  = (hoursUntil !== null && hoursUntil <= 0) || dateStatus === 'overdue'
        const isDueSoon  = !isOverdue && ((hoursUntil !== null && hoursUntil > 0 && hoursUntil <= 200) || dateStatus === 'due_soon')

        return (
          <Link
            key={u.id as string}
            href={`/hd/intel?unit=${u.id}`}
            className="rounded-xl p-5 block transition-opacity hover:opacity-80"
            style={{
              background: '#111920',
              border: isOverdue ? '1px solid #EF444435' : isDueSoon ? `1px solid ${HD_ORANGE}35` : '1px solid #1e3040',
            }}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="font-condensed font-bold text-white text-lg tracking-wide leading-tight">
                {u.unit_number as string}
              </p>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                {isOverdue && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#EF444420', color: '#EF4444' }}>
                    PM OVERDUE
                  </span>
                )}
                {isDueSoon && !isOverdue && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${HD_ORANGE}25`, color: HD_ORANGE }}>
                    PM DUE SOON
                  </span>
                )}
              </div>
            </div>

            <p className="text-sm mb-2" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {u.manufacturer as string} {u.model as string}
            </p>

            <div className="flex items-center justify-between text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <span>{u.total_hours !== null ? `${Number(u.total_hours).toLocaleString()} hrs` : 'No hours logged'}</span>
              {u.serial_number != null && <span className="truncate ml-2">SN: {String(u.serial_number)}</span>}
            </div>

            {u.last_pm_date != null && (
              <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.25)' }}>
                Last PM: {new Date(u.last_pm_date as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            )}

            <p className="text-xs mt-2 font-medium" style={{ color: HD_ORANGE }}>View history →</p>
          </Link>
        )
      })}
    </div>
  )
}
