'use client'

// RETURN PARTS TO STOCK (Nov 15). Offered only on an invoice the customer already has
// (sent, paid, partial, void, overdue - canCustomerReturn). An unsent draft is corrected
// with Refresh instead.
//
// GROUPED BY PART, not by line: the ledger holds one figure per part per invoice, so
// each part gets one quantity, capped at what is off the shelf for it now (after every
// refresh and earlier return). The lines a part appears on are shown for context, and
// the note says which job was refused. Stock only - the bill does not change.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface PartRow {
  part_id: string
  part_number: string
  taken: number
  customer_returned: number
  returnable: number
  lines: Array<{ description: string; quantity: number; job: number | null; job_label: string | null }>
}

const TEXT = '#1A1A1A'
const MUTED = 'var(--paper-muted)'
const BORDER = '#E5E7EB'

export default function ReturnPartsPanel({ invoiceId, invoiceNumber }: { invoiceId: string; invoiceNumber: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [parts, setParts] = useState<PartRow[] | null>(null)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function load() {
    setError('')
    try {
      const res = await fetch(`/api/hd/invoices/${invoiceId}/return`, { cache: 'no-store' })
      const j = await res.json() as { parts?: PartRow[]; error?: string; refused?: string | null }
      if (!res.ok) { setError(j.error ?? 'Could not read this invoice\'s stock.'); return }
      setParts(j.parts ?? [])
    } catch { setError('Could not reach the server.') }
  }

  async function submit() {
    const returns = (parts ?? [])
      .map(p => ({ part_id: p.part_id, quantity: Number(qty[p.part_id] || 0) }))
      .filter(r => r.quantity > 0)
    if (!returns.length) { setError('Enter how many of at least one part came back.'); return }
    if (!note.trim()) { setError('Say which job was refused, dismissed or not finished.'); return }
    setBusy(true); setError(''); setDone('')
    try {
      const res = await fetch(`/api/hd/invoices/${invoiceId}/return`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returns, note: note.trim() }),
      })
      const j = await res.json() as { error?: string; parts?: PartRow[]; returned?: Array<{ part_number: string; quantity: number }> }
      if (!res.ok) { setError(j.error ?? 'Nothing was returned.'); return }
      setParts(j.parts ?? parts)
      setQty({}); setNote('')
      setDone(`Back on the shelf: ${(j.returned ?? []).map(r => `${r.quantity} x ${r.part_number}`).join(', ')}. ${invoiceNumber} is unchanged.`)
      router.refresh()
    } catch { setError('Could not reach the server. Nothing was returned.') }
    finally { setBusy(false) }
  }

  if (!open) {
    return (
      <div className="mb-4">
        <button type="button" data-return-parts="true"
          onClick={() => { setOpen(true); void load() }}
          className="px-4 py-2 rounded-lg font-semibold text-sm"
          style={{ background: '#F3F4F6', color: '#374151', border: `1px solid ${BORDER}`, minHeight: 44 }}>
          Return parts to stock
        </button>
      </div>
    )
  }

  return (
    <div data-return-panel="true" className="mb-4 rounded-lg px-4 py-4 text-sm" style={{ background: '#FFFFFF', border: `1px solid ${BORDER}`, color: TEXT }}>
      <div className="flex items-center justify-between mb-2">
        <strong>Return parts to stock</strong>
        <button type="button" onClick={() => setOpen(false)} className="text-xs underline" style={{ color: MUTED }}>Close</button>
      </div>
      <p className="text-xs mb-3" style={{ color: MUTED }}>
        For parts that physically came back - a refused repair, a dismissed job, work not finished. Only the shelf count moves:
        the total, tax, lines, number, pay link and status of {invoiceNumber} stay exactly as they are.
      </p>

      {!parts && !error && <p style={{ color: MUTED }}>Loading...</p>}
      {parts && parts.length === 0 && (
        <p style={{ color: MUTED }}>This invoice took no catalog parts off the shelf, so there is nothing to return.</p>
      )}

      {parts && parts.length > 0 && (
        <div className="flex flex-col gap-3">
          {parts.map(p => (
            <div key={p.part_id} data-return-part={p.part_number} className="rounded-lg px-3 py-2" style={{ border: `1px solid ${BORDER}` }}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <span className="font-semibold">{p.part_number}</span>
                  <span className="block text-xs" style={{ color: MUTED }}>
                    {p.taken} off the shelf for this invoice{p.customer_returned > 0 ? ` (${p.customer_returned} already returned)` : ''}
                  </span>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  Returning
                  <input type="number" min={0} max={p.returnable} step={1} inputMode="numeric"
                    value={qty[p.part_id] ?? ''} disabled={p.returnable === 0 || busy}
                    onChange={e => setQty(q => ({ ...q, [p.part_id]: e.target.value }))}
                    className="w-20 px-2 py-1 rounded border text-sm" style={{ borderColor: BORDER }} />
                  <span style={{ color: MUTED }}>of {p.returnable}</span>
                </label>
              </div>
              {p.lines.length > 0 && (
                <ul className="mt-1 text-xs list-disc pl-5" style={{ color: MUTED }}>
                  {p.lines.map((l, i) => (
                    <li key={i}>{l.job_label ? `${l.job_label}: ` : ''}{l.description} x {l.quantity}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          <label className="text-xs flex flex-col gap-1">
            Why they came back (which job was refused) - recorded with the return
            <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={300} rows={2} disabled={busy}
              className="px-2 py-1 rounded border text-sm" style={{ borderColor: BORDER }} />
          </label>
          <div>
            <button type="button" onClick={() => void submit()} disabled={busy}
              className="px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-50"
              style={{ background: '#1D4ED8', color: '#FFFFFF', minHeight: 44 }}>
              {busy ? 'Returning...' : 'Return to stock'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm" style={{ color: '#b91c1c' }}>{error}</p>}
      {done && <p className="mt-2 text-sm" style={{ color: '#15803d' }}>{done}</p>}
    </div>
  )
}
