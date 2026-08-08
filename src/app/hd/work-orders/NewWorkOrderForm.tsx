'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const HD_ORANGE = '#E85D24'

const JOB_TYPES = ['Diagnostic', 'PM Service', 'Repair', 'Tire Service', 'Road Call', 'Other']

interface Unit {
  id: string
  unit_number: string
  manufacturer: string
  model: string
  serial_number: string | null
  fleet_account_id: string | null
}
interface FleetAccount { id: string; fleet_name: string }

const inputStyle = { background: '#162030', border: '1px solid #1e3040' }
const inputCls = 'w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/25'
const lblCls = 'block text-xs uppercase tracking-widest mb-1.5'

export default function NewWorkOrderForm({ units, fleetAccounts, presetAccountId }: { units: Unit[]; fleetAccounts: FleetAccount[]; presetAccountId?: string | null }) {
  const router = useRouter()

  const preset = presetAccountId ? fleetAccounts.find(a => a.id === presetAccountId) ?? null : null
  const today = new Date().toISOString().slice(0, 10)
  const [customerName, setCustomerName]   = useState(preset?.fleet_name ?? '')
  const [accountId, setAccountId]         = useState(preset?.id ?? '')
  const [showAccts, setShowAccts]         = useState(false)
  const [unitId, setUnitId]               = useState('')
  const [serviceType, setServiceType]     = useState('Diagnostic')
  const [jobDescription, setJobDescription] = useState('')
  const [scheduledDate, setScheduledDate] = useState(today)
  const [scheduledTime, setScheduledTime] = useState('09:00')
  const [estHours, setEstHours]           = useState('1')
  const [notes, setNotes]                 = useState('')
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState<string | null>(null)

  const acctMatches = customerName.trim()
    ? fleetAccounts.filter(a => a.fleet_name.toLowerCase().includes(customerName.trim().toLowerCase())).slice(0, 8)
    : fleetAccounts.slice(0, 8)
  const visibleUnits = accountId ? units.filter(u => u.fleet_account_id === accountId) : units
  const selectedUnit = units.find(u => u.id === unitId) ?? null

  function pickAccount(a: FleetAccount) {
    setAccountId(a.id)
    setCustomerName(a.fleet_name)
    setShowAccts(false)
    if (unitId && !units.some(u => u.id === unitId && u.fleet_account_id === a.id)) setUnitId('')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!customerName.trim()) { setError('Customer name is required.'); return }
    if (!scheduledDate) { setError('Scheduled date is required.'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/hd/work-orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name:            customerName.trim(),
          fleet_account_id:         accountId || undefined,
          unit_id:                  unitId || undefined,
          unit_manufacturer:        selectedUnit?.manufacturer || undefined,
          unit_model:               selectedUnit?.model || undefined,
          unit_serial:              selectedUnit?.serial_number || undefined,
          service_type:             serviceType,
          job_description:          jobDescription || undefined,
          scheduled_date:           scheduledDate,
          scheduled_time:           scheduledTime || undefined,
          estimated_duration_hours: estHours || undefined,
          notes:                    notes || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not create work order.'); return }
      // Show in the list.
      router.push('/hd/work-orders')
      router.refresh()
    } catch {
      setError('Could not create work order — check your connection.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl p-6 mb-6 space-y-4" style={{ background: '#111920', border: `1px solid ${HD_ORANGE}50` }}>
      <p className="font-condensed font-bold text-white text-lg tracking-wide">NEW WORK ORDER</p>
      {error && (
        <p className="text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)' }}>{error}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Customer search */}
        <div style={{ position: 'relative' }}>
          <label className={lblCls} style={{ color: 'rgba(255,255,255,0.4)' }}>Customer *</label>
          <input
            value={customerName}
            onChange={e => { setCustomerName(e.target.value); if (accountId) setAccountId(''); setShowAccts(true) }}
            onFocus={() => setShowAccts(true)}
            placeholder="Search fleet accounts or type a name"
            className={inputCls}
            style={inputStyle}
          />
          {showAccts && acctMatches.length > 0 && !accountId && (
            <div style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, marginTop: 4, background: '#111920', border: '1px solid #1e3040', borderRadius: 8, overflow: 'hidden', maxHeight: 220, overflowY: 'auto' }}>
              {acctMatches.map(a => (
                <button key={a.id} type="button" onMouseDown={ev => { ev.preventDefault(); pickAccount(a) }}
                  className="w-full text-left px-3 py-2.5 text-sm text-white hover:bg-white/5" style={{ borderBottom: '1px solid #1e3040' }}>
                  {a.fleet_name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Unit dropdown (filtered by customer) */}
        <div>
          <label className={lblCls} style={{ color: 'rgba(255,255,255,0.4)' }}>Unit</label>
          <select value={unitId} onChange={e => setUnitId(e.target.value)} className={inputCls} style={inputStyle}>
            <option value="">— Select unit —</option>
            {visibleUnits.map(u => (
              <option key={u.id} value={u.id}>{u.unit_number} — {u.manufacturer} {u.model}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={lblCls} style={{ color: 'rgba(255,255,255,0.4)' }}>Job Type</label>
          <select value={serviceType} onChange={e => setServiceType(e.target.value)} className={inputCls} style={inputStyle}>
            {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div>
          <label className={lblCls} style={{ color: 'rgba(255,255,255,0.4)' }}>Estimated Hours</label>
          <input type="number" min="0" step="0.5" value={estHours} onChange={e => setEstHours(e.target.value)} className={inputCls} style={inputStyle} />
        </div>

        <div>
          <label className={lblCls} style={{ color: 'rgba(255,255,255,0.4)' }}>Scheduled Date *</label>
          <input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} className={inputCls} style={inputStyle} />
        </div>

        <div>
          <label className={lblCls} style={{ color: 'rgba(255,255,255,0.4)' }}>Scheduled Time</label>
          <input type="time" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} className={inputCls} style={inputStyle} />
        </div>
      </div>

      <div>
        <label className={lblCls} style={{ color: 'rgba(255,255,255,0.4)' }}>Job Description</label>
        <textarea rows={2} value={jobDescription} onChange={e => setJobDescription(e.target.value)} placeholder="What needs to be done?" className={`${inputCls} resize-none`} style={inputStyle} />
      </div>

      <div>
        <label className={lblCls} style={{ color: 'rgba(255,255,255,0.4)' }}>Notes</label>
        <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Location, gate code, on-site contact…" className={`${inputCls} resize-none`} style={inputStyle} />
      </div>

      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={saving} className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-60" style={{ background: HD_ORANGE }}>
          {saving ? 'Saving…' : 'Save Work Order'}
        </button>
        <Link href="/hd/work-orders" className="px-4 py-2.5 rounded-lg text-sm border" style={{ color: 'rgba(255,255,255,0.5)', borderColor: '#1e3040' }}>Cancel</Link>
      </div>
    </form>
  )
}
