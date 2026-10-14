'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { compressImage } from '@/lib/image'
// Safe from a client component: the module's only server dependency is a type-only
// import of the Supabase server client, which is erased at build time.
import { inspectionDateLabel, type InspectionSummary } from '@/lib/hd/inspections'
// BrandHeader has no hooks and no server-only imports, so it renders fine inside
// this client component.
import { BrandHeader } from '@/components/BrandHeader'
import WorkOrderLineItems from '@/components/hd/WorkOrderLineItems'
import type { Branding } from '@/lib/branding'
import { money } from '@/lib/format'

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
  unit_number: string | null
  // Loose JSONB shared with the PM checklists, so it is typed as unknown and read
  // defensively. The converter writes { unit_not_identified: true } into it when an
  // approved quote carried no serial and no VIN.
  flagged_items: unknown
  unit: { id: string; unit_number: string; manufacturer: string; model: string; year: number | null; serial_number: string | null } | null
  // hd_work_orders has no customer_email column, so the billing email can only come
  // from the linked fleet account. Same for the address — hd_fleet_accounts stores it
  // as one free-text line, not the line1/city/state/zip the invoice form uses.
  fleet: {
    id: string
    fleet_name: string
    contact_email: string | null
    contact_phone: string | null
    address: string | null
  } | null
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
  return s === 'in_progress' ? HD_ORANGE : s === 'completed' ? '#22C55E' : s === 'invoiced' ? '#3B82F6' : 'rgba(var(--hd-ink-rgb), 0.4)'
}
function statusLabel(s: string) {
  return s === 'in_progress' ? 'In Progress' : s === 'completed' ? 'Completed' : s === 'invoiced' ? 'Invoiced' : 'Open'
}


export default function WorkOrderDetail({ workOrder: wo, photos: initialPhotos, inspections, workOrderId, branding }: Props) {
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos)
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [status, setStatus] = useState(wo.status)

  // Location is the one detail this screen can change. Held locally so a save shows
  // immediately without a round trip through the server component.
  const [location, setLocation]               = useState(wo.location ?? '')
  const [locationDraft, setLocationDraft]     = useState(wo.location ?? '')
  const [editingLocation, setEditingLocation] = useState(false)
  const [savingLocation, setSavingLocation]   = useState(false)
  const [locationError, setLocationError]     = useState<string | null>(null)

  async function saveLocation() {
    setSavingLocation(true)
    setLocationError(null)
    try {
      const res = await fetch(`/api/hd/work-orders/${wo.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ location: locationDraft }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not save the location.')
      // The server's own answer, trimmed-to-null and capped the way it stores it, so
      // the screen shows what is in the row rather than what was typed.
      setLocation((json.work_order?.location as string | null) ?? '')
      setEditingLocation(false)
    } catch (err) {
      setLocationError(err instanceof Error ? err.message : 'Could not save the location.')
    } finally {
      setSavingLocation(false)
    }
  }
  const [reopening, setReopening] = useState(false)
  const [invoicing, setInvoicing] = useState(false)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)
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
      // 1400px / 0.82 are this screen's own values, passed explicitly so sharing the
      // helper does not quietly change the size or quality of HD job photos.
      const blob = await compressImage(file, 1400, 0.82)
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

  // CREATE INVOICE, assembled on the server.
  //
  // This used to be a Link to /hd/invoices/new carrying the work order in a query
  // string, from which the form synthesized ONE labor line out of labor_hours x
  // labor_rate. Every PART line a technician had entered into
  // hd_work_order_line_items was dropped - visible on the work order, absent from the
  // bill. The comment that justified it ("Work orders carry no line items of their
  // own") had been true before migration 120 created that table.
  //
  // Now the server reads the real line rows and the work order's RECORDED terms, and
  // the existing /api/hd/invoices route performs the insert. That is deliberately the
  // only insert path: it already carries the column-tolerance retries, already deducts
  // stock through the shared ledger, and already flips this work order to 'invoiced'.
  async function createInvoice() {
    setInvoicing(true)
    setInvoiceError(null)
    try {
      const built = await fetch(`/api/hd/work-orders/${workOrderId}/convert`, { cache: 'no-store' })
      const builtJson = await built.json().catch(() => ({}))

      // Already billed. Send the tech to the invoice that exists rather than letting
      // them create a second one - WO-2026-1538 was billed twice before this existed.
      if (built.status === 409 && builtJson.invoice?.id) {
        window.location.href = `/hd/invoices/${builtJson.invoice.id}`
        return
      }
      if (!built.ok) throw new Error(builtJson.error ?? 'Could not read this work order.')

      const source = (builtJson.source ?? {}) as Record<string, unknown>

      // The server now REFUSES an empty work order with 422 rather than returning a
      // zero payload, so this branch is the belt to that braces. Kept because the
      // message here is the one the tech reads.
      if (built.status === 422 || !source.has_lines) {
        setInvoiceError(String(builtJson.error ?? 'This work order has no line items yet. Add the labor and parts on it first, then create the invoice.'))
        return
      }

      // If any term came from Settings rather than from the job, say so BEFORE the
      // invoice is created. All 1,562 existing work orders have no recorded rate or
      // tax, so for anything not born from an approved quote this is the normal case -
      // and a tech should know the tax on the bill came from their settings today, not
      // from something the customer agreed to.
      const usedSettings = (source.used_settings_for ?? []) as string[]
      if (Array.isArray(usedSettings) && usedSettings.length > 0) {
        const ok = window.confirm(
          `This work order has no ${usedSettings.join(' or ')} recorded.\n\n` +
          `Your current shop settings will be used instead, and the invoice will note that.\n\n` +
          `Create the invoice?`,
        )
        if (!ok) return
      }

      const made = await fetch('/api/hd/invoices', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(builtJson.invoice_payload),
      })
      const madeJson = await made.json().catch(() => ({}))

      // The migration-154 unique index refusing a second invoice.
      if (made.status === 409 && madeJson.invoice?.id) {
        window.location.href = `/hd/invoices/${madeJson.invoice.id}`
        return
      }
      if (!made.ok) throw new Error(madeJson.error ?? 'Could not create the invoice.')

      const id = (madeJson.invoice as Record<string, unknown> | undefined)?.id
      window.location.href = id ? `/hd/invoices/${String(id)}` : '/hd/invoices'
    } catch (err) {
      setInvoiceError(err instanceof Error ? err.message : 'Could not create the invoice.')
    } finally {
      setInvoicing(false)
    }
  }

  // The old query-string handoff to /hd/invoices/new has been REMOVED, not kept as a
  // fallback. It was the bug: it carried labor_hours and labor_rate and nothing else,
  // so the invoice form rebuilt one labor line and every part was lost. Leaving it in
  // reach would be leaving the broken path one click away.

  // ── The details block's three awkward labels ──────────────────────────────
  //
  // Each one printed "—" or something misleading for a work order that came from an
  // approved quote, which is now a normal way for one to exist.

  // The linked hd_unit when there is one, the quote's free text when there is not.
  // A quote records the machine as text, so a quote-sourced job has no join to read.
  const unitLabel = wo.unit
    ? `${wo.unit.unit_number} — ${wo.unit.manufacturer} ${wo.unit.model}${wo.unit.year ? ` (${wo.unit.year})` : ''}`
    : [
        wo.unit_number,
        [wo.unit_manufacturer, wo.unit_model].filter(Boolean).join(' ') || null,
      ].filter(Boolean).join(' — ') || '—'

  // Hours and rate are two facts, and the row used to print "—" unless BOTH were
  // there. A job billing $135/hr with the hours still on the lines should say so.
  const laborLabel = wo.labor_hours
    ? `${wo.labor_hours}h @ ${wo.labor_rate != null ? money(Number(wo.labor_rate)) : '—'}/hr`
    : wo.labor_rate != null
      ? `${money(Number(wo.labor_rate))}/hr`
      : '—'

  // Labelled for what it is. This comes off the quote and includes tax, travel,
  // mileage and fees; the LINE TOTAL in the parts and labor card is parts and labor
  // only. Calling both of them "Total" made a correct pair of numbers look wrong.
  const quotedTotalLabel = wo.total_amount != null
    ? money(Number(wo.total_amount))
    : '—'

  // Set by the converter when the approved quote had no serial and no VIN. Read
  // defensively: flagged_items is loose JSONB shared with the PM checklists, so it
  // can hold shapes this screen knows nothing about.
  const unitNotIdentified = (() => {
    const f = wo.flagged_items
    return !!f && typeof f === 'object' && !Array.isArray(f) &&
      (f as Record<string, unknown>).unit_not_identified === true
  })()

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Subscriber branding — logo when one is uploaded, business name in text
          when not. This is the subscriber's document, so their mark leads it. */}
      <div
        className="rounded-xl px-5 py-4 mb-5 text-white"
        style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }}
      >
        <BrandHeader branding={branding} subtitle={`Work Order ${woLabel}`} />
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <Link href="/hd/work-orders" className="text-xs mb-2 inline-block" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>
            ← Work Orders
          </Link>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">{woLabel}</h1>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: `${statusColor(status)}20`, color: statusColor(status) }}>
              {statusLabel(status)}
            </span>
            {wo.service_type && <span className="text-sm" style={{ color: 'rgba(var(--hd-ink-rgb), 0.5)' }}>{wo.service_type}</span>}
            {/* An invoiced job is already billed, so offer the way back out instead of
                a second Create Invoice that would quietly double-bill it. */}
            {status === 'invoiced' ? (
              <button
                onClick={handleReopen}
                disabled={reopening}
                className="px-3 py-1.5 rounded-lg text-xs font-condensed font-bold tracking-wide disabled:opacity-50"
                style={{ background: 'var(--hd-inner)', color: 'rgba(var(--hd-ink-rgb), 0.7)', border: '1px solid var(--hd-border)' }}
              >
                {reopening ? 'Reopening…' : '↩ Reopen Work Order'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void createInvoice()}
                disabled={invoicing}
                className="px-3 py-1.5 rounded-lg text-xs font-condensed font-bold tracking-wide disabled:opacity-50"
                style={{ background: `${HD_ORANGE}18`, color: HD_ORANGE, border: `1px solid ${HD_ORANGE}55` }}
              >
                {invoicing ? 'Building invoice...' : '+ Create Invoice'}
              </button>
            )}
          </div>
        </div>

        {/* The failure has to be VISIBLE. setInvoiceError was being set and never
            rendered, which meant "this work order has no line items yet" - the one
            message that stops a blank invoice going out - showed the tech nothing at
            all and the button just stopped looking busy. */}
        {invoiceError && (
          <p className="mt-3 text-sm rounded-lg px-3 py-2"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444' }}>
            {invoiceError}
          </p>
        )}
        <p className="text-xs mt-1 flex-shrink-0" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>
          {new Date(wo.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      {/* ===========================================================================
          THE DETAILS BLOCK'S LABELS, built where they can be read.
          =========================================================================== */}

      {/* Work Order Info */}
      <div className="rounded-xl p-5 mb-6" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }}>
        <p className="font-condensed font-bold text-white text-sm tracking-widest mb-3">WORK ORDER DETAILS</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {[
            // THE FLAT COLUMNS ARE A FALLBACK, NOT A DUPLICATE.
            //
            // This read only wo.unit, the joined hd_unit row. A work order created
            // from an approved quote has no linked unit - the quote records the
            // machine as free text - so Unit and Serial / VIN printed "—" even when
            // the quote carried a manufacturer, model and serial, and the data was
            // sitting in unit_manufacturer / unit_model / unit_serial on the row
            // being rendered. Same for an ad-hoc scheduler booking.
            { label: 'Unit', value: unitLabel },
            // Carried from the quote since migration 158, when the tech picked a fleet
            // account. A customers-table pick or a typed name has no fleet, so "—".
            { label: 'Fleet', value: wo.fleet?.fleet_name ?? '—' },
            { label: 'Tech', value: wo.tech_name ?? '—' },
            { label: 'Setpoint', value: wo.current_setpoint ?? '—' },
            // Hours and rate are separate facts. Printing "—" for the whole row when
            // only the hours were missing hid a rate the job really does bill at.
            { label: 'Labor', value: laborLabel },
            // "Total" invited a comparison with the LINE TOTAL below, which counts a
            // different thing: this figure comes off the quote and includes tax,
            // travel, mileage and fees, while LINE TOTAL is parts and labor only.
            // They are not meant to match, and labelling both "Total" made a correct
            // pair of numbers look like a bug.
            { label: 'Quoted Total', value: quotedTotalLabel },
            { label: 'Serial / VIN', value: wo.unit?.serial_number ?? wo.unit_serial ?? '—' },
          ].map(({ label, value }) => (
            <div key={label}>
              <span className="text-xs uppercase tracking-wider block mb-0.5" style={{ color: 'rgba(var(--hd-ink-rgb), 0.35)', fontSize: 10 }}>{label}</span>
              <span style={{ color: 'rgba(var(--hd-ink-rgb), 0.85)' }}>{value}</span>
            </div>
          ))}

          {/* ===================================================================
              LOCATION, EDITABLE.
              ===================================================================
              It defaults from the approved quote's address now (the service address
              where the quote has one), which is what makes editing necessary rather
              than optional: the unit is often at neither address on file. There was
              no write path for an HD work order at all before this - only /status
              and /line-items - so this field was read-only text. */}
          <div className="col-span-2">
            <span className="text-xs uppercase tracking-wider block mb-0.5" style={{ color: 'rgba(var(--hd-ink-rgb), 0.35)', fontSize: 10 }}>
              Location
            </span>
            {editingLocation ? (
              <div className="flex items-center gap-2">
                <input
                  value={locationDraft}
                  onChange={e => setLocationDraft(e.target.value)}
                  placeholder="Where the unit is"
                  autoFocus
                  className="flex-1 px-2 py-1.5 rounded text-sm"
                  style={{ background: 'var(--hd-inner)', border: '1px solid var(--hd-border)', color: 'rgba(var(--hd-ink-rgb), 0.9)' }}
                />
                <button
                  type="button"
                  onClick={saveLocation}
                  disabled={savingLocation}
                  className="px-2.5 py-1.5 rounded text-xs font-bold disabled:opacity-40"
                  style={{ background: HD_ORANGE, color: '#FFFFFF' }}
                >
                  {savingLocation ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingLocation(false); setLocationDraft(location ?? '') }}
                  className="px-2 py-1.5 rounded text-xs"
                  style={{ color: 'rgba(var(--hd-ink-rgb), 0.5)', border: '1px solid var(--hd-border)' }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span style={{ color: 'rgba(var(--hd-ink-rgb), 0.85)' }}>{location || '—'}</span>
                {status !== 'invoiced' && (
                  <button
                    type="button"
                    onClick={() => { setLocationDraft(location ?? ''); setEditingLocation(true) }}
                    className="text-xs font-semibold"
                    style={{ color: HD_ORANGE, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                  >
                    {location ? 'edit' : 'add'}
                  </button>
                )}
              </div>
            )}
            {locationError && (
              <p className="text-xs mt-1" style={{ color: '#EF4444' }}>{locationError}</p>
            )}
          </div>
        </div>

        {/* THE UNIT WAS NEVER PINNED DOWN. Written by the converter when the approved
            quote carried no serial and no VIN, so the gap travels with the job
            instead of being noticed when somebody opens the invoice. */}
        {unitNotIdentified && (
          <p className="mt-3 text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(245,158,11,0.12)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.3)' }}>
            Unit not identified - no serial number or VIN was recorded on the quote.
            Add it to the unit fields when you are on site.
          </p>
        )}
        {wo.service_requests && (
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--hd-border)' }}>
            <span className="text-xs uppercase tracking-wider block mb-1" style={{ color: 'rgba(var(--hd-ink-rgb), 0.35)', fontSize: 10 }}>Service Requests</span>
            <p className="text-sm whitespace-pre-wrap" style={{ color: 'rgba(var(--hd-ink-rgb), 0.75)' }}>{wo.service_requests}</p>
          </div>
        )}
        {wo.comments && (
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--hd-border)' }}>
            <span className="text-xs uppercase tracking-wider block mb-1" style={{ color: 'rgba(var(--hd-ink-rgb), 0.35)', fontSize: 10 }}>Comments</span>
            <p className="text-sm whitespace-pre-wrap" style={{ color: 'rgba(var(--hd-ink-rgb), 0.75)' }}>{wo.comments}</p>
          </div>
        )}
      </div>

      {/* Parts & labor priced on the job. Locked once the job is invoiced: the
          invoice is the billed document from that point, so editing the source lines
          would put the two out of step with nothing to reconcile them. Reopening the
          work order unlocks them again. */}
      {/* The unit is passed down so the parts picker opens filtered to it. Same
          resolution the invoice handoff uses above: the linked unit record first,
          falling back to the free-typed fields. */}
      <WorkOrderLineItems
        workOrderId={workOrderId}
        canEdit={status !== 'invoiced'}
        unit={{
          manufacturer: wo.unit?.manufacturer  ?? wo.unit_manufacturer ?? null,
          model:        wo.unit?.model         ?? wo.unit_model        ?? null,
          serial:       wo.unit?.serial_number ?? wo.unit_serial       ?? null,
        }}
      />

      {/* Inspections — aerial and DOT records attached to this work order */}
      <div className="rounded-xl overflow-hidden mb-6" style={{ border: '1px solid var(--hd-border)' }}>
        <div className="px-5 py-3 flex items-center justify-between" style={{ background: 'var(--hd-sunken)', borderBottom: '1px solid var(--hd-border)' }}>
          <p className="font-condensed font-bold text-white text-sm tracking-widest">INSPECTIONS</p>
          <span className="text-xs" style={{ color: 'rgba(var(--hd-ink-rgb), 0.35)' }}>
            {inspections.length} record{inspections.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Start an inspection against this job.
            unit and work_order are carried in the URL so the form pre-fills and
            the finished record links back here — the work_order_id columns on
            both inspection tables had no writer before this. The DOT form also
            takes the free-text unit fields, since it can run against a machine
            that is not a registered unit and would otherwise lose that context. */}
        <div className="px-5 py-3 flex flex-wrap gap-2" style={{ background: '#0f1820', borderBottom: '1px solid var(--hd-border)' }}>
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
                // No linked unit, but the quote named the machine: hand that over too,
                // so the form does not open blank on a job that knows its unit.
                : (wo.unit_manufacturer || wo.unit_model || wo.unit_serial)
                  ? `&unit_manufacturer=${encodeURIComponent(wo.unit_manufacturer ?? '')}` +
                    `&unit_model=${encodeURIComponent(wo.unit_model ?? '')}` +
                    `&unit_serial=${encodeURIComponent(wo.unit_serial ?? '')}`
                  : '')
            }
            className="px-4 py-2 rounded-lg text-xs font-condensed font-bold tracking-wide transition-colors"
            style={{ background: 'var(--hd-inner)', color: 'rgba(var(--hd-ink-rgb), 0.7)', border: '1px solid var(--hd-border)' }}
          >
            + Start DOT Inspection
          </Link>
          <Link
            href={`/hd/equipment-inspections/new?work_order=${workOrderId}${wo.unit ? `&unit=${wo.unit.id}` : ''}`}
            className="px-4 py-2 rounded-lg text-xs font-condensed font-bold tracking-wide transition-colors"
            style={{ background: 'var(--hd-inner)', color: 'rgba(var(--hd-ink-rgb), 0.7)', border: '1px solid var(--hd-border)' }}
          >
            + Start Equipment Inspection
          </Link>
          {/* Reefer PM. The transport-refrigeration inspection is the PM checklist —
              same signed record, same unit link — so this starts that form rather than
              introducing a second reefer inspection type alongside it. */}
          <Link
            href={`/hd/pm-checklist?work_order=${workOrderId}${wo.unit ? `&unit=${wo.unit.id}` : ''}`}
            className="px-4 py-2 rounded-lg text-xs font-condensed font-bold tracking-wide transition-colors"
            style={{ background: 'var(--hd-inner)', color: 'rgba(var(--hd-ink-rgb), 0.7)', border: '1px solid var(--hd-border)' }}
          >
            + Start Reefer PM Inspection
          </Link>
          {/* Same two sources the Unit row in the details block reads. Checking only the
              joined hd_units row printed "No unit" directly under a Unit that named one. */}
          {!wo.unit && (
            <p className="text-xs self-center" style={{ color: 'rgba(var(--hd-ink-rgb), 0.3)' }}>
              {unitLabel !== '—'
                ? `Unit ${unitLabel} is not linked to a fleet unit record — confirm it on the form.`
                : 'No unit on this work order — you will select one on the form.'}
            </p>
          )}
        </div>

        <div style={{ background: 'var(--hd-card)' }}>
          {inspections.length === 0 ? (
            <div className="p-5">
              <p className="text-xs py-4 text-center" style={{ color: 'rgba(var(--hd-ink-rgb), 0.25)', border: '1px dashed var(--hd-border)', borderRadius: 8 }}>
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
                  style={{ borderTop: i > 0 ? '1px solid var(--hd-border)' : undefined }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{ins.typeLabel}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>
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
      <div className="rounded-xl overflow-hidden mb-6" style={{ border: '1px solid var(--hd-border)' }}>
        <div className="px-5 py-3 flex items-center justify-between" style={{ background: 'var(--hd-sunken)', borderBottom: '1px solid var(--hd-border)' }}>
          <p className="font-condensed font-bold text-white text-sm tracking-widest">PHOTO DOCUMENTATION</p>
          <span className="text-xs" style={{ color: 'rgba(var(--hd-ink-rgb), 0.35)' }}>{photos.length} photo{photos.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="divide-y" style={{ background: 'var(--hd-card)', '--tw-divide-opacity': 1, borderColor: 'var(--hd-border)' } as React.CSSProperties}>
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
                      style={{ background: isUploading ? 'var(--hd-border)' : `${HD_ORANGE}20`, color: isUploading ? 'rgba(var(--hd-ink-rgb), 0.4)' : HD_ORANGE, border: `1px solid ${HD_ORANGE}40` }}
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
                  <p className="text-xs py-4 text-center" style={{ color: 'rgba(var(--hd-ink-rgb), 0.25)', border: '1px dashed var(--hd-border)', borderRadius: 8 }}>
                    No photos yet — tap Add Photo to capture
                  </p>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {catPhotos.map(photo => (
                      <div key={photo.id} className="relative group rounded-lg overflow-hidden aspect-square" style={{ background: 'var(--hd-inner)' }}>
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
                            <span className="text-xs" style={{ color: 'rgba(var(--hd-ink-rgb), 0.3)' }}>No preview</span>
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
                          <div className="absolute bottom-0 inset-x-0 px-1.5 py-1 text-xs truncate" style={{ background: 'rgba(0,0,0,0.7)', color: 'rgba(var(--hd-ink-rgb), 0.8)', fontSize: 10 }}>
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
            style={{ background: 'rgba(var(--hd-ink-rgb), 0.15)' }}
            onClick={() => setLightbox(null)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
