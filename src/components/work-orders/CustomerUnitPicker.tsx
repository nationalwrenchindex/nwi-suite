'use client'

// ─── Customer + unit selection for a work order ───────────────────────────────
// Kept in one component because the two choices are not independent: a vehicle
// belongs to a customer, so picking a customer is what makes a unit list possible,
// and changing the customer invalidates whatever unit was chosen.
//
// The unit half has a free-text escape hatch. A work order is exactly the record a
// shop opens for the thing that is not a car — a boat trailer, a yard compressor,
// a gate motor — and forcing those through year/make/model would have techs typing
// "2020 N/A trailer" to get past the form.

import { useEffect, useState } from 'react'

export interface CustomerLite {
  id:         string
  first_name: string
  last_name:  string
  phone:      string | null
  email:      string | null
}

export interface VehicleLite {
  id:    string
  year:  number | null
  make:  string
  model: string
  vin:   string | null
}

export function vehicleLabel(v: VehicleLite): string {
  return [v.year, v.make, v.model].filter(Boolean).join(' ')
}

export default function CustomerUnitPicker({
  customerId, onCustomerChange,
  vehicleId,  onVehicleChange,
  unitLabel,  onUnitLabelChange,
  disabled = false,
}: {
  customerId:        string | null
  onCustomerChange:  (id: string | null, c: CustomerLite | null) => void
  vehicleId:         string | null
  onVehicleChange:   (id: string | null) => void
  unitLabel:         string
  onUnitLabelChange: (s: string) => void
  disabled?:         boolean
}) {
  const [search,    setSearch]    = useState('')
  const [customers, setCustomers] = useState<CustomerLite[]>([])
  const [vehicles,  setVehicles]  = useState<VehicleLite[]>([])
  const [loading,   setLoading]   = useState(false)
  const [err,       setErr]       = useState<string | null>(null)

  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [newCust, setNewCust] = useState({ first_name: '', last_name: '', phone: '', email: '' })
  const [savingCust, setSavingCust] = useState(false)

  const [creatingVehicle, setCreatingVehicle] = useState(false)
  const [newVeh, setNewVeh] = useState({ year: '', make: '', model: '', vin: '' })
  const [savingVeh, setSavingVeh] = useState(false)

  // Free text vs a real vehicles row. Seeded from whichever the record already has
  // so reopening a work order lands on the mode it was saved in.
  const [freeText, setFreeText] = useState(!!unitLabel && !vehicleId)

  // Debounced so typing a name does not fire a request per keystroke.
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const qs  = search.trim() ? `?search=${encodeURIComponent(search.trim())}&limit=25` : '?limit=25'
        const res = await fetch(`/api/customers${qs}`)
        const d   = await res.json()
        if (!cancelled) setCustomers(d.customers ?? [])
      } catch {
        if (!cancelled) setErr('Could not load customers.')
      }
      if (!cancelled) setLoading(false)
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [search])

  useEffect(() => {
    if (!customerId) { setVehicles([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/vehicles?customer_id=${customerId}&limit=50`)
        const d   = await res.json()
        if (!cancelled) setVehicles(d.vehicles ?? [])
      } catch { /* the free-text field is always available as a fallback */ }
    })()
    return () => { cancelled = true }
  }, [customerId])

  async function createCustomer() {
    if (!newCust.first_name.trim() || !newCust.last_name.trim()) {
      setErr('First and last name are required.')
      return
    }
    setSavingCust(true); setErr(null)
    try {
      const res = await fetch('/api/customers', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(newCust),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Could not create customer')
      const c = d.customer as CustomerLite
      setCustomers(prev => [c, ...prev])
      onCustomerChange(c.id, c)
      setCreatingCustomer(false)
      setNewCust({ first_name: '', last_name: '', phone: '', email: '' })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create customer')
    }
    setSavingCust(false)
  }

  async function createVehicle() {
    if (!customerId)             { setErr('Pick a customer first.'); return }
    if (!newVeh.make.trim())     { setErr('Make is required.');      return }
    setSavingVeh(true); setErr(null)
    try {
      const res = await fetch('/api/vehicles', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          customer_id: customerId,
          year:  newVeh.year ? Number(newVeh.year) : null,
          make:  newVeh.make.trim(),
          model: newVeh.model.trim(),
          vin:   newVeh.vin.trim() || null,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Could not add vehicle')
      const v = (d.vehicle ?? d) as VehicleLite
      setVehicles(prev => [v, ...prev])
      onVehicleChange(v.id)
      onUnitLabelChange('')
      setCreatingVehicle(false)
      setNewVeh({ year: '', make: '', model: '', vin: '' })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add vehicle')
    }
    setSavingVeh(false)
  }

  const selected = customers.find(c => c.id === customerId) ?? null

  return (
    <div className="space-y-5">
      {err && <div className="alert-error">{err}</div>}

      {/* ── Customer ── */}
      <div className="space-y-2">
        <label className="nwi-label">Customer</label>

        {selected ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="min-w-0">
              <p className="text-white text-sm font-medium truncate">
                {selected.first_name} {selected.last_name}
              </p>
              <p className="text-white/40 text-xs truncate">
                {selected.phone || selected.email || 'No contact details'}
              </p>
            </div>
            {!disabled && (
              <button
                type="button"
                onClick={() => { onCustomerChange(null, null); onVehicleChange(null) }}
                className="text-xs text-white/40 hover:text-orange transition-colors flex-shrink-0"
              >
                Change
              </button>
            )}
          </div>
        ) : (
          <>
            <input
              className="nwi-input"
              placeholder="Search by name, phone or email"
              value={search}
              onChange={e => setSearch(e.target.value)}
              disabled={disabled}
            />
            <div className="rounded-xl border border-white/10 overflow-hidden max-h-56 overflow-y-auto">
              {loading && <div className="px-4 py-3 text-white/30 text-sm">Searching…</div>}
              {!loading && customers.length === 0 && (
                <div className="px-4 py-3 text-white/25 text-sm">No customers found.</div>
              )}
              {customers.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onCustomerChange(c.id, c); onVehicleChange(null) }}
                  className="w-full text-left px-4 py-2.5 hover:bg-white/5 border-b border-white/5 last:border-0 transition-colors"
                >
                  <span className="text-white/80 text-sm">{c.first_name} {c.last_name}</span>
                  {c.phone && <span className="text-white/35 text-xs ml-2">{c.phone}</span>}
                </button>
              ))}
            </div>

            {creatingCustomer ? (
              <div className="rounded-xl border border-white/10 p-3 space-y-2 bg-white/5">
                <div className="grid grid-cols-2 gap-2">
                  <input className="nwi-input text-sm" placeholder="First name"
                    value={newCust.first_name}
                    onChange={e => setNewCust(v => ({ ...v, first_name: e.target.value }))} />
                  <input className="nwi-input text-sm" placeholder="Last name"
                    value={newCust.last_name}
                    onChange={e => setNewCust(v => ({ ...v, last_name: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className="nwi-input text-sm" placeholder="Phone"
                    value={newCust.phone}
                    onChange={e => setNewCust(v => ({ ...v, phone: e.target.value }))} />
                  <input className="nwi-input text-sm" placeholder="Email"
                    value={newCust.email}
                    onChange={e => setNewCust(v => ({ ...v, email: e.target.value }))} />
                </div>
                <p className="text-white/30 text-[11px]">
                  A phone number is what makes the status texts possible later.
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={createCustomer} disabled={savingCust}
                    className="px-3 py-1.5 bg-orange hover:bg-orange-hover text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50">
                    {savingCust ? 'Saving…' : 'Add Customer'}
                  </button>
                  <button type="button" onClick={() => setCreatingCustomer(false)}
                    className="px-3 py-1.5 border border-white/15 text-white/50 hover:text-white text-xs rounded-lg transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setCreatingCustomer(true)} disabled={disabled}
                className="text-xs text-white/40 hover:text-orange transition-colors">
                + New customer
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Unit ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="nwi-label mb-0">Unit</label>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const next = !freeText
              setFreeText(next)
              // Only one of the two can describe the unit, so switching clears the
              // other — otherwise a saved work order carries both and the label
              // shown depends on which reader wins.
              if (next) onVehicleChange(null)
              else      onUnitLabelChange('')
            }}
            className="text-xs text-white/40 hover:text-orange transition-colors"
          >
            {freeText ? 'Pick a vehicle instead' : 'Not a vehicle?'}
          </button>
        </div>

        {freeText ? (
          <>
            <input
              className="nwi-input"
              placeholder='e.g. "boat trailer", "shop compressor"'
              value={unitLabel}
              onChange={e => onUnitLabelChange(e.target.value)}
              disabled={disabled}
            />
            <p className="text-white/30 text-[11px]">
              Free text. Use this for anything without a year, make and model.
            </p>
          </>
        ) : !customerId ? (
          <p className="text-white/25 text-sm px-1">Pick a customer to see their vehicles.</p>
        ) : (
          <>
            <select
              className="nwi-input"
              value={vehicleId ?? ''}
              onChange={e => onVehicleChange(e.target.value || null)}
              disabled={disabled}
            >
              <option value="">— Select a vehicle —</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>{vehicleLabel(v)}{v.vin ? ` · ${v.vin}` : ''}</option>
              ))}
            </select>

            {creatingVehicle ? (
              <div className="rounded-xl border border-white/10 p-3 space-y-2 bg-white/5">
                <div className="grid grid-cols-3 gap-2">
                  <input className="nwi-input text-sm" placeholder="Year" inputMode="numeric"
                    value={newVeh.year}
                    onChange={e => setNewVeh(v => ({ ...v, year: e.target.value }))} />
                  <input className="nwi-input text-sm" placeholder="Make"
                    value={newVeh.make}
                    onChange={e => setNewVeh(v => ({ ...v, make: e.target.value }))} />
                  <input className="nwi-input text-sm" placeholder="Model"
                    value={newVeh.model}
                    onChange={e => setNewVeh(v => ({ ...v, model: e.target.value }))} />
                </div>
                <input className="nwi-input text-sm" placeholder="VIN (optional)"
                  value={newVeh.vin}
                  onChange={e => setNewVeh(v => ({ ...v, vin: e.target.value }))} />
                <div className="flex gap-2">
                  <button type="button" onClick={createVehicle} disabled={savingVeh}
                    className="px-3 py-1.5 bg-orange hover:bg-orange-hover text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50">
                    {savingVeh ? 'Saving…' : 'Add Vehicle'}
                  </button>
                  <button type="button" onClick={() => setCreatingVehicle(false)}
                    className="px-3 py-1.5 border border-white/15 text-white/50 hover:text-white text-xs rounded-lg transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setCreatingVehicle(true)} disabled={disabled}
                className="text-xs text-white/40 hover:text-orange transition-colors">
                + Add vehicle
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
