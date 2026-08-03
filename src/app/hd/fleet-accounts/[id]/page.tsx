import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'

export const metadata = { title: 'Fleet Account — NWI HD Suite' }

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

const WO_STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  open:        { bg: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', label: 'Open' },
  in_progress: { bg: `${HD_ORANGE}25`,          color: HD_ORANGE,              label: 'In Progress' },
  completed:   { bg: 'rgba(96,165,250,0.15)',   color: '#60A5FA',              label: 'Completed' },
  invoiced:    { bg: 'rgba(34,197,94,0.15)',    color: '#22C55E',              label: 'Invoiced' },
}

const UNIT_STATUS_STYLE: Record<string, { color: string; label: string }> = {
  active:         { color: '#22C55E', label: 'Active' },
  inactive:       { color: 'rgba(255,255,255,0.4)', label: 'Inactive' },
  out_of_service: { color: '#EF4444', label: 'Out of Service' },
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMoney(n: number | string | null | undefined) {
  return `$${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

interface Unit {
  id: string
  unit_number: string
  truck_trailer_number: string | null
  manufacturer: string
  model: string
  year: number | null
  unit_type: string | null
  status: string | null
  total_hours: number | string | null
}

interface WorkOrder {
  id: string
  work_order_number: string | null
  service_type: string | null
  status: string | null
  total_amount: number | string | null
  created_at: string
  completed_at: string | null
}

export default async function FleetAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasStarterAccess = await checkHDStarterAccess(user.id)
  if (!hasStarterAccess) redirect('/hd/upgrade')

  const [{ data: account }, { data: units }, { data: workOrders }] = await Promise.all([
    supabase
      .from('hd_fleet_accounts')
      .select('id, fleet_name, contact_name, contact_phone, contact_email, address, notes, created_at')
      .eq('id', id)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('hd_units')
      .select('id, unit_number, truck_trailer_number, manufacturer, model, year, unit_type, status, total_hours')
      .eq('fleet_account_id', id)
      .eq('user_id', user.id)
      .order('unit_number'),
    supabase
      .from('hd_work_orders')
      .select('id, work_order_number, service_type, status, total_amount, created_at, completed_at')
      .eq('fleet_account_id', id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  if (!account) notFound()

  const unitList = (units ?? []) as Unit[]
  const woList   = (workOrders ?? []) as WorkOrder[]

  const openWoCount = woList.filter(w => w.status === 'open' || w.status === 'in_progress').length
  const totalBilled = woList.reduce((s, w) => s + Number(w.total_amount ?? 0), 0)

  return (
    <main className="flex-1 p-4 sm:p-6">
      {/* Breadcrumb + header */}
      <div className="mb-6">
        <Link href="/hd/fleet-accounts" className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
          ← Fleet Accounts
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
          <div>
            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite · Fleet Account</p>
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">{account.fleet_name}</h1>
          </div>
          <Link
            href={`/hd/work-orders?fleet_account_id=${account.id}`}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: HD_ORANGE }}
          >
            + New Work Order
          </Link>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Fleet Units',  value: unitList.length,      color: '#60A5FA' },
          { label: 'Open Orders',  value: openWoCount,          color: openWoCount > 0 ? HD_ORANGE : '#ffffff' },
          { label: 'Total Billed', value: fmtMoney(totalBilled), color: '#22C55E' },
        ].map(k => (
          <div key={k.label} className="rounded-xl p-4 sm:p-5 flex flex-col gap-1" style={{ background: '#111920', border: '1px solid #1e3040' }}>
            <p className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>{k.label}</p>
            <p className="font-condensed font-bold text-2xl sm:text-3xl leading-none" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Account info */}
        <div className="rounded-xl p-5 h-fit" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-4">ACCOUNT INFO</p>
          {[
            { label: 'Contact',  value: account.contact_name },
            { label: 'Phone',    value: account.contact_phone },
            { label: 'Email',    value: account.contact_email },
            { label: 'Address',  value: account.address },
            { label: 'Added',    value: fmtDate(account.created_at) },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between gap-4 py-2.5 border-b text-sm" style={{ borderColor: '#1e3040' }}>
              <span className="shrink-0" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</span>
              <span className="text-right text-white">{value || '—'}</span>
            </div>
          ))}
          {account.notes && (
            <div className="mt-4">
              <p className="text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Notes</p>
              <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.7)' }}>{account.notes}</p>
            </div>
          )}
        </div>

        {/* Units + work orders */}
        <div className="lg:col-span-2 space-y-6">
          {/* Fleet units */}
          <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-condensed font-bold text-white text-lg tracking-wide">FLEET UNITS</p>
              <Link href={`/hd/fleet-units?new=1&fleet_account_id=${account.id}`} className="text-xs" style={{ color: HD_ORANGE }}>Manage units →</Link>
            </div>
            {unitList.length === 0 ? (
              <p className="text-sm py-6 text-center" style={{ color: 'rgba(255,255,255,0.25)' }}>No units assigned to this account yet.</p>
            ) : (
              <div className="divide-y" style={{ borderColor: '#1e3040' }}>
                {unitList.map(u => {
                  const st = UNIT_STATUS_STYLE[u.status ?? 'active'] ?? UNIT_STATUS_STYLE.active
                  return (
                    <div key={u.id} className="py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium">
                          {u.unit_number}
                          {u.truck_trailer_number ? <span style={{ color: 'rgba(255,255,255,0.4)' }}> · {u.truck_trailer_number}</span> : null}
                        </p>
                        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                          {[u.year, u.manufacturer, u.model].filter(Boolean).join(' ')}
                          {u.unit_type ? ` · ${u.unit_type}` : ''}
                        </p>
                      </div>
                      {u.total_hours != null && (
                        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{Number(u.total_hours).toFixed(0)} hrs</span>
                      )}
                      <span className="text-xs font-medium" style={{ color: st.color }}>{st.label}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Work orders */}
          <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-condensed font-bold text-white text-lg tracking-wide">WORK ORDERS</p>
              <Link href="/hd/work-orders" className="text-xs" style={{ color: HD_ORANGE }}>All work orders →</Link>
            </div>
            {woList.length === 0 ? (
              <p className="text-sm py-6 text-center" style={{ color: 'rgba(255,255,255,0.25)' }}>No work orders for this account yet.</p>
            ) : (
              <div className="divide-y" style={{ borderColor: '#1e3040' }}>
                {woList.map(w => {
                  const st = WO_STATUS_STYLE[w.status ?? 'open'] ?? WO_STATUS_STYLE.open
                  return (
                    <Link key={w.id} href={`/hd/work-orders/${w.id}`} className="py-3 flex items-center gap-3 transition-opacity hover:opacity-80">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium">{w.work_order_number ?? `WO-${w.id.slice(0, 6).toUpperCase()}`}</p>
                        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                          {w.service_type ?? 'Service'} · {fmtDate(w.completed_at ?? w.created_at)}
                        </p>
                      </div>
                      {w.total_amount != null && Number(w.total_amount) > 0 && (
                        <span className="text-sm font-medium text-white">{fmtMoney(w.total_amount)}</span>
                      )}
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: st.bg, color: st.color }}>
                        {st.label}
                      </span>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
