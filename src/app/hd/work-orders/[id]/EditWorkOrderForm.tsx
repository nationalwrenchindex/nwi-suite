'use client'

// The work order's HEADER: who it is for, what machine, what is wrong, when. Money is
// deliberately absent - the rates, tax and terms came off the approved quote and do not
// drift through an edit screen, and the line items have their own editor on the work
// order that re-prices properly.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const HD_ORANGE = '#E85D24'

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** An ISO timestamp as the value a datetime-local input wants, in the browser's zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const inp: React.CSSProperties = {
  width: '100%', borderRadius: 8, padding: '10px 12px', fontSize: 14, minHeight: 44, outline: 'none',
  background: 'var(--hd-inner)', color: 'rgba(var(--hd-ink-rgb), 0.9)', border: '1px solid var(--hd-border)',
}
const card: React.CSSProperties = {
  background: 'var(--hd-card)', border: '1px solid var(--hd-border)', borderRadius: 12, padding: 20, marginBottom: 20,
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <label className="text-xs uppercase tracking-wider" style={{ color: 'var(--hd-text-muted)', fontSize: 10 }}>{label}</label>
      {children}
    </div>
  )
}

export default function EditWorkOrderForm({ workOrder: wo }: { workOrder: Record<string, unknown> }) {
  const router = useRouter()
  const id = String(wo.id)
  const locked = wo.status === 'invoiced'
  // The migration-159 columns are only on the row once it is applied. Their fields are
  // shown either way; the save reports if they could not be kept.
  const [form, setForm] = useState({
    customer_name:     str(wo.customer_name),
    customer_phone:    str(wo.customer_phone),
    unit_number:       str(wo.unit_number),
    unit_manufacturer: str(wo.unit_manufacturer),
    unit_model:        str(wo.unit_model),
    unit_serial:       str(wo.unit_serial),
    unit_year:         str(wo.unit_year),
    truck_make:        str(wo.truck_make),
    truck_model:       str(wo.truck_model),
    truck_year:        str(wo.truck_year),
    vin:               str(wo.vin),
    service_requests:  str(wo.service_requests),
    comments:          str(wo.comments),
    tech_name:         str(wo.tech_name),
  })
  // Set after mount: the browser's zone is the one the tech means, and computing it
  // during the server render would print the server's.
  const [scheduled, setScheduled] = useState('')
  useEffect(() => { if (wo.scheduled_at) setScheduled(toLocalInput(String(wo.scheduled_at))) }, [wo.scheduled_at])

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  function setField(k: keyof typeof form, v: string) { setForm(f => ({ ...f, [k]: v })) }

  // Before migration 159 the row has no unit year / truck / VIN columns. A BLANK one is
  // then left out rather than sent, so a save that changes nothing there does not come
  // back "not saved"; a typed one is sent, and the route says it could not be kept.
  const has159 = 'unit_year' in wo
  function body159Aware(): Record<string, string> {
    const out: Record<string, string> = { ...form }
    if (!has159) {
      for (const k of ['unit_year', 'truck_make', 'truck_model', 'truck_year', 'vin'] as const) {
        if (!form[k].trim()) delete out[k]
      }
    }
    return out
  }

  async function save() {
    setSaving(true); setMessage('')
    try {
      const res = await fetch(`/api/hd/work-orders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body159Aware(),
          scheduled_at: scheduled ? new Date(scheduled).toISOString() : null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setMessage(String(data.error ?? 'Could not save the work order.')); return }
      const notSaved = Array.isArray(data.not_saved) ? data.not_saved as string[] : []
      if (notSaved.length) {
        setMessage(`Saved, except ${notSaved.join(', ')} - those need migration 159 applied first.`)
        return
      }
      router.push(`/hd/work-orders/${id}`)
    } finally {
      setSaving(false)
    }
  }

  const text = (k: keyof typeof form, label: string, placeholder = '', wide = false) => (
    <Field label={label} wide={wide}>
      <input style={inp} value={form[k]} placeholder={placeholder} disabled={locked}
             onChange={e => setField(k, e.target.value)} />
    </Field>
  )

  return (
    <main className="flex-1 min-h-screen" style={{ background: 'var(--hd-bg)' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 20px' }}>
        <div className="flex items-center gap-3 mb-6">
          <Link href={`/hd/work-orders/${id}`} style={{ color: 'var(--hd-text-muted)', fontSize: 13 }}>← Work Order</Link>
          <span style={{ color: 'var(--hd-border)' }}>/</span>
          <span className="font-condensed font-bold text-2xl text-white">EDIT {str(wo.work_order_number)}</span>
        </div>

        {locked && (
          <p className="text-sm mb-4" style={{ color: 'var(--hd-warn)' }}>
            This work order has been invoiced, so it is locked. Edit the invoice, or reopen the work order first.
          </p>
        )}
        <p className="text-xs mb-4" style={{ color: 'var(--hd-text-muted)' }}>
          Rates, tax and terms are not edited here: they came from the approved quote. Parts and labor are edited on the work order itself.
        </p>

        <div style={card}>
          <p className="font-condensed font-bold text-white text-sm tracking-widest mb-3">CUSTOMER</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {text('customer_name', 'Customer Name')}
            {text('customer_phone', 'Phone')}
          </div>
        </div>

        <div style={card}>
          <p className="font-condensed font-bold text-white text-sm tracking-widest mb-3">UNIT</p>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-4">
            {text('unit_number', 'Unit Number', 'e.g. 53169')}
            {text('unit_manufacturer', 'Manufacturer', 'e.g. Thermo King')}
            {text('unit_model', 'Unit Model', 'e.g. S-600')}
            {text('unit_serial', 'Serial Number')}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            {text('unit_year', 'Unit Year', 'e.g. 2018')}
            {text('truck_make', 'Truck Make', 'e.g. Freightliner')}
            {text('truck_model', 'Truck Model', 'e.g. Cascadia')}
            {text('truck_year', 'Truck Year', 'e.g. 2020')}
            {text('vin', 'VIN', '17-digit VIN', true)}
          </div>
        </div>

        <div style={card}>
          <p className="font-condensed font-bold text-white text-sm tracking-widest mb-3">THE JOB</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Complaint (service requested)" wide>
              <textarea style={{ ...inp, minHeight: 80 }} value={form.service_requests} disabled={locked}
                        onChange={e => setField('service_requests', e.target.value)} />
            </Field>
            <Field label="Diagnosis (comments)" wide>
              <textarea style={{ ...inp, minHeight: 80 }} value={form.comments} disabled={locked}
                        onChange={e => setField('comments', e.target.value)} />
            </Field>
            <Field label="Scheduled">
              <input style={inp} type="datetime-local" value={scheduled} disabled={locked}
                     onChange={e => setScheduled(e.target.value)} />
            </Field>
            {text('tech_name', 'Tech', 'Who is doing the work')}
          </div>
        </div>

        {message && <p className="text-sm mb-4" style={{ color: 'var(--hd-warn)' }}>{message}</p>}

        <div className="flex gap-3 pb-8">
          <Link href={`/hd/work-orders/${id}`} className="flex-1 py-3 rounded-lg text-center font-semibold text-sm"
                style={{ background: 'var(--hd-inner)', color: 'rgba(var(--hd-ink-rgb), 0.7)', border: '1px solid var(--hd-border)' }}>
            Cancel
          </Link>
          <button onClick={save} disabled={saving || locked}
                  className="flex-1 py-3 rounded-lg font-semibold text-sm text-on-accent disabled:opacity-50"
                  style={{ background: HD_ORANGE, minHeight: 48 }}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </main>
  )
}
