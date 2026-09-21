import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PartsComingSoon from '@/components/hd/PartsComingSoon'
import { FLEET_UNIT_LIST_SELECT, FLEET_UNIT_PAGE_SIZE, type FleetUnitListRow } from '@/app/api/hd/fleet-units/list'
import FleetUnitList from './FleetUnitList'

export const metadata = { title: 'Fleet Units — NWI HD Suite' }

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

const PM_TYPES = [
  'Visual Inspection',
  'Dry Inspection Only',
  'Full Wet Service — No Belts',
  'Full Wet Service + Belts',
  'Full Wet Service — Aftermarket',
  'Coolant Flush',
]

// Hours added to the last PM hours to get the next-due reading, by manufacturer + PM type.
// TK: visual 1500 / full 3000 · Carrier: visual 750 / full 1500 · Other/Truck: generic 1000/2000.
function pmInterval(manufacturer: string, pmType: string | null): number {
  const m = (manufacturer || '').toLowerCase()
  const isVisual = pmType === 'Visual Inspection' || pmType === 'Dry Inspection Only'
  if (m.includes('thermo'))  return isVisual ? 1500 : 3000
  if (m.includes('carrier')) return isVisual ? 750  : 1500
  return isVisual ? 1000 : 2000
}

export default async function FleetUnitsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const params    = await searchParams
  const saveError  = params.error === '1'
  const savedMsg   = params.saved === 'updated' ? 'Unit updated' : params.saved === 'created' ? 'Unit added' : null
  const editId     = typeof params.edit === 'string' ? params.edit : null
  const fleetAccountId = typeof params.fleet_account_id === 'string' ? params.fleet_account_id : null

  // Unit being edited (must belong to this user).
  let editUnit: Record<string, unknown> | null = null
  if (editId) {
    const { data } = await supabase.from('hd_units').select('*').eq('id', editId).eq('user_id', user.id).maybeSingle()
    editUnit = data ?? null
  }
  const isEdit   = !!editUnit
  const showForm = params.new === '1' || isEdit

  // Resolve + validate the fleet account (must belong to this user) so we can lock the
  // form to it and scope the list. Invalid/foreign ids are ignored.
  let fleetAccountName: string | null = null
  if (fleetAccountId) {
    const { data: fa } = await supabase
      .from('hd_fleet_accounts')
      .select('fleet_name')
      .eq('id', fleetAccountId)
      .eq('user_id', user.id)
      .maybeSingle()
    fleetAccountName = (fa?.fleet_name as string | undefined) ?? null
  }
  const scopedAccountId = fleetAccountName ? fleetAccountId : null

  // Always scoped to this user; additionally narrowed to one fleet account whenever the
  // param is present (filter on the raw id so it holds even if the name lookup fails —
  // combined with user_id scoping, a foreign id simply returns nothing).
  // Paged: PostgREST silently caps any response at 1,000 rows, so loading every
  // unit at once would quietly drop the rest off the bottom of the table. The
  // header total comes from its own exact/head count carrying the same fleet
  // filter, so it reports the real number however few rows this page carries.
  let unitsQuery = supabase
    .from('hd_units')
    .select(FLEET_UNIT_LIST_SELECT)
    .eq('user_id', user.id)
  let unitsCountQuery = supabase
    .from('hd_units')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
  if (fleetAccountId) {
    unitsQuery      = unitsQuery.eq('fleet_account_id', fleetAccountId)
    unitsCountQuery = unitsCountQuery.eq('fleet_account_id', fleetAccountId)
  }

  const [{ data: units }, { count: unitCount }] = await Promise.all([
    // Must match the API's ordering exactly, or the offsets the client sends
    // would page through a different sequence than this first page came from.
    unitsQuery.order('unit_number').order('id').range(0, FLEET_UNIT_PAGE_SIZE - 1),
    unitsCountQuery,
  ])

  const unitRows  = (units ?? []) as unknown as FleetUnitListRow[]
  const unitTotal = unitCount ?? unitRows.length

  // ── Save (insert OR update) ────────────────────────────────────────────────
  async function saveUnit(formData: FormData) {
    'use server'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const accountId = (formData.get('fleet_account_id') as string ?? '').trim() || null
    const accountQS = accountId ? `&fleet_account_id=${accountId}` : ''
    const unitId    = (formData.get('unit_id') as string ?? '').trim() || null
    const formQS    = unitId ? `&edit=${unitId}` : '&new=1'

    const unitNumber = (formData.get('unit_number') as string ?? '').trim()
    if (!unitNumber) { redirect(`/hd/fleet-units?error=1${formQS}${accountQS}`); return }

    const manufacturer = (formData.get('manufacturer') as string) || 'Thermo King'
    const lastPmType   = (formData.get('last_pm_type') as string ?? '').trim() || null
    const lastPmDate   = (formData.get('last_pm_date') as string ?? '').trim() || null
    const lastPmHours  = formData.get('last_pm_hours') ? Number(formData.get('last_pm_hours')) : null
    // Auto-calc next PM due hours from the last PM reading + manufacturer/type interval.
    const nextPmDue    = lastPmHours != null ? lastPmHours + pmInterval(manufacturer, lastPmType) : null

    const record = {
      unit_number:       unitNumber,
      manufacturer,
      model:             (formData.get('model') as string ?? '').trim() || 'Unknown',
      unit_type:         (formData.get('unit_type') as string) || 'trailer',
      year:              formData.get('year') ? Number(formData.get('year')) : null,
      refrigerant_type:  (formData.get('refrigerant_type') as string) || 'R-404A',
      total_hours:       formData.get('total_hours') ? Number(formData.get('total_hours')) : 0,
      serial_number:     (formData.get('serial_number') as string ?? '').trim() || null,
      bm_number:         (formData.get('bm_number') as string ?? '').trim() || null,
      last_pm_type:      lastPmType,
      last_pm_date:      lastPmDate,
      last_pm_hours:     lastPmHours,
      next_pm_due_hours: nextPmDue,
    }

    let error
    if (unitId) {
      const res = await supabase.from('hd_units').update(record).eq('id', unitId).eq('user_id', user.id)
      error = res.error
    } else {
      const res = await supabase.from('hd_units').insert({ ...record, user_id: user.id, fleet_account_id: accountId, status: 'active' })
      error = res.error
    }

    if (error) {
      console.error('[fleet-units saveUnit] failed:', error.message)
      redirect(`/hd/fleet-units?error=1${formQS}${accountQS}`)
      return
    }

    revalidatePath('/hd/fleet-units')
    redirect(`/hd/fleet-units?saved=${unitId ? 'updated' : 'created'}${accountId ? `&fleet_account_id=${accountId}` : ''}`)
  }

  const inputStyle = { background: 'var(--hd-inner)', border: '1px solid var(--hd-border)' }
  const ev = (k: string) => (editUnit?.[k] != null ? String(editUnit[k]) : '')

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>HD Suite</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">FLEET UNITS</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>
            {unitTotal.toLocaleString()} unit{unitTotal !== 1 ? 's' : ''}
          </p>
          {fleetAccountName && (
            <p className="text-sm mt-1" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>
              Showing units for <span style={{ color: '#60A5FA' }}>{fleetAccountName}</span>
              {' · '}<Link href="/hd/fleet-units" className="underline">show all units</Link>
            </p>
          )}
        </div>
        <Link
          href={scopedAccountId ? `?new=1&fleet_account_id=${scopedAccountId}` : '?new=1'}
          className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white"
          style={{ background: HD_ORANGE }}
        >
          + Add Unit
        </Link>
      </div>

      {savedMsg && (
        <p className="text-sm px-4 py-3 mb-4 rounded-lg" style={{ background: 'rgba(34,197,94,0.12)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.3)' }}>
          ✓ {savedMsg}
        </p>
      )}

      {/* Inline create / edit form */}
      {showForm && (
        <form action={saveUnit} className="rounded-xl p-6 mb-6 space-y-4" style={{ background: 'var(--hd-card)', border: `1px solid ${HD_ORANGE}50` }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide">{isEdit ? 'EDIT FLEET UNIT' : 'ADD FLEET UNIT'}</p>
          {isEdit && <input type="hidden" name="unit_id" value={editId!} />}
          {fleetAccountName && scopedAccountId && !isEdit && (
            <div className="flex items-center gap-2 text-sm">
              <span style={{ color: 'rgba(var(--hd-ink-rgb), 0.5)' }}>Adding unit to</span>
              <span className="px-2 py-0.5 rounded font-semibold" style={{ background: `${HD_BLUE}30`, color: '#60A5FA' }}>{fleetAccountName}</span>
              <input type="hidden" name="fleet_account_id" value={scopedAccountId} />
            </div>
          )}
          {saveError && (
            <p className="text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)' }}>
              Unit could not be saved. Check the required fields and try again — if this persists, the fleet-units table may not be migrated yet.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>Unit # *</label>
              <input name="unit_number" required defaultValue={ev('unit_number')} placeholder="e.g. TRL-001" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>Manufacturer *</label>
              <input name="manufacturer" list="manufacturer-options" required defaultValue={ev('manufacturer')} placeholder="Thermo King, Carrier, Freightliner…" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={inputStyle} />
              <datalist id="manufacturer-options">
                <option value="Thermo King" />
                <option value="Carrier Transicold" />
              </datalist>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>Model *</label>
              <input name="model" required defaultValue={ev('model')} placeholder="e.g. Precedent S-600" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>Serial Number</label>
              <input name="serial_number" defaultValue={ev('serial_number')} placeholder="10-digit serial" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>BM Number</label>
              <input name="bm_number" defaultValue={ev('bm_number')} placeholder="e.g. 363xxx" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>Unit Type</label>
              <select name="unit_type" defaultValue={ev('unit_type') || 'trailer'} className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white" style={inputStyle}>
                <option value="trailer">Trailer</option>
                <option value="truck">Truck</option>
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>Year</label>
              <input name="year" type="number" defaultValue={ev('year')} placeholder="e.g. 2020" min="1990" max="2030" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>Refrigerant</label>
              <select name="refrigerant_type" defaultValue={ev('refrigerant_type') || 'R-404A'} className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white" style={inputStyle}>
                <option value="R-404A">R-404A</option>
                <option value="R-452A">R-452A</option>
                <option value="R-22">R-22</option>
                <option value="R-407C">R-407C</option>
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>Current Hours</label>
              <input name="total_hours" type="number" defaultValue={ev('total_hours')} placeholder="e.g. 4500" min="0" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={inputStyle} />
            </div>
          </div>

          {/* PM History */}
          <div className="pt-2">
            <p className="text-xs uppercase tracking-widest mb-2 font-semibold" style={{ color: 'rgba(var(--hd-ink-rgb), 0.5)' }}>Last PM Service</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>Last PM Type</label>
                <select name="last_pm_type" defaultValue={ev('last_pm_type')} className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white" style={inputStyle}>
                  <option value="">— Select —</option>
                  {PM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>Last PM Date</label>
                <input name="last_pm_date" type="date" defaultValue={ev('last_pm_date').slice(0, 10)} className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white" style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>Last PM Hours</label>
                <input name="last_pm_hours" type="number" min="0" defaultValue={ev('last_pm_hours')} placeholder="e.g. 3000" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={inputStyle} />
              </div>
            </div>
            <p className="text-xs mt-1.5" style={{ color: 'rgba(var(--hd-ink-rgb), 0.3)' }}>Next PM due is auto-calculated from Last PM Hours + the manufacturer interval.</p>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: HD_ORANGE }}>
              {isEdit ? 'Update Unit' : 'Save Unit'}
            </button>
            <Link href="/hd/fleet-units" className="px-4 py-2.5 rounded-lg text-sm border" style={{ color: 'rgba(var(--hd-ink-rgb), 0.5)', borderColor: 'var(--hd-border)' }}>
              Cancel
            </Link>
          </div>
        </form>
      )}

      {/* key: a fleet-account change is a URL navigation, not a remount, so without
          it the client would keep the previous fleet's accumulated rows and append
          the new fleet's pages onto them. unitTotal is in the key so adding a unit
          re-seeds the list too. */}
      <FleetUnitList
        key={`${fleetAccountId ?? 'all'}:${unitTotal}`}
        initialRows={unitRows}
        total={unitTotal}
        fleetAccountId={fleetAccountId}
        fleetAccountName={fleetAccountName}
        scopedAccountId={scopedAccountId}
      />

      <PartsComingSoon />
    </main>
  )
}
