'use client'

// ─── Segments on a work order, tech side. Shared by LD and HD ─────────────────
// Everything product-specific arrives as props: the API base path and the theme
// variant. Nothing in here branches on which product it is beyond colour.
//
// The rollup is never computed from this component's own arithmetic — it comes from
// components/shared/segments, the same module the API and the invoice converter use.
// A tile that did its own sum is a tile that can disagree with the bill.

import { useState } from 'react'
import { money } from '@/lib/format'
import { rollupSegments } from './segments'
import SegmentLineEditor from './SegmentLineEditor'
import { surfaceFor, type ProductVariant } from './segment-theme'
import {
  SEGMENT_STATUS_META,
  type SegmentLine, type SegmentStatus, type WorkOrderSegment,
} from '@/types/segments'

function StatusBadge({ status }: { status: SegmentStatus }) {
  const m = SEGMENT_STATUS_META[status]
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
      style={{ backgroundColor: m.bg, color: m.text }}
    >
      {m.label}
    </span>
  )
}

export default function SegmentList({
  apiBase,
  variant,
  initialSegments,
  defaultMarkup = 20,
  laborRate = 125,
  defaultTaxPercent = 8.5,
  canSend = true,
  locked = false,
}: {
  /** e.g. `/api/work-orders/abc123` — the segment routes hang off this. */
  apiBase:            string
  variant:            ProductVariant
  initialSegments:    WorkOrderSegment[]
  defaultMarkup?:     number
  laborRate?:         number
  defaultTaxPercent?: number
  canSend?:           boolean
  /** Invoiced work orders are read-only. */
  locked?:            boolean
}) {
  const s = surfaceFor(variant)
  const [segments, setSegments] = useState(initialSegments)
  const [busy,     setBusy]     = useState<string | null>(null)
  const [err,      setErr]      = useState<string | null>(null)
  const [msg,      setMsg]      = useState<string | null>(null)
  const [sendUrl,  setSendUrl]  = useState<string | null>(null)
  const [draftLines, setDraftLines] = useState<Record<string, SegmentLine[]>>({})

  const rollup = rollupSegments(segments)

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(null), 3500) }

  function linesFor(seg: WorkOrderSegment): SegmentLine[] {
    return draftLines[seg.id] ?? seg.line_items ?? []
  }

  async function addSegment() {
    setBusy('add'); setErr(null)
    try {
      const res = await fetch(`${apiBase}/segments`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tax_percent: defaultTaxPercent }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Could not add a segment')
      setSegments(prev => [...prev, d.segment])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add a segment')
    }
    setBusy(null)
  }

  async function saveSegment(seg: WorkOrderSegment, patch: Record<string, unknown>) {
    setBusy(seg.id); setErr(null)
    try {
      const res = await fetch(`${apiBase}/segments/${seg.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Could not save')
      setSegments(prev => prev.map(x => (x.id === seg.id ? d.segment : x)))
      setDraftLines(prev => { const n = { ...prev }; delete n[seg.id]; return n })
      flash(`Segment ${seg.sequence} saved.`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save')
    }
    setBusy(null)
  }

  async function setStatus(seg: WorkOrderSegment, status: SegmentStatus) {
    setBusy(seg.id); setErr(null)
    try {
      const res = await fetch(`${apiBase}/segments/${seg.id}/status`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Could not update status')
      setSegments(prev => prev.map(x => (x.id === seg.id ? d.segment : x)))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update status')
    }
    setBusy(null)
  }

  async function removeSegment(seg: WorkOrderSegment) {
    setBusy(seg.id); setErr(null)
    try {
      const res = await fetch(`${apiBase}/segments/${seg.id}`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error ?? 'Could not delete')
      setSegments(prev => prev.filter(x => x.id !== seg.id))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not delete')
    }
    setBusy(null)
  }

  async function sendForApproval() {
    setBusy('send'); setErr(null)
    try {
      const res = await fetch(`${apiBase}/segments/send`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Could not send')
      setSendUrl(d.url ?? null)
      const ch = [d.sent?.sms && 'text', d.sent?.email && 'email'].filter(Boolean).join(' and ')
      // The link is shown either way: if both channels failed the tech can still read
      // it off the screen and pass it on, rather than being stuck behind a send error.
      flash(ch ? `Sent by ${ch}.` : 'Nothing could be sent — use the link below.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send')
    }
    setBusy(null)
  }

  const pendingCount = rollup.counts.pending ?? 0

  return (
    <div className="space-y-4">
      {err && <div className="alert-error">{err}</div>}
      {msg && <div className="alert-success">{msg}</div>}

      {/* ── Rollup ──────────────────────────────────────────────────────────────
          Authorized is the only figure that becomes the bill. Pending is shown beside
          it, never inside it, so a tech can say "there is X waiting on your OK"
          without that money ever appearing in a total. */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl p-4" style={s.card}>
          <p className="text-[10px] uppercase tracking-widest mb-1" style={s.faint}>Authorized</p>
          <p className="font-condensed font-bold text-2xl" style={{ color: '#10b981' }}>
            {money(rollup.authorizedTotal)}
          </p>
          <p className="text-[11px] mt-0.5" style={s.faint}>This is what gets invoiced</p>
        </div>
        <div className="rounded-xl p-4" style={s.card}>
          <p className="text-[10px] uppercase tracking-widest mb-1" style={s.faint}>Awaiting OK</p>
          <p className="font-condensed font-bold text-2xl" style={{ color: s.accent }}>
            {money(rollup.pendingTotal)}
          </p>
          <p className="text-[11px] mt-0.5" style={s.faint}>
            {pendingCount} segment{pendingCount !== 1 ? 's' : ''} pending
          </p>
        </div>
        <div className="rounded-xl p-4" style={s.card}>
          <p className="text-[10px] uppercase tracking-widest mb-1" style={s.faint}>Declined</p>
          <p className="font-condensed font-bold text-2xl" style={s.muted}>
            {money(rollup.declinedTotal)}
          </p>
          <p className="text-[11px] mt-0.5" style={s.faint}>Kept as follow-up work</p>
        </div>
      </div>

      {/* ── Segments ── */}
      {segments.map(seg => {
        const meta      = SEGMENT_STATUS_META[seg.status]
        const isLocked  = locked || seg.status === 'authorized' || seg.status === 'complete'
        const lines     = linesFor(seg)
        const dirty     = !!draftLines[seg.id]
        const thisBusy  = busy === seg.id

        return (
          <div key={seg.id} className="rounded-xl p-5 space-y-4" style={s.card}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: meta.bg, color: meta.text }}
                >
                  {seg.sequence}
                </span>
                <span className="font-condensed font-bold text-lg tracking-wide" style={s.text}>
                  SEGMENT {seg.sequence}
                </span>
                <StatusBadge status={seg.status} />
              </div>
              <span className="font-condensed font-bold text-xl" style={s.text}>
                {money(seg.grand_total)}
              </span>
            </div>

            {/* The three C's. Free text, because a complaint is the customer's words. */}
            <div className="space-y-2">
              <div>
                <label className="nwi-label text-[10px]">Complaint — what the customer said</label>
                <input
                  className="nwi-input text-sm"
                  placeholder='e.g. "crank no start"'
                  defaultValue={seg.complaint ?? ''}
                  disabled={isLocked}
                  onBlur={e => {
                    if (e.target.value !== (seg.complaint ?? '')) saveSegment(seg, { complaint: e.target.value })
                  }}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="nwi-label text-[10px]">Cause — what you found</label>
                  <input
                    className="nwi-input text-sm"
                    placeholder="e.g. PCM failed"
                    defaultValue={seg.cause ?? ''}
                    disabled={isLocked}
                    onBlur={e => {
                      if (e.target.value !== (seg.cause ?? '')) saveSegment(seg, { cause: e.target.value })
                    }}
                  />
                </div>
                <div>
                  <label className="nwi-label text-[10px]">Correction — what you did</label>
                  <input
                    className="nwi-input text-sm"
                    placeholder="e.g. replaced and programmed PCM"
                    defaultValue={seg.correction ?? ''}
                    disabled={isLocked}
                    onBlur={e => {
                      if (e.target.value !== (seg.correction ?? '')) saveSegment(seg, { correction: e.target.value })
                    }}
                  />
                </div>
              </div>
            </div>

            <SegmentLineEditor
              lines={lines}
              onChange={next => setDraftLines(prev => ({ ...prev, [seg.id]: next }))}
              variant={variant}
              defaultMarkup={defaultMarkup}
              laborRate={laborRate}
              disabled={isLocked}
            />

            {!isLocked && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-24">
                  <label className="nwi-label text-[10px]">Tax %</label>
                  <input
                    type="number" min={0} step={0.01} className="nwi-input text-sm"
                    defaultValue={seg.tax_percent ?? defaultTaxPercent}
                    onBlur={e => saveSegment(seg, { tax_percent: Number(e.target.value) || 0, line_items: lines })}
                  />
                </div>
                <button
                  onClick={() => saveSegment(seg, { line_items: lines, tax_percent: seg.tax_percent ?? defaultTaxPercent })}
                  disabled={thisBusy}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-50"
                  style={{ background: s.accent }}
                >
                  {thisBusy ? 'Saving…' : dirty ? 'Save lines' : 'Saved'}
                </button>
                <button
                  onClick={() => setStatus(seg, 'authorized')}
                  disabled={thisBusy}
                  title="Customer OK'd this over the phone or at the counter"
                  className="px-3 py-2 rounded-lg text-xs border transition-colors disabled:opacity-50"
                  style={{ borderColor: s.border, ...s.muted }}
                >
                  Authorize
                </button>
                <button
                  onClick={() => setStatus(seg, 'declined')}
                  disabled={thisBusy}
                  className="px-3 py-2 rounded-lg text-xs border transition-colors disabled:opacity-50"
                  style={{ borderColor: s.border, ...s.muted }}
                >
                  Decline
                </button>
                <button
                  onClick={() => removeSegment(seg)}
                  disabled={thisBusy}
                  className="ml-auto text-xs hover:text-danger transition-colors disabled:opacity-50"
                  style={s.faint}
                >
                  Delete
                </button>
              </div>
            )}

            {seg.status === 'authorized' && !locked && (
              <button
                onClick={() => setStatus(seg, 'complete')}
                disabled={thisBusy}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-50"
                style={{ background: '#10b981' }}
              >
                Mark this segment complete
              </button>
            )}

            {(seg.authorized_at || seg.declined_at) && (
              <p className="text-[11px]" style={s.faint}>
                {seg.authorized_at ? 'Authorized' : 'Declined'}
                {seg.authorization_method === 'customer_link' ? ' by the customer' : ' by the shop'}
                {seg.customer_note ? ` — "${seg.customer_note}"` : ''}
              </p>
            )}
          </div>
        )
      })}

      {/* ── Actions ── */}
      {!locked && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={addSegment}
            disabled={busy === 'add'}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50"
            style={{ background: s.accent }}
          >
            {busy === 'add' ? 'Adding…' : '+ Add Segment'}
          </button>

          {canSend && pendingCount > 0 && (
            <button
              onClick={sendForApproval}
              disabled={busy === 'send'}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold border transition-colors disabled:opacity-50"
              style={{ borderColor: s.border, ...s.text }}
            >
              {busy === 'send' ? 'Sending…' : `Send ${pendingCount} for approval`}
            </button>
          )}
        </div>
      )}

      {sendUrl && (
        <div className="rounded-xl p-4" style={s.inner}>
          <p className="text-[11px] uppercase tracking-widest mb-1" style={s.faint}>Approval link</p>
          <p className="text-xs font-mono break-all" style={s.muted}>{sendUrl}</p>
          <p className="text-[11px] mt-1" style={s.faint}>
            Same link every time — safe to read out or forward.
          </p>
        </div>
      )}

      {segments.length === 0 && (
        <p className="text-sm px-1" style={s.faint}>
          No segments yet. Add one for each complaint on this job — the customer can then
          approve or decline each separately.
        </p>
      )}
    </div>
  )
}
