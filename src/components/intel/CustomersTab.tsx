'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  Customer, CustomerListItem, Vehicle, ServiceRecord,
  CreateCustomerPayload, CreateVehiclePayload, CreateServicePayload,
} from '@/types/intel'
import { SERVICE_TYPES } from '@/lib/scheduler'

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMoney(n: number | null) {
  if (n == null) return null
  return `$${n.toFixed(2)}`
}

// ─── Add Customer Form ────────────────────────────────────────────────────────

function AddCustomerForm({ onCreated }: { onCreated: (c: CustomerListItem) => void }) {
  const blank = { first_name: '', last_name: '', phone: '', email: '', address_line1: '', city: '', state: '', zip: '' }
  const [form, setForm]     = useState(blank)
  const [loading, setLoad]  = useState(false)
  const [error, setError]   = useState<string | null>(null)

  function set(k: keyof typeof blank, v: string) { setForm(p => ({ ...p, [k]: v })) }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.first_name.trim() || !form.last_name.trim()) { setError('First and last name are required.'); return }
    setLoad(true); setError(null)
    const payload: CreateCustomerPayload = {
      first_name: form.first_name.trim(), last_name: form.last_name.trim(),
      phone: form.phone || null, email: form.email || null,
      address_line1: form.address_line1 || null, city: form.city || null,
      state: form.state || null, zip: form.zip || null,
    }
    try {
      const res = await fetch('/api/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      onCreated({ ...data.customer, vehicles: [] })
      setForm(blank)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unknown error') }
    finally { setLoad(false) }
  }

  return (
    <form onSubmit={submit} className="nwi-card space-y-3 mb-4">
      <p className="font-condensed font-bold text-white text-base tracking-wide">+ ADD CUSTOMER</p>
      {error && <div className="alert-error">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div><label className="nwi-label">First name *</label><input value={form.first_name} onChange={e => set('first_name', e.target.value)} className="nwi-input" placeholder="Marcus" /></div>
        <div><label className="nwi-label">Last name *</label><input value={form.last_name} onChange={e => set('last_name', e.target.value)} className="nwi-input" placeholder="Rodriguez" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="nwi-label">Phone</label><input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} className="nwi-input" placeholder="(555) 867-5309" /></div>
        <div><label className="nwi-label">Email</label><input type="email" value={form.email} onChange={e => set('email', e.target.value)} className="nwi-input" placeholder="marcus@email.com" /></div>
      </div>
      <div><label className="nwi-label">Address</label><input value={form.address_line1} onChange={e => set('address_line1', e.target.value)} className="nwi-input" placeholder="4521 Main St" /></div>
      <div className="grid grid-cols-3 gap-3">
        <div><label className="nwi-label">City</label><input value={form.city} onChange={e => set('city', e.target.value)} className="nwi-input" placeholder="Dallas" /></div>
        <div><label className="nwi-label">State</label><input value={form.state} onChange={e => set('state', e.target.value)} className="nwi-input" placeholder="TX" /></div>
        <div><label className="nwi-label">ZIP</label><input value={form.zip} onChange={e => set('zip', e.target.value)} className="nwi-input" placeholder="75201" /></div>
      </div>
      <button type="submit" disabled={loading} className="btn-primary text-sm py-2.5">{loading ? 'Saving…' : 'SAVE CUSTOMER'}</button>
    </form>
  )
}

// ─── Add Vehicle Form ─────────────────────────────────────────────────────────

function AddVehicleForm({ customerId, onCreated }: { customerId: string; onCreated: (v: Vehicle) => void }) {
  const blank = { year: '', make: '', model: '', trim: '', vin: '', color: '', mileage: '', license_plate: '', engine: '', transmission: '' }
  const [form, setForm]   = useState(blank)
  const [loading, setLoad] = useState(false)
  const [error, setError]  = useState<string | null>(null)

  function set(k: keyof typeof blank, v: string) { setForm(p => ({ ...p, [k]: v })) }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.make.trim() || !form.model.trim()) { setError('Make and model are required.'); return }
    setLoad(true); setError(null)
    const payload: CreateVehiclePayload = {
      customer_id: customerId, make: form.make.trim(), model: form.model.trim(),
      year: form.year ? Number(form.year) : null, trim: form.trim || null,
      vin: form.vin || null, color: form.color || null,
      mileage: form.mileage ? Number(form.mileage) : null,
      license_plate: form.license_plate || null, engine: form.engine || null,
      transmission: (form.transmission as CreateVehiclePayload['transmission']) || null,
    }
    try {
      const res = await fetch('/api/vehicles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      onCreated({ ...data.vehicle, service_history: [] })
      setForm(blank)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unknown error') }
    finally { setLoad(false) }
  }

  return (
    <form onSubmit={submit} className="bg-dark border border-dark-border rounded-xl p-4 space-y-3 mt-2">
      <p className="text-white/60 text-xs uppercase tracking-widest font-medium">Add Vehicle</p>
      {error && <div className="alert-error">{error}</div>}
      <div className="grid grid-cols-3 gap-2">
        <div><label className="nwi-label">Year</label><input type="number" value={form.year} onChange={e => set('year', e.target.value)} className="nwi-input" placeholder="2019" /></div>
        <div><label className="nwi-label">Make *</label><input value={form.make} onChange={e => set('make', e.target.value)} className="nwi-input" placeholder="Ford" /></div>
        <div><label className="nwi-label">Model *</label><input value={form.model} onChange={e => set('model', e.target.value)} className="nwi-input" placeholder="F-150" /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="nwi-label">Trim</label><input value={form.trim} onChange={e => set('trim', e.target.value)} className="nwi-input" placeholder="XLT" /></div>
        <div><label className="nwi-label">Color</label><input value={form.color} onChange={e => set('color', e.target.value)} className="nwi-input" placeholder="Magnetic Gray" /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="nwi-label">VIN</label><input value={form.vin} onChange={e => set('vin', e.target.value.toUpperCase())} className="nwi-input font-mono" placeholder="1FTFW1ET…" maxLength={17} /></div>
        <div><label className="nwi-label">License Plate</label><input value={form.license_plate} onChange={e => set('license_plate', e.target.value.toUpperCase())} className="nwi-input" placeholder="ABC-1234" /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="nwi-label">Current Mileage</label><input type="number" value={form.mileage} onChange={e => set('mileage', e.target.value)} className="nwi-input" placeholder="85000" /></div>
        <div>
          <label className="nwi-label">Transmission</label>
          <select value={form.transmission} onChange={e => set('transmission', e.target.value)} className="nwi-input">
            <option value="">— Select —</option>
            <option value="automatic">Automatic</option>
            <option value="manual">Manual</option>
            <option value="cvt">CVT</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={loading} className="flex-1 btn-primary text-sm py-2">{loading ? 'Saving…' : 'ADD VEHICLE'}</button>
      </div>
    </form>
  )
}

// ─── Log Service Form ─────────────────────────────────────────────────────────

function LogServiceForm({ vehicleId, onLogged }: { vehicleId: string; onLogged: (r: ServiceRecord) => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const blank = { service_date: today, service_type: '', mileage: '', amount: '', tech_notes: '', next_service_date: '', next_service_mileage: '' }
  const [form, setForm]   = useState(blank)
  const [loading, setLoad] = useState(false)
  const [error, setError]  = useState<string | null>(null)

  function set(k: keyof typeof blank, v: string) { setForm(p => ({ ...p, [k]: v })) }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.service_date || !form.service_type) { setError('Date and service type are required.'); return }
    setLoad(true); setError(null)
    const payload: CreateServicePayload = {
      vehicle_id: vehicleId, service_date: form.service_date,
      service_type: form.service_type, tech_notes: form.tech_notes || null,
      mileage_at_service: form.mileage ? Number(form.mileage) : null,
      amount_charged: form.amount ? Number(form.amount) : null,
      next_service_date: form.next_service_date || null,
      next_service_mileage: form.next_service_mileage ? Number(form.next_service_mileage) : null,
    }
    try {
      const res = await fetch('/api/service-history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      onLogged(data.record)
      setForm(blank)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unknown error') }
    finally { setLoad(false) }
  }

  return (
    <form onSubmit={submit} className="bg-dark border border-orange/20 rounded-xl p-4 space-y-3 mt-2">
      <p className="text-orange text-xs uppercase tracking-widest font-medium">Log Service Visit</p>
      {error && <div className="alert-error">{error}</div>}
      <div className="grid grid-cols-2 gap-2">
        <div><label className="nwi-label">Date *</label><input type="date" value={form.service_date} onChange={e => set('service_date', e.target.value)} className="nwi-input" /></div>
        <div>
          <label className="nwi-label">Service Type *</label>
          <select value={form.service_type} onChange={e => set('service_type', e.target.value)} className="nwi-input">
            <option value="">— Select —</option>
            {SERVICE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="nwi-label">Mileage</label><input type="number" value={form.mileage} onChange={e => set('mileage', e.target.value)} className="nwi-input" placeholder="85,000" /></div>
        <div><label className="nwi-label">Amount Charged ($)</label><input type="number" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} className="nwi-input" placeholder="89.99" /></div>
      </div>
      <div><label className="nwi-label">Tech Notes</label><textarea rows={2} value={form.tech_notes} onChange={e => set('tech_notes', e.target.value)} className="nwi-input resize-none" placeholder="Replaced oil filter, used 5W-30 full synthetic…" /></div>
      <div className="border-t border-dark-border pt-3">
        <p className="text-white/30 text-xs uppercase tracking-widest mb-2">Next Service Reminder (optional)</p>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="nwi-label">Next Service Date</label><input type="date" value={form.next_service_date} onChange={e => set('next_service_date', e.target.value)} className="nwi-input" /></div>
          <div><label className="nwi-label">Next Service Mileage</label><input type="number" value={form.next_service_mileage} onChange={e => set('next_service_mileage', e.target.value)} className="nwi-input" placeholder="88,000" /></div>
        </div>
      </div>
      <button type="submit" disabled={loading} className="w-full bg-orange hover:bg-orange-hover text-white font-condensed font-semibold rounded-lg py-2 text-sm transition-colors disabled:opacity-50">
        {loading ? 'Logging…' : 'LOG SERVICE VISIT'}
      </button>
    </form>
  )
}

const JOB_STATUS_COLORS: Record<string, string> = {
  scheduled:   'text-blue-300',
  en_route:    'text-yellow-400',
  in_progress: 'text-orange',
  completed:   'text-success',
  cancelled:   'text-white/30',
  no_show:     'text-danger',
}

// ─── Vehicle Card ─────────────────────────────────────────────────────────────

function VehicleCard({ vehicle, onServiceLogged, slug }: {
  vehicle: Vehicle
  onServiceLogged: (vehicleId: string, record: ServiceRecord) => void
  slug?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [showLog, setShowLog]   = useState(false)
  const history  = vehicle.service_history ?? []
  const jobsList = (vehicle.jobs ?? []).filter(j => j.status !== 'cancelled')

  return (
    <div className="rounded-xl border border-dark-border bg-dark overflow-hidden">
      {/* Vehicle header */}
      <button className="w-full flex items-center justify-between p-3 text-left hover:bg-dark-lighter transition-colors" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue/10 border border-blue/30 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-blue-light" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v5a2 2 0 0 1-2 2h-2" />
              <circle cx="7.5" cy="17.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" />
            </svg>
          </div>
          <div>
            <p className="text-white font-semibold text-sm">
              {vehicle.year ? `${vehicle.year} ` : ''}{vehicle.make} {vehicle.model}
              {vehicle.trim ? <span className="text-white/40 font-normal"> {vehicle.trim}</span> : null}
            </p>
            <p className="text-white/40 text-xs">
              {[vehicle.color, vehicle.license_plate, vehicle.mileage ? `${vehicle.mileage.toLocaleString()} mi` : null].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/30 text-xs">{history.length} visit{history.length !== 1 ? 's' : ''}</span>
          <svg className={`w-4 h-4 text-white/30 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-dark-border space-y-3 pt-3">
          {/* Vehicle detail chips */}
          <div className="flex flex-wrap gap-1.5">
            {vehicle.vin && <span className="text-[10px] bg-dark-input border border-dark-border rounded px-2 py-0.5 text-white/50 font-mono">{vehicle.vin}</span>}
            {vehicle.engine && <span className="text-[10px] bg-dark-input border border-dark-border rounded px-2 py-0.5 text-white/50">{vehicle.engine}</span>}
            {vehicle.transmission && <span className="text-[10px] bg-dark-input border border-dark-border rounded px-2 py-0.5 text-white/50 capitalize">{vehicle.transmission}</span>}
          </div>

          {/* Service history timeline */}
          {history.length > 0 ? (
            <div className="space-y-2">
              <p className="text-white/30 text-xs uppercase tracking-widest">Service History</p>
              {history.map((r, idx) => (
                <div key={r.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${idx === 0 ? 'bg-orange' : 'bg-white/20'}`} />
                    {idx < history.length - 1 && <div className="w-px flex-1 bg-dark-border mt-1" />}
                  </div>
                  <div className="pb-3 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-white text-xs font-semibold">{r.service_type}</span>
                      <span className="text-white/40 text-xs">{fmtDate(r.service_date)}</span>
                      {r.amount_charged && <span className="text-success text-xs font-medium">{fmtMoney(r.amount_charged)}</span>}
                    </div>
                    {r.mileage_at_service && <p className="text-white/30 text-xs">{r.mileage_at_service.toLocaleString()} mi</p>}
                    {r.tech_notes && <p className="text-white/50 text-xs mt-0.5 leading-relaxed">{r.tech_notes}</p>}
                    {r.next_service_date && (
                      <p className="text-blue-light text-[10px] mt-1">
                        Next: {fmtDate(r.next_service_date)}
                        {r.next_service_mileage ? ` · ${r.next_service_mileage.toLocaleString()} mi` : ''}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-white/25 text-xs">No service records yet.</p>
          )}

          {/* Booked job history */}
          {jobsList.length > 0 && (
            <div className="space-y-1.5 border-t border-dark-border pt-3">
              <div className="flex items-center justify-between">
                <p className="text-white/30 text-xs uppercase tracking-widest">Job History</p>
                {slug && (
                  <a
                    href={`/book/${slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] bg-orange hover:bg-orange-hover text-white font-condensed font-semibold rounded px-2.5 py-1 transition-colors whitespace-nowrap"
                  >
                    + Rebook
                  </a>
                )}
              </div>
              {jobsList.map(j => {
                const label = j.services && j.services.length > 1
                  ? j.services.join(', ')
                  : j.service_type
                return (
                  <div key={j.id} className="flex items-center gap-2 text-xs">
                    <span className="text-white/40 whitespace-nowrap">{fmtDate(j.job_date)}</span>
                    <span className="text-white/70 min-w-0 truncate">{label}</span>
                    <span className={`ml-auto whitespace-nowrap font-medium capitalize ${JOB_STATUS_COLORS[j.status] ?? 'text-white/30'}`}>
                      {j.status.replace('_', ' ')}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Log service toggle */}
          <button
            onClick={() => setShowLog(s => !s)}
            className="w-full text-xs border border-orange/30 text-orange hover:bg-orange/10 rounded-lg py-1.5 transition-colors"
          >
            {showLog ? '× Cancel' : '+ Log Service Visit'}
          </button>

          {showLog && (
            <LogServiceForm
              vehicleId={vehicle.id}
              onLogged={(record) => {
                onServiceLogged(vehicle.id, record)
                setShowLog(false)
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Customer Profile Panel ───────────────────────────────────────────────────

function CustomerProfile({
  customerId,
  onClose,
  onUpdated,
  slug,
}: {
  customerId: string
  onClose: () => void
  onUpdated: (c: CustomerListItem) => void
  slug?: string
}) {
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [showAddVehicle, setShowAddVehicle] = useState(false)
  const [editForm, setEditForm] = useState<Record<string, string>>({})
  const [saving, setSaving]     = useState(false)

  const fetchCustomer = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/customers/${customerId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCustomer(data.customer)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }, [customerId])

  useEffect(() => { fetchCustomer() }, [fetchCustomer])

  function startEdit() {
    if (!customer) return
    setEditForm({
      first_name: customer.first_name, last_name: customer.last_name,
      phone: customer.phone ?? '', email: customer.email ?? '',
      address_line1: customer.address_line1 ?? '', city: customer.city ?? '',
      state: customer.state ?? '', zip: customer.zip ?? '',
      notes: customer.notes ?? '',
    })
    setEditMode(true)
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: editForm.first_name, last_name: editForm.last_name,
          phone: editForm.phone || null, email: editForm.email || null,
          address_line1: editForm.address_line1 || null, city: editForm.city || null,
          state: editForm.state || null, zip: editForm.zip || null,
          notes: editForm.notes || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCustomer(prev => prev ? { ...prev, ...data.customer } : data.customer)
      onUpdated({ id: customerId, first_name: data.customer.first_name, last_name: data.customer.last_name, phone: data.customer.phone, email: data.customer.email, vehicles: (customer?.vehicles ?? []).map(v => ({ id: v.id })) })
      setEditMode(false)
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed to save') }
    finally { setSaving(false) }
  }

  function handleVehicleAdded(v: Vehicle) {
    setCustomer(prev => prev ? { ...prev, vehicles: [...(prev.vehicles ?? []), v] } : prev)
    onUpdated({ id: customerId, first_name: customer!.first_name, last_name: customer!.last_name, phone: customer!.phone, email: customer!.email, vehicles: [...(customer?.vehicles ?? []).map(vv => ({ id: vv.id })), { id: v.id }] })
    setShowAddVehicle(false)
  }

  function handleServiceLogged(vehicleId: string, record: ServiceRecord) {
    setCustomer(prev => {
      if (!prev) return prev
      return {
        ...prev,
        vehicles: (prev.vehicles ?? []).map(v =>
          v.id === vehicleId
            ? { ...v, service_history: [record, ...(v.service_history ?? [])] }
            : v,
        ),
      }
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between p-4 border-b border-dark-border flex-shrink-0">
        {loading || !customer ? (
          <div className="h-6 w-40 bg-dark-lighter rounded animate-pulse" />
        ) : (
          <div>
            <h2 className="font-condensed font-bold text-xl text-white tracking-wide">
              {customer.first_name} {customer.last_name}
            </h2>
            <p className="text-white/40 text-xs">{(customer.vehicles ?? []).length} vehicle{(customer.vehicles ?? []).length !== 1 ? 's' : ''}</p>
          </div>
        )}
        <div className="flex items-center gap-2">
          {!editMode && customer && (
            <button onClick={startEdit} className="text-xs border border-dark-border rounded-lg px-3 py-1.5 text-white/50 hover:text-white hover:border-white/30 transition-colors">Edit</button>
          )}
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg border border-dark-border text-white/40 hover:text-white hover:border-white/30 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {/* Panel body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {loading && <div className="text-white/30 text-sm text-center py-10">Loading…</div>}
        {error && <div className="alert-error">{error}</div>}

        {customer && !loading && (
          <>
            {/* Edit form */}
            {editMode ? (
              <form onSubmit={saveEdit} className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="nwi-label">First name</label><input value={editForm.first_name} onChange={e => setEditForm(p => ({ ...p, first_name: e.target.value }))} className="nwi-input" /></div>
                  <div><label className="nwi-label">Last name</label><input value={editForm.last_name} onChange={e => setEditForm(p => ({ ...p, last_name: e.target.value }))} className="nwi-input" /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="nwi-label">Phone</label><input value={editForm.phone} onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))} className="nwi-input" /></div>
                  <div><label className="nwi-label">Email</label><input type="email" value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} className="nwi-input" /></div>
                </div>
                <div><label className="nwi-label">Address</label><input value={editForm.address_line1} onChange={e => setEditForm(p => ({ ...p, address_line1: e.target.value }))} className="nwi-input" /></div>
                <div className="grid grid-cols-3 gap-2">
                  <div><label className="nwi-label">City</label><input value={editForm.city} onChange={e => setEditForm(p => ({ ...p, city: e.target.value }))} className="nwi-input" /></div>
                  <div><label className="nwi-label">State</label><input value={editForm.state} onChange={e => setEditForm(p => ({ ...p, state: e.target.value }))} className="nwi-input" /></div>
                  <div><label className="nwi-label">ZIP</label><input value={editForm.zip} onChange={e => setEditForm(p => ({ ...p, zip: e.target.value }))} className="nwi-input" /></div>
                </div>
                <div><label className="nwi-label">Notes</label><textarea rows={2} value={editForm.notes} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} className="nwi-input resize-none" /></div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEditMode(false)} className="flex-1 border border-dark-border rounded-lg py-2 text-white/50 hover:text-white text-sm transition-colors">Cancel</button>
                  <button type="submit" disabled={saving} className="flex-1 bg-orange hover:bg-orange-hover text-white font-condensed font-semibold rounded-lg py-2 text-sm transition-colors disabled:opacity-50">{saving ? 'Saving…' : 'SAVE'}</button>
                </div>
              </form>
            ) : (
              /* Customer info display */
              <div className="space-y-1">
                {customer.phone  && <p className="text-white/70 text-sm">📞 {customer.phone}</p>}
                {customer.email  && <p className="text-white/70 text-sm">✉️ {customer.email}</p>}
                {customer.address_line1 && (
                  <p className="text-white/50 text-sm">
                    📍 {[customer.address_line1, customer.city, customer.state, customer.zip].filter(Boolean).join(', ')}
                  </p>
                )}
                {customer.notes  && <p className="text-white/40 text-xs mt-2 italic">{customer.notes}</p>}
              </div>
            )}

            {/* Vehicles */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-white/40 text-xs uppercase tracking-widest">Vehicles</p>
                <button onClick={() => setShowAddVehicle(s => !s)} className="text-xs text-orange hover:text-orange-light transition-colors">
                  {showAddVehicle ? '× Cancel' : '+ Add Vehicle'}
                </button>
              </div>

              {showAddVehicle && (
                <AddVehicleForm customerId={customerId} onCreated={handleVehicleAdded} />
              )}

              <div className="space-y-2 mt-2">
                {(customer.vehicles ?? []).length === 0 && !showAddVehicle && (
                  <p className="text-white/25 text-xs text-center py-4">No vehicles on file. Add one above.</p>
                )}
                {(customer.vehicles ?? []).map(v => (
                  <VehicleCard key={v.id} vehicle={v} onServiceLogged={handleServiceLogged} slug={slug} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CustomersTab({ slug }: { slug?: string }) {
  const [customers,    setCustomers]  = useState<CustomerListItem[]>([])
  const [loading,      setLoading]    = useState(true)
  const [error,        setError]      = useState<string | null>(null)
  const [search,       setSearch]     = useState('')
  const [selectedId,   setSelectedId] = useState<string | null>(null)
  const [showAddForm,  setShowAddForm] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchCustomers = useCallback(async (q?: string) => {
    setLoading(true); setError(null)
    try {
      const url = q ? `/api/customers?search=${encodeURIComponent(q)}` : '/api/customers'
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCustomers(data.customers ?? [])
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchCustomers() }, [fetchCustomers])

  function handleSearchChange(val: string) {
    setSearch(val)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => fetchCustomers(val || undefined), 300)
  }

  function handleCustomerCreated(c: CustomerListItem) {
    setCustomers(prev => [c, ...prev].sort((a, b) => a.last_name.localeCompare(b.last_name)))
    setShowAddForm(false)
    setSelectedId(c.id)
  }

  function handleCustomerUpdated(c: CustomerListItem) {
    setCustomers(prev => prev.map(x => x.id === c.id ? { ...x, ...c } : x))
  }

  return (
    <div className="flex gap-5 h-[calc(100vh-220px)] min-h-[500px]">
      {/* ── Left: customer list ── */}
      <div className={`flex flex-col ${selectedId ? 'hidden lg:flex lg:w-80 flex-shrink-0' : 'flex-1'}`}>
        {/* Search + Add */}
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search customers…"
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              className="nwi-input pl-9"
            />
          </div>
          <button
            onClick={() => setShowAddForm(s => !s)}
            className={`flex-shrink-0 px-3 rounded-lg border text-sm font-medium transition-colors ${showAddForm ? 'bg-orange text-white border-orange' : 'border-dark-border text-white/50 hover:text-white hover:border-white/30'}`}
          >
            {showAddForm ? '×' : '+'}
          </button>
        </div>

        {showAddForm && (
          <AddCustomerForm onCreated={handleCustomerCreated} />
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto space-y-1 pr-1">
          {loading && <div className="text-white/30 text-sm text-center py-10">Loading…</div>}
          {error   && <div className="alert-error">{error}</div>}

          {!loading && customers.length === 0 && (
            <div className="text-center py-16">
              <p className="text-4xl mb-3">👤</p>
              <p className="font-condensed font-bold text-xl text-white mb-2">NO CUSTOMERS YET</p>
              <p className="text-white/40 text-sm">{search ? 'No results for that search.' : 'Add your first customer above.'}</p>
            </div>
          )}

          {customers.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                selectedId === c.id
                  ? 'border-orange bg-orange/10'
                  : 'border-dark-border hover:border-white/20 bg-dark-card'
              }`}
            >
              <p className="font-semibold text-white text-sm">{c.last_name}, {c.first_name}</p>
              <div className="flex items-center gap-3 mt-0.5">
                {c.phone && <span className="text-white/40 text-xs">{c.phone}</span>}
                <span className="text-white/30 text-xs ml-auto">{(c.vehicles ?? []).length} vehicle{(c.vehicles ?? []).length !== 1 ? 's' : ''}</span>
              </div>
              {c.email && <p className="text-white/30 text-xs truncate">{c.email}</p>}
            </button>
          ))}
        </div>
      </div>

      {/* ── Right: customer profile ── */}
      {selectedId ? (
        <div className="flex-1 min-w-0 nwi-card p-0 overflow-hidden">
          <CustomerProfile
            customerId={selectedId}
            onClose={() => setSelectedId(null)}
            onUpdated={handleCustomerUpdated}
            slug={slug}
          />
        </div>
      ) : (
        <div className="hidden lg:flex flex-1 items-center justify-center nwi-card">
          <div className="text-center">
            <div className="w-14 h-14 bg-blue/10 border border-blue/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-blue-light" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <p className="font-condensed font-bold text-xl text-white mb-1">SELECT A CUSTOMER</p>
            <p className="text-white/40 text-sm">Pick a customer from the list to view their profile, vehicles, and service history.</p>
          </div>
        </div>
      )}
    </div>
  )
}
