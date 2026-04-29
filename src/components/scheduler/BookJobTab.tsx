'use client'

import { useState, useEffect } from 'react'
import type { CustomerWithVehicles } from '@/types/jobs'
import { getServicesByBusinessType } from '@/lib/scheduler'

interface FormState {
  job_date: string
  job_time: string
  service_type: string
  custom_service: string
  customer_id: string
  vehicle_id: string
  location_address: string
  estimated_duration_minutes: string
  notes: string
  internal_notes: string
}

function makeDefaultForm(): FormState {
  return {
    job_date:                   new Date().toISOString().slice(0, 10),
    job_time:                   '',
    service_type:               '',
    custom_service:             '',
    customer_id:                '',
    vehicle_id:                 '',
    location_address:           '',
    estimated_duration_minutes: '60',
    notes:                      '',
    internal_notes:             '',
  }
}

export default function BookJobTab({ onSuccess, businessType }: { onSuccess: () => void; businessType?: string }) {
  const serviceTypes = getServicesByBusinessType(businessType ?? 'mechanic')
  const [form,      setForm]      = useState<FormState>(makeDefaultForm)
  const [customers, setCustomers] = useState<CustomerWithVehicles[]>([])
  const [loading,   setLoading]   = useState(false)
  const [custLoad,  setCustLoad]  = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [success,   setSuccess]   = useState(false)

  // Fetch customers for the dropdown
  useEffect(() => {
    fetch('/api/customers')
      .then((r) => r.json())
      .then((d) => setCustomers(d.customers ?? []))
      .catch(() => {})
      .finally(() => setCustLoad(false))
  }, [])

  function set(field: keyof FormState, value: string) {
    setForm((prev) => ({
      ...prev,
      [field]: value,
      // Reset vehicle when customer changes
      ...(field === 'customer_id' ? { vehicle_id: '' } : {}),
    }))
  }

  const selectedCustomer = customers.find((c) => c.id === form.customer_id)
  const vehicles         = selectedCustomer?.vehicles ?? []

  // Auto-fill address from customer address if available (customers table has address fields)
  // For simplicity, we just keep the address field free-form here

  function validate(): string | null {
    if (!form.job_date)                    return 'Job date is required.'
    const svcType = form.service_type === 'Other' ? form.custom_service : form.service_type
    if (!svcType.trim())                   return 'Service type is required.'
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const err = validate()
    if (err) { setError(err); return }

    setLoading(true)
    setError(null)

    const svcType = form.service_type === 'Other' ? form.custom_service : form.service_type

    const payload = {
      job_date:                   form.job_date,
      job_time:                   form.job_time || null,
      service_type:               svcType,
      customer_id:                form.customer_id  || null,
      vehicle_id:                 form.vehicle_id   || null,
      location_address:           form.location_address || null,
      estimated_duration_minutes: form.estimated_duration_minutes
                                    ? Number(form.estimated_duration_minutes)
                                    : null,
      notes:                      form.notes         || null,
      internal_notes:             form.internal_notes || null,
    }

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to create job')
      }

      setSuccess(true)
      setForm(makeDefaultForm())
      setTimeout(() => {
        setSuccess(false)
        onSuccess()
      }, 1800)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="nwi-card text-center py-16">
        <div className="w-14 h-14 bg-success/10 border border-success/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-success" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="font-condensed font-bold text-2xl text-white tracking-wide">JOB BOOKED!</p>
        <p className="text-white/50 text-sm mt-1">Redirecting to My Jobs…</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && <div className="alert-error">{error}</div>}

        {/* ── Service Details ── */}
        <div className="nwi-card space-y-4">
          <h2 className="font-condensed font-bold text-lg text-white tracking-wide flex items-center gap-2">
            <span className="w-6 h-6 bg-orange rounded-md flex items-center justify-center text-white text-xs font-bold">1</span>
            SERVICE DETAILS
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="nwi-label">Date <span className="text-danger">*</span></label>
              <input
                type="date"
                required
                value={form.job_date}
                onChange={(e) => set('job_date', e.target.value)}
                className="nwi-input"
              />
            </div>
            <div>
              <label className="nwi-label">Start Time</label>
              <input
                type="time"
                value={form.job_time}
                onChange={(e) => set('job_time', e.target.value)}
                className="nwi-input"
              />
            </div>
          </div>

          <div>
            <label className="nwi-label">Service Type <span className="text-danger">*</span></label>
            <select
              value={form.service_type}
              onChange={(e) => set('service_type', e.target.value)}
              className="nwi-input"
            >
              <option value="">— Select service type —</option>
              {serviceTypes.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {form.service_type === 'Other' && (
            <div>
              <label className="nwi-label">Describe the service <span className="text-danger">*</span></label>
              <input
                type="text"
                value={form.custom_service}
                onChange={(e) => set('custom_service', e.target.value)}
                placeholder="e.g. Steering rack replacement"
                className="nwi-input"
              />
            </div>
          )}

          <div>
            <label className="nwi-label">Est. Duration (minutes)</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="15"
                max="480"
                step="15"
                value={form.estimated_duration_minutes}
                onChange={(e) => set('estimated_duration_minutes', e.target.value)}
                className="flex-1 accent-orange"
              />
              <div className="w-20 nwi-input text-center py-2 font-condensed font-bold text-orange text-sm">
                {form.estimated_duration_minutes} min
              </div>
            </div>
          </div>
        </div>

        {/* ── Customer & Vehicle ── */}
        <div className="nwi-card space-y-4">
          <h2 className="font-condensed font-bold text-lg text-white tracking-wide flex items-center gap-2">
            <span className="w-6 h-6 bg-orange rounded-md flex items-center justify-center text-white text-xs font-bold">2</span>
            CUSTOMER &amp; VEHICLE
          </h2>

          <div>
            <label className="nwi-label">Customer</label>
            {custLoad ? (
              <div className="nwi-input text-white/30 text-sm">Loading customers…</div>
            ) : (
              <select
                value={form.customer_id}
                onChange={(e) => set('customer_id', e.target.value)}
                className="nwi-input"
              >
                <option value="">— Walk-in / No customer —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.last_name}, {c.first_name}
                    {c.phone ? ` · ${c.phone}` : ''}
                  </option>
                ))}
              </select>
            )}
            {customers.length === 0 && !custLoad && (
              <p className="text-white/30 text-xs mt-1">
                No customers yet. You can still book the job without one.
              </p>
            )}
          </div>

          {selectedCustomer && vehicles.length > 0 && (
            <div>
              <label className="nwi-label">Vehicle</label>
              <select
                value={form.vehicle_id}
                onChange={(e) => set('vehicle_id', e.target.value)}
                className="nwi-input"
              >
                <option value="">— Select vehicle —</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.year} {v.make} {v.model}
                    {v.color ? ` · ${v.color}` : ''}
                    {v.license_plate ? ` (${v.license_plate})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedCustomer && vehicles.length === 0 && (
            <p className="text-white/30 text-xs">No vehicles on file for this customer.</p>
          )}
        </div>

        {/* ── Location & Notes ── */}
        <div className="nwi-card space-y-4">
          <h2 className="font-condensed font-bold text-lg text-white tracking-wide flex items-center gap-2">
            <span className="w-6 h-6 bg-orange rounded-md flex items-center justify-center text-white text-xs font-bold">3</span>
            LOCATION &amp; NOTES
          </h2>

          <div>
            <label className="nwi-label">Job Location</label>
            <input
              type="text"
              value={form.location_address}
              onChange={(e) => set('location_address', e.target.value)}
              placeholder="4521 Main St, Dallas TX 75201"
              className="nwi-input"
            />
          </div>

          <div>
            <label className="nwi-label">Customer Notes</label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="What the customer reported, special requests…"
              className="nwi-input resize-none"
            />
          </div>

          <div>
            <label className="nwi-label">Internal Notes <span className="text-white/20">(not visible to customer)</span></label>
            <textarea
              rows={2}
              value={form.internal_notes}
              onChange={(e) => set('internal_notes', e.target.value)}
              placeholder="Parts to bring, access codes, etc."
              className="nwi-input resize-none"
            />
          </div>
        </div>

        {/* ── Submit ── */}
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'Booking…' : 'BOOK JOB'}
        </button>
      </form>
    </div>
  )
}
