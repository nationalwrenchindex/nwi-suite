import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Intel Hub — NWI HD Suite' }

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

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

  // Recent PMs per unit (for unit history)
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

  // Build account → unit count map
  const accountUnitMap: Record<string, number> = {}
  for (const u of units ?? []) {
    if (u.fleet_account_id) {
      accountUnitMap[u.fleet_account_id] = (accountUnitMap[u.fleet_account_id] ?? 0) + 1
    }
  }

  return (
    <main className="flex-1 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">INTEL HUB</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Fleet account management and unit history</p>
        </div>
      </div>

      {/* Search bar */}
      <form method="GET" className="mb-6">
        <div className="flex gap-3">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search by unit #, serial, model, manufacturer…"
            className="flex-1 px-4 py-2.5 rounded-lg text-sm text-white placeholder-white/30"
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
        <div className="flex gap-2 mb-6">
          {[
            { key: 'accounts', label: 'Fleet Accounts' },
            { key: 'units',    label: 'All Units' },
          ].map(tab => (
            <Link
              key={tab.key}
              href={`/hd/intel?view=${tab.key}`}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              style={view === tab.key
                ? { background: `${HD_ORANGE}20`, color: HD_ORANGE, border: `1px solid ${HD_ORANGE}50` }
                : { color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }
              }
            >
              {tab.label}
            </Link>
          ))}
        </div>
      )}

      {/* Unit history panel */}
      {selectedUnit && (
        <div className="mb-6 rounded-xl p-5" style={{ background: '#111920', border: `1px solid ${HD_BLUE}50` }}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="font-condensed font-bold text-white text-xl tracking-wide">
                {selectedUnit.unit_number} — {selectedUnit.manufacturer} {selectedUnit.model}
              </p>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {selectedUnit.unit_type ?? 'Unknown type'} · SN: {selectedUnit.serial_number ?? '—'} · {selectedUnit.total_hours ?? 0} hrs
              </p>
            </div>
            <Link
              href={`/hd/intel${q ? `?q=${q}` : ''}`}
              className="text-xs px-3 py-1.5 rounded-lg"
              style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }}
            >
              ← Back
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* PM history */}
            <div>
              <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>PM History</p>
              {!unitPMs || unitPMs.length === 0 ? (
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.25)' }}>No PMs recorded</p>
              ) : (
                <div className="space-y-2">
                  {unitPMs.map(pm => (
                    <div key={pm.id} className="rounded-lg p-3" style={{ background: '#162030' }}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm text-white font-medium capitalize">
                          {(pm.pm_type as string).replace(/_/g, ' ')} PM
                        </p>
                        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                          {pm.completed_at ? new Date(pm.completed_at as string).toLocaleDateString() : '—'}
                        </p>
                      </div>
                      <div className="flex gap-3 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                        {pm.battery_cca && <span>Battery: {String(pm.battery_cca)} CCA</span>}
                        {pm.alarm_codes_found && <span style={{ color: '#EF4444' }}>Alarms: {String(pm.alarm_codes_found)}</span>}
                        {pm.flagged_items && <span style={{ color: HD_ORANGE }}>Flagged items</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Work order history */}
            <div>
              <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>Work Order History</p>
              {!unitWOs || unitWOs.length === 0 ? (
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.25)' }}>No work orders recorded</p>
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
                        <span className="capitalize">{(wo.status as string).replace('_', ' ')}</span>
                      </div>
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
          <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {(units ?? []).length} unit{(units ?? []).length !== 1 ? 's' : ''} matching &quot;{q}&quot;
          </p>
          <UnitGrid units={units ?? []} hdOrange={HD_ORANGE} />
        </div>
      )}

      {/* Fleet accounts view */}
      {!q && !selectedUnitId && view === 'accounts' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {(accounts ?? []).length} Fleet Account{(accounts ?? []).length !== 1 ? 's' : ''}
            </p>
            <Link
              href="/hd/fleet-accounts?new=1"
              className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white"
              style={{ background: HD_ORANGE }}
            >
              + New Account
            </Link>
          </div>
          {!accounts || accounts.length === 0 ? (
            <div className="py-16 text-center rounded-xl" style={{ background: '#111920', border: '1px solid #1e3040' }}>
              <p className="text-sm mb-2" style={{ color: 'rgba(255,255,255,0.3)' }}>No fleet accounts yet</p>
              <Link href="/hd/fleet-accounts?new=1" className="text-xs" style={{ color: HD_ORANGE }}>
                + Add your first fleet account
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {accounts.map(acct => (
                <div key={acct.id} className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
                  <div className="flex items-start justify-between mb-3">
                    <p className="font-condensed font-bold text-white text-lg tracking-wide leading-tight">
                      {acct.fleet_name as string}
                    </p>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: `${HD_BLUE}25`, color: '#60A5FA' }}>
                      {accountUnitMap[acct.id] ?? 0} unit{(accountUnitMap[acct.id] ?? 0) !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    {acct.contact_name && <p>{acct.contact_name as string}</p>}
                    {acct.contact_phone && <p>{acct.contact_phone as string}</p>}
                    {acct.contact_email && <p>{acct.contact_email as string}</p>}
                    {acct.address && <p className="truncate">{acct.address as string}</p>}
                  </div>
                  <Link
                    href={`/hd/intel?view=units&q=`}
                    className="mt-3 inline-block text-xs"
                    style={{ color: HD_ORANGE }}
                  >
                    View units →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* All units view */}
      {!q && !selectedUnitId && view === 'units' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {(units ?? []).length} Unit{(units ?? []).length !== 1 ? 's' : ''}
            </p>
            <Link
              href="/hd/fleet-units?new=1"
              className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white"
              style={{ background: HD_ORANGE }}
            >
              + Add Unit
            </Link>
          </div>
          <UnitGrid units={units ?? []} hdOrange={HD_ORANGE} />
        </div>
      )}
    </main>
  )
}

function UnitGrid({ units, hdOrange }: { units: Record<string, unknown>[]; hdOrange: string }) {
  if (units.length === 0) {
    return (
      <div className="py-16 text-center rounded-xl" style={{ background: '#111920', border: '1px solid #1e3040' }}>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>No units found</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {units.map(u => {
        const hoursUntil = u.next_pm_due_hours !== null && u.total_hours !== null
          ? Number(u.next_pm_due_hours) - Number(u.total_hours)
          : null
        return (
          <Link
            key={u.id as string}
            href={`/hd/intel?unit=${u.id}`}
            className="rounded-xl p-5 block transition-opacity hover:opacity-80"
            style={{ background: '#111920', border: '1px solid #1e3040' }}
          >
            <div className="flex items-start justify-between mb-2">
              <p className="font-condensed font-bold text-white text-lg tracking-wide leading-tight">
                {u.unit_number as string}
              </p>
              {hoursUntil !== null && hoursUntil <= 200 && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#EF444425', color: '#EF4444' }}>
                  {hoursUntil <= 0 ? 'PM OVERDUE' : `PM in ${hoursUntil.toFixed(0)}h`}
                </span>
              )}
            </div>
            <p className="text-sm mb-2" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {u.manufacturer as string} {u.model as string}
            </p>
            <div className="flex items-center justify-between text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <span>{u.total_hours !== null ? `${Number(u.total_hours).toLocaleString()} hrs` : 'No hours'}</span>
              {u.serial_number != null && <span>SN: {String(u.serial_number)}</span>}
            </div>
            <p className="text-xs mt-2" style={{ color: hdOrange }}>View history →</p>
          </Link>
        )
      })}
    </div>
  )
}
