'use client'

// ─── Customer approval, one segment at a time. Shared by LD and HD ────────────
// The whole point of segments: the PCM gets a yes, the clutch gets a no, and neither
// answer touches the other.
//
// Written for someone standing next to their truck on a phone. Each item is answered
// on its own, the running total only ever counts what they have actually approved, and
// nothing is a single all-or-nothing button — a customer who cannot decline one line
// without declining the job will decline the job.
//
// The server returns the full segment set after every response and this replaces its
// state from that, rather than patching its own copy. One source of truth for the
// number the customer is agreeing to.

import { useState } from 'react'
import { money } from '@/lib/format'
import { rollupSegments } from './segments'
import { surfaceFor, type ProductVariant } from './segment-theme'
import {
  SEGMENT_STATUS_META,
  type SegmentLine, type WorkOrderSegment,
} from '@/types/segments'

interface Business { name: string | null; phone: string | null; logoUrl?: string | null }
interface WorkOrderHead {
  work_order_number: string
  po_number:         string | null
  job_description:   string | null
  customer_name:     string | null
  vehicle_label:     string | null
}

/** Parts and labour, described without exposing what the shop paid. `unit_cost` and
 *  `markup_percent` are deliberately never rendered here. */
function LineSummary({ lines, variant }: { lines: SegmentLine[]; variant: ProductVariant }) {
  const s = surfaceFor(variant)
  if (!lines.length) return null
  return (
    <ul className="space-y-1">
      {lines.map((l, i) => (
        <li key={i} className="flex items-start justify-between gap-3 text-sm">
          <span style={s.muted}>
            {l.description || (l.type === 'labor' ? 'Labor' : 'Part')}
            {l.type === 'labor' && l.quantity ? ` · ${l.quantity} hr` : ''}
            {l.type === 'part'  && l.quantity > 1 ? ` · ×${l.quantity}` : ''}
          </span>
          <span style={s.text}>{money(l.total)}</span>
        </li>
      ))}
    </ul>
  )
}

export default function SegmentApprovalClient({
  token,
  apiBase,
  variant,
  workOrder,
  business,
  initialSegments,
}: {
  token:           string
  /** e.g. `/api/work-orders/public` */
  apiBase:         string
  variant:         ProductVariant
  workOrder:       WorkOrderHead
  business:        Business
  initialSegments: WorkOrderSegment[]
}) {
  const s = surfaceFor(variant)
  const [segments, setSegments] = useState(initialSegments)
  const [busy, setBusy] = useState<string | null>(null)
  const [err,  setErr]  = useState<string | null>(null)
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const rollup  = rollupSegments(segments)
  const pending = segments.filter(x => x.status === 'pending')
  const done    = pending.length === 0

  async function respond(segmentId: string, action: 'approve' | 'decline', withNote?: string) {
    setBusy(segmentId); setErr(null)
    try {
      const res = await fetch(`${apiBase}/${token}/respond`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ segment_id: segmentId, action, note: withNote }),
      })
      const d = await res.json()
      if (!res.ok) {
        // 409 means it was already answered — refresh rather than argue with the
        // customer about a double tap.
        if (d.segments) setSegments(d.segments)
        throw new Error(d.error ?? 'Could not record your response.')
      }
      setSegments(d.segments ?? [])
      setNoteFor(null); setNote('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not record your response.')
    }
    setBusy(null)
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-8 space-y-6">

      {/* Header. The subscriber's logo when they have uploaded one, their name in
          text when they have not -- the fallback is the point, since most never
          upload anything. */}
      <div className="space-y-1">
        {business.logoUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- subscriber logos are
             arbitrary external URLs in a public bucket; next/image would need every
             host allow-listed. Same reasoning as BrandHeader. */
          <img
            src={business.logoUrl}
            alt={business.name ?? 'Shop logo'}
            className="h-10 w-auto object-contain mb-2"
            style={{ maxWidth: 200 }}
          />
        ) : null}
        <p className="text-xs uppercase tracking-widest" style={s.faint}>
          {business.name ?? 'Your shop'}
        </p>
        <h1 className="font-condensed font-bold text-2xl tracking-wide" style={s.text}>
          {workOrder.customer_name ? `Hello, ${workOrder.customer_name.split(' ')[0]}` : 'Approval needed'}
        </h1>
        <p className="text-sm" style={s.muted}>
          {business.name ?? 'The shop'} needs your OK before doing the work below
          {workOrder.vehicle_label ? ` on your ${workOrder.vehicle_label}` : ''}.
        </p>
        <p className="text-xs font-mono pt-1" style={s.faint}>
          {workOrder.work_order_number}
          {workOrder.po_number ? ` · PO # ${workOrder.po_number}` : ''}
        </p>
      </div>

      {err && <div className="alert-error">{err}</div>}

      {/* The instruction that makes this different from a single accept button. */}
      {!done && (
        <div className="rounded-xl p-4" style={s.inner}>
          <p className="text-sm" style={s.text}>
            You can approve or decline each item separately.
          </p>
          <p className="text-xs mt-1" style={s.muted}>
            Declining one does not cancel the others, and nothing you decline will be billed.
          </p>
        </div>
      )}

      {/* Segments */}
      {segments.map(seg => {
        const meta      = SEGMENT_STATUS_META[seg.status]
        const answered  = seg.status !== 'pending'
        const thisBusy  = busy === seg.id
        const lines     = seg.line_items ?? []

        return (
          <div key={seg.id} className="rounded-xl p-5 space-y-3" style={s.card}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-widest" style={s.faint}>
                  Item {seg.sequence}
                </p>
                <p className="font-semibold text-base" style={s.text}>
                  {seg.complaint || seg.correction || 'Additional work'}
                </p>
              </div>
              {answered
                ? <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide flex-shrink-0"
                    style={{ backgroundColor: meta.bg, color: meta.text }}
                  >{meta.label}</span>
                : <span className="font-condensed font-bold text-xl flex-shrink-0" style={s.text}>
                    {money(seg.grand_total)}
                  </span>}
            </div>

            {/* What the tech found, in their words. This is what justifies the price. */}
            {seg.cause && (
              <p className="text-sm" style={s.muted}>
                <span style={s.faint}>What we found: </span>{seg.cause}
              </p>
            )}
            {seg.correction && (
              <p className="text-sm" style={s.muted}>
                <span style={s.faint}>What we would do: </span>{seg.correction}
              </p>
            )}

            <div className="pt-1 space-y-2" style={{ borderTop: `1px solid ${s.border}` }}>
              <div className="pt-2"><LineSummary lines={lines} variant={variant} /></div>
              {Number(seg.tax_amount ?? 0) > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span style={s.faint}>Tax</span>
                  <span style={s.muted}>{money(seg.tax_amount)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm" style={s.muted}>Item total</span>
                <span className="font-condensed font-bold text-lg" style={s.text}>
                  {money(seg.grand_total)}
                </span>
              </div>
            </div>

            {answered ? (
              <p className="text-xs" style={s.faint}>
                {seg.status === 'authorized' || seg.status === 'complete'
                  ? 'You approved this.'
                  : 'You declined this — it will not be billed.'}
                {seg.customer_note ? ` "${seg.customer_note}"` : ''}
              </p>
            ) : noteFor === seg.id ? (
              <div className="space-y-2">
                <textarea
                  className="nwi-input text-sm w-full min-h-[70px]"
                  placeholder="Anything you want the shop to know (optional)"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => respond(seg.id, 'decline', note)}
                    disabled={thisBusy}
                    className="flex-1 py-3 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                    style={{ background: '#ef4444' }}
                  >
                    {thisBusy ? 'Sending…' : 'Confirm decline'}
                  </button>
                  <button
                    onClick={() => { setNoteFor(null); setNote('') }}
                    className="px-4 py-3 rounded-lg text-sm border"
                    style={{ borderColor: s.border, ...s.muted }}
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => respond(seg.id, 'approve')}
                  disabled={thisBusy}
                  className="flex-1 py-3 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: '#10b981' }}
                >
                  {thisBusy ? 'Sending…' : `Approve ${money(seg.grand_total)}`}
                </button>
                <button
                  onClick={() => { setNoteFor(seg.id); setNote('') }}
                  disabled={thisBusy}
                  className="px-4 py-3 rounded-lg text-sm border disabled:opacity-50"
                  style={{ borderColor: s.border, ...s.muted }}
                >
                  Decline
                </button>
              </div>
            )}
          </div>
        )
      })}

      {/* Running total — approved only. Never shows a number the customer has not
          agreed to, which is why pending is reported as a count and not a sum here. */}
      <div className="rounded-xl p-5" style={s.card}>
        <div className="flex items-center justify-between">
          <span className="text-sm" style={s.muted}>Approved so far</span>
          <span className="font-condensed font-bold text-2xl" style={{ color: '#10b981' }}>
            {money(rollup.authorizedTotal)}
          </span>
        </div>
        {pending.length > 0 && (
          <p className="text-xs mt-1" style={s.faint}>
            {pending.length} item{pending.length !== 1 ? 's' : ''} still waiting on you.
          </p>
        )}
        {done && (
          <p className="text-xs mt-1" style={s.faint}>
            All done — thanks. {business.name ?? 'The shop'} has been notified.
          </p>
        )}
      </div>

      {business.phone && (
        <p className="text-center text-xs" style={s.faint}>
          Questions? Call {business.name ?? 'the shop'} on{' '}
          <a href={`tel:${business.phone}`} style={{ color: s.accent }}>{business.phone}</a>.
        </p>
      )}
    </div>
  )
}
