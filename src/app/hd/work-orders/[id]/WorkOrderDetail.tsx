'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
// Safe from a client component: the module's only server dependency is a type-only
// import of the Supabase server client, which is erased at build time.
import { inspectionDateLabel, type InspectionSummary } from '@/lib/hd/inspections'
// BrandHeader has no hooks and no server-only imports, so it renders fine inside
// this client component.
import { BrandHeader } from '@/components/BrandHeader'
import type { Branding } from '@/lib/branding'

const HD_ORANGE = '#E85D24'

type WO = {
  id: string
  work_order_number: string | null
  status: string
  service_type: string | null
  location: string | null
  service_requests: string | null
  comments: string | null
  tech_name: string | null
  labor_hours: number | null
  labor_rate: number | null
  total_amount: number | null
  current_setpoint: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  // Denormalized fields an ad-hoc scheduler booking leaves on the work order when
  // the job was free-typed instead of linked to an hd_unit / hd_fleet_account.
  customer_name: string | null
  customer_phone: string | null
  unit_manufacturer: string | null
  unit_model: string | null
  unit_serial: string | null
  unit: { id: string; unit_number: string; manufacturer: string; model: string; year: number | null; serial_number: string | null } | null
  fleet: { id: string; fleet_name: string } | null
}

type Photo = {
  id: string
  category: string
  file_url: string
  file_name: string | null
  caption: string | null
  taken_at: string
  signedUrl: string | null
}

interface Props {
  workOrder: WO
  photos: Photo[]
  inspections: InspectionSummary[]
  workOrderId: string
  branding: Branding
}

const CATEGORIES = [
  { id: 'before',  label: 'Before Service' },
  { id: 'during',  label: 'During Service' },
  { id: 'after',   label: 'After Service' },
]

function statusColor(s: string) {
  return s === 'in_progress' ? HD_ORANGE : s === 'completed' ? '#22C55E' : s === 'invoiced' ? '#3B82F6' : 'rgba(255,255,255,0.4)'
}
function statusLabel(s: string) {
  return s === 'in_progress' ? 'In Progress' : s === 'completed' ? 'Completed' : s === 'invoiced' ? 'Invoiced' : 'Open'
}

async function compressImage(file: File, maxPx = 1400, quality = 0.82): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.width  * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob(blob => resolve(blob ?? file), 'image/jpeg', quality)
    }
    img.src = url
  })
}

export default function WorkOrderDetail({ workOrder: wo, photos: initialPhotos, inspections, workOrderId, branding }: Props) {
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos)
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [status, setStatus] = useState(wo.status)
  const [reopening, setReopening] = useState(false)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const supabase = createClient()

  // Escape hatch out of the invoiced state. Invoicing a job used to be terminal, so
  // voiding an invoice left the work order stranded with no way to re-bill it. The
  // scheduler never lists invoiced jobs, so this is the only place it can be undone.
  async function handleReopen() {
    if (!confirm(
      'Reopen this work order?\n\nIt moves back to Completed so it can be invoiced again. ' +
      'Any invoice already created from it is left alone — void that separately.'
    )) return

    setReopening(true)
    try {
      const res = await fetch(`/api/hd/work-orders/${workOrderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Reopen failed')
      }
      setStatus('completed')
    } catch (err) {
      console.error(err)
      alert(err instanceof Error ? err.message : 'Reopen failed. Please try again.')
    } finally {
      setReopening(false)
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>, category: string) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    setUploading(u => ({ ...u, [category]: true }))
    try {
      const blob = await compressImage(file)
      const ext  = 'jpg'
      const path = `${workOrderId}/${category}/${Date.now()}.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from('hd-work-order-photos')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (uploadErr) throw uploadErr

      const { data: signedData } = await supabase.storage
        .from('hd-work-order-photos')
        .createSignedUrl(path, 3600)

      const res = await fetch(`/api/hd/work-orders/${workOrderId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_url: path, file_name: file.name, category }),
      })
      if (!res.ok) throw new Error('Metadata save failed')
      const { photo } = await res.json() as { photo: Photo }

      setPhotos(prev => [...prev, { ...photo, signedUrl: signedData?.signedUrl ?? null }])
    } catch (err) {
      console.error(err)
      alert('Photo upload failed. Please try again.')
    } finally {
      setUploading(u => ({ ...u, [category]: false }))
    }
  }

  async function handleDelete(photoId: string, storagePath: string) {
    if (!confirm('Delete this photo?')) return
    await fetch(`/api/hd/work-orders/${workOrderId}/photos?photoId=${photoId}`, { method: 'DELETE' })
    setPhotos(prev => prev.filter(p => p.id !== photoId))
    void storagePath
  }

  const woLabel = wo.work_order_number ?? `WO-${wo.id.slice(0, 6).toUpperCase()}`

  // Convert this work order into a new invoice. Everything the invoice form needs
  // rides in the query string — the same approach the inspection buttons below and
  // the PM-schedule links already use, since there is no GET route for a single
  // work order. Work orders carry no line items of their own, so the form
  // synthesizes one labor line from labor_hours × labor_rate.
  const invoiceHref = (() => {
    const p = new URLSearchParams()
    p.set('work_order_id', workOrderId)
    p.set('work_order_number', woLabel)

    // A fleet job bills to the fleet; an ad-hoc booking bills to the typed customer.
    const customer = wo.fleet?.fleet_name ?? wo.customer_name
    if (customer)             p.set('customer_name', customer)
    if (wo.fleet?.fleet_name) p.set('company_name', wo.fleet.fleet_name)
    if (wo.customer_phone)    p.set('customer_phone', wo.customer_phone)

    // Prefer the linked unit record, falling back to the free-typed unit fields.
    const mfr    = wo.unit?.manufacturer   ?? wo.unit_manufacturer
    const model  = wo.unit?.model          ?? wo.unit_model
    const serial = wo.unit?.serial_number  ?? wo.unit_serial
    if (mfr)           p.set('unit_manufacturer', mfr)
    if (model)         p.set('unit_model', model)
    if (serial)        p.set('unit_serial', serial)
    if (wo.unit?.year) p.set('unit_year', String(wo.unit.year))

    if (wo.labor_rate  != null) p.set('labor_rate',  String(wo.labor_rate))
    if (wo.labor_hours != null) p.set('labor_hours', String(wo.labor_hours))
    if (wo.service_type)        p.set('service_type', wo.service_type)
    if (wo.service_requests)    p.set('complaint', wo.service_requests)
    if (wo.comments)            p.set('diagnosis', wo.comments)

    return `/hd/invoices/new?${p.toString()}`
  })()

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Subscriber branding — logo when one is uploaded, business name in text
          when not. This is the subscriber's document, so their mark leads it. */}
      <div
        className="rounded-xl px-5 py-4 mb-5 text-white"
        style={{ background: '#111920', border: '1px solid #1e3040' }}
      >
        <BrandHeader branding={branding} subtitle={`Work Order ${woLabel}`} />
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <Link href="/hd/work-orders" className="text-xs mb-2 inline-block" style={{ color: 'rgba(255,255,255,0.4)' }}>
            ← Work Orders
          </Link>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">{woLabel}</h1>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: `${statusColor(status)}20`, color: statusColor(status) }}>
              {statusLabel(status)}
            </span>
            {wo.service_type && <span className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>{wo.service_type}</span>}
            {/* An invoiced job is already billed, so offer the way back out instead of
                a second Create Invoice that would quietly double-bill it. */}
            {status === 'invoiced' ? (
              <button
                onClick={handleReopen}
                disabled={reopening}
                className="px-3 py-1.5 rounded-lg text-xs font-condensed font-bold tracking-wide disabled:opacity-50"
                style={{ background: '#162030', color: 'rgba(255,255,255,0.7)', border: '1px solid #1e3040' }}
              >
                {reopening ? 'Reopening…' : '↩ Reopen Work Order'}
              </button>
            ) : (
              <Link
                href={invoiceHref}
                className="px-3 py-1.5 rounded-lg text-xs font-condensed font-bold tracking-wide"
                style={{ background: `${HD_ORANGE}18`, color: HD_ORANGE, border: `1px solid ${HD_ORANGE}55` }}
              >
                + Create Invoice
              </Link>
            )}
          </div>
        </div>
        <p className="text-xs mt-1 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {new Date(wo.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      {/* Work Order Info */}
      <div className="rounded-xl p-5 mb-6" style={{ background: '#111920', border: '1px solid #1e3040' }}>
        <p className="font-condensed font-bold text-white text-sm tracking-widest mb-3">WORK ORDER DETAILS</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {[
            { label: 'Unit', value: wo.unit ? `${wo.unit.unit_number} — ${wo.unit.manufacturer} ${wo.unit.model}${wo.unit.year ? ` (${wo.unit.year})` : ''}` : '—' },
            { label: 'Fleet', value: wo.fleet?.fleet_name ?? '—' },
            { label: 'Tech', value: wo.tech_name ?? '—' },
            { label: 'Location', value: wo.location ?? '—' },
            { label: 'Setpoint', value: wo.current_setpoint ?? '—' },
            { label: 'Labor', value: wo.labor_hours ? `${wo.labor_hours}h @ $${wo.labor_rate ?? '—'}/hr` : '—' },
            { label: 'Total', value: wo.total_amount ? `$${Number(wo.total_amount).toFixed(2)}` : '—' },
            { label: 'Serial / VIN', value: wo.unit?.serial_number ?? '—' },
          ].map(({ label, value }) => (
            <div key={label}>
              <span className="text-xs uppercase tracking-wider block mb-0.5" style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>{label}</span>
              <span style={{ color: 'rgba(255,255,255,0.85)' }}>{value}</span>
            </div>
          ))}
        </div>
        {wo.service_requests && (
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid #1e3040' }}>
            <span className="text-xs uppercase tracking-wider block mb-1" style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>Service Requests</span>
            <p className="text-sm whitespace-pre-wrap" style={{ color: 'rgba(255,255,255,0.75)' }}>{wo.service_requests}</p>
          </div>
        )}
        {wo.comments && (
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid #1e3040' }}>
            <span className="text-xs uppercase tracking-wider block mb-1" style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>Comments</span>
            <p className="text-sm whitespace-pre-wrap" style={{ color: 'rgba(255,255,255,0.75)' }}>{wo.comments}</p>
          </div>
        )}
      </div>

      {/* Inspections — aerial and DOT records attached to this work order */}
      <div className="rounded-xl overflow-hidden mb-6" style={{ border: '1px solid #1e3040' }}>
        <div className="px-5 py-3 flex items-center justify-between" style={{ background: '#0d1820', borderBottom: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-sm tracking-widest">INSPECTIONS</p>
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {inspections.length} record{inspections.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Start an inspection against this job.
            unit and work_order are carried in the URL so the form pre-fills and
            the finished record links back here — the work_order_id columns on
            both inspection tables had no writer before this. The DOT form also
            takes the free-text unit fields, since it can run against a machine
            that is not a registered unit and would otherwise lose that context. */}
        <div className="px-5 py-3 flex flex-wrap gap-2" style={{ background: '#0f1820', borderBottom: '1px solid #1e3040' }}>
          <Link
            href={`/hd/aerial-inspections/new?work_order=${workOrderId}${wo.unit ? `&unit=${wo.unit.id}` : ''}`}
            className="px-4 py-2 rounded-lg text-xs font-condensed font-bold tracking-wide transition-colors"
            style={{ background: `${HD_ORANGE}18`, color: HD_ORANGE, border: `1px solid ${HD_ORANGE}55` }}
          >
            + Start Aerial Inspection
          </Link>
          <Link
            href={
              `/hd/dot-inspections/new?work_order=${workOrderId}` +
              (wo.unit
                ? `&unit=${wo.unit.id}` +
                  `&unit_manufacturer=${encodeURIComponent(wo.unit.manufacturer ?? '')}` +
                  `&unit_model=${encodeURIComponent(wo.unit.model ?? '')}` +
                  `&unit_serial=${encodeURIComponent(wo.unit.serial_number ?? '')}`
                : '')
            }
            className="px-4 py-2 rounded-lg text-xs font-condensed font-bold tracking-wide transition-colors"
            style={{ background: '#162030', color: 'rgba(255,255,255,0.7)', border: '1px solid #1e3040' }}
          >
            + Start DOT Inspection
          </Link>
          <Link
            href={`/hd/equipment-inspections/new?work_order=${workOrderId}${wo.unit ? `&unit=${wo.unit.id}` : ''}`}
            className="px-4 py-2 rounded-lg text-xs font-condensed font-bold tracking-wide transition-colors"
            style={{ background: '#162030', color: 'rgba(255,255,255,0.7)', border: '1px solid #1e3040' }}
          >
            + Start Equipment Inspection
          </Link>
          {!wo.unit && (
            <p className="text-xs self-center" style={{ color: 'rgba(255,255,255,0.3)' }}>
              No unit on this work order — you will select one on the form.
            </p>
          )}
        </div>

        <div style={{ background: '#111920' }}>
          {inspections.length === 0 ? (
            <div className="p-5">
              <p className="text-xs py-4 text-center" style={{ color: 'rgba(255,255,255,0.25)', border: '1px dashed #1e3040', borderRadius: 8 }}>
                No inspections attached to this work order
              </p>
            </div>
          ) : (
            inspections.map((ins, i) => {
              const isPassed = ins.result === 'pass'
              return (
                <div
                  key={`${ins.family}-${ins.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-4"
                  style={{ borderTop: i > 0 ? '1px solid #1e3040' : undefined }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{ins.typeLabel}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      {inspectionDateLabel(ins.date)} · {ins.inspectorName ?? 'Unsigned'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className="text-xs font-bold px-2.5 py-1 rounded-full"
                      style={{
                        background: isPassed ? '#22C55E20' : '#EF444420',
                        color:      isPassed ? '#22C55E'   : '#EF4444',
                        border:     `1px solid ${isPassed ? '#22C55E50' : '#EF444450'}`,
                      }}
                    >
                      {isPassed ? 'PASS' : 'FAIL'}
                    </span>
                    <Link
                      href={ins.href}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                      style={{ background: `${HD_ORANGE}20`, color: HD_ORANGE, border: `1px solid ${HD_ORANGE}40` }}
                    >
                      View
                    </Link>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Photo Documentation */}
      <div className="rounded-xl overflow-hidden mb-6" style={{ border: '1px solid #1e3040' }}>
        <div className="px-5 py-3 flex items-center justify-between" style={{ background: '#0d1820', borderBottom: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-sm tracking-widest">PHOTO DOCUMENTATION</p>
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{photos.length} photo{photos.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="divide-y" style={{ background: '#111920', '--tw-divide-opacity': 1, borderColor: '#1e3040' } as React.CSSProperties}>
          {CATEGORIES.map(cat => {
            const catPhotos = photos.filter(p => p.category === cat.id)
            const isUploading = uploading[cat.id]
            return (
              <div key={cat.id} className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-white">{cat.label}</p>
                  <div>
                    <input
                      ref={el => { fileRefs.current[cat.id] = el }}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={e => handleFileChange(e, cat.id)}
                    />
                    <button
                      onClick={() => fileRefs.current[cat.id]?.click()}
                      disabled={isUploading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                      style={{ background: isUploading ? '#1e3040' : `${HD_ORANGE}20`, color: isUploading ? 'rgba(255,255,255,0.4)' : HD_ORANGE, border: `1px solid ${HD_ORANGE}40` }}
                    >
                      {isUploading ? (
                        <>
                          <span className="inline-block w-3 h-3 border-2 rounded-full animate-spin" style={{ borderColor: `${HD_ORANGE}40`, borderTopColor: HD_ORANGE }} />
                          Uploading…
                        </>
                      ) : (
                        <>+ Add Photo</>
                      )}
                    </button>
                  </div>
                </div>

                {catPhotos.length === 0 ? (
                  <p className="text-xs py-4 text-center" style={{ color: 'rgba(255,255,255,0.25)', border: '1px dashed #1e3040', borderRadius: 8 }}>
                    No photos yet — tap Add Photo to capture
                  </p>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {catPhotos.map(photo => (
                      <div key={photo.id} className="relative group rounded-lg overflow-hidden aspect-square" style={{ background: '#162030' }}>
                        {photo.signedUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={photo.signedUrl}
                            alt={photo.caption ?? photo.file_name ?? cat.label}
                            className="w-full h-full object-cover cursor-pointer"
                            onClick={() => setLightbox(photo.signedUrl)}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>No preview</span>
                          </div>
                        )}
                        <button
                          onClick={() => handleDelete(photo.id, photo.file_url)}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ background: 'rgba(0,0,0,0.7)', color: '#EF4444' }}
                          title="Delete photo"
                        >
                          ×
                        </button>
                        {photo.caption && (
                          <div className="absolute bottom-0 inset-x-0 px-1.5 py-1 text-xs truncate" style={{ background: 'rgba(0,0,0,0.7)', color: 'rgba(255,255,255,0.8)', fontSize: 10 }}>
                            {photo.caption}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.92)' }}
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Photo full view"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={e => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-white font-bold"
            style={{ background: 'rgba(255,255,255,0.15)' }}
            onClick={() => setLightbox(null)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
