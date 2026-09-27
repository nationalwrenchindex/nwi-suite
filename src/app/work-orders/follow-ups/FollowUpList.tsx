'use client'

// Declined segments the shop has not closed out yet.
//
// Each row is a known truck with a known fault and a customer who already said "not
// today" — which is a better lead than a cold call, and the reason a declined segment
// is kept rather than deleted.

import { useState } from 'react'
import Link from 'next/link'
import { money } from '@/lib/format'

export interface FollowUpRow {
  segment_id:        string
  work_order_id:     string
  work_order_number: string
  sequence:          number
  complaint:         string | null
  cause:             string | null
  grand_total:       number | null
  declined_at:       string | null
  followup_due_on:   string | null
  customer_name:     string | null
  customer_phone:    string | null
  unit_label:        string | null
  customer_note:     string | null
}

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export default function FollowUpList({ initialRows }: { initialRows: FollowUpRow[] }) {
  const [rows, setRows] = useState(initialRows)
  const [busy, setBusy] = useState<string | null>(null)
  const [err,  setErr]  = useState<string | null>(null)

  const total = rows.reduce((s, r) => s + Number(r.grand_total ?? 0), 0)
  const today = new Date().toISOString().slice(0, 10)

  async function close(row: FollowUpRow) {
    setBusy(row.segment_id); setErr(null)
    try {
      const res = await fetch(`/api/work-orders/${row.work_order_id}/segments/${row.segment_id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ followup_closed: true }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error ?? 'Could not close this out')
      setRows(prev => prev.filter(r => r.segment_id !== row.segment_id))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not close this out')
    }
    setBusy(null)
  }

  if (rows.length === 0) {
    return (
      <div className="py-16 text-center rounded-xl border border-white/10">
        <p className="text-white/30 text-sm">
          Nothing outstanding. Declined work shows up here so you can chase it later.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {err && <div className="alert-error">{err}</div>}

      <div className="flex items-center justify-between">
        <p className="text-white/40 text-xs uppercase tracking-widest">
          {rows.length} open · {money(total)} declined
        </p>
      </div>

      <div className="rounded-xl border border-white/10 overflow-hidden">
        {rows.map(r => {
          // Due today or earlier. Shown rather than hidden before its date — a shop
          // scanning the list wants to see what is ripe, not have it withheld.
          const due = !!r.followup_due_on && r.followup_due_on <= today
          return (
            <div key={r.segment_id} className="px-4 py-3 border-b border-white/5 last:border-0">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/work-orders/${r.work_order_id}`}
                      className="text-orange font-mono text-xs hover:underline"
                    >
                      {r.work_order_number}
                    </Link>
                    <span className="text-white/25 text-xs">segment {r.sequence}</span>
                    {due && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange/20 text-orange">
                        DUE
                      </span>
                    )}
                  </div>
                  <p className="text-white/80 text-sm mt-0.5">
                    {r.complaint || r.cause || 'Declined work'}
                  </p>
                  <p className="text-white/40 text-xs mt-0.5">
                    {r.customer_name ?? 'No customer'}
                    {r.unit_label ? ` · ${r.unit_label}` : ''}
                    {' · declined '}{fmtDate(r.declined_at)}
                  </p>
                  {r.customer_note && (
                    <p className="text-white/35 text-xs mt-1 italic">&ldquo;{r.customer_note}&rdquo;</p>
                  )}
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-white text-sm font-medium">{money(r.grand_total)}</span>
                  {r.customer_phone && (
                    <a
                      href={`tel:${r.customer_phone}`}
                      className="px-3 py-1.5 rounded-lg text-xs border border-white/15 text-white/60 hover:text-white transition-colors"
                    >
                      Call
                    </a>
                  )}
                  <button
                    onClick={() => close(r)}
                    disabled={busy === r.segment_id}
                    title="Take this off the follow-up list. The segment stays declined."
                    className="text-xs text-white/35 hover:text-white/70 transition-colors disabled:opacity-50"
                  >
                    {busy === r.segment_id ? 'Closing…' : 'Close out'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
