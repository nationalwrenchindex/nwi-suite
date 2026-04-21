'use client'

import { useState, useEffect } from 'react'

type QuoteStatus = 'draft' | 'sent' | 'approved' | 'declined' | 'converted' | 'expired'

interface Props {
  token:         string
  initialStatus: QuoteStatus
  grandTotal:    number | null
  quoteNumber:   string
  bizName:       string
  isExpired:     boolean
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '$0.00'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function QuoteApprovalClient({
  token,
  initialStatus,
  grandTotal,
  quoteNumber,
  bizName,
  isExpired,
}: Props) {
  const [status,          setStatus]          = useState<QuoteStatus>(initialStatus)
  const [showApprove,     setShowApprove]     = useState(false)
  const [showDecline,     setShowDecline]     = useState(false)
  const [declineNote,     setDeclineNote]     = useState('')
  const [loading,         setLoading]         = useState(false)
  const [viewTracked,     setViewTracked]     = useState(false)

  // Track the view on mount
  useEffect(() => {
    if (viewTracked) return
    setViewTracked(true)
    fetch(`/api/quotes/public/${token}/view`, { method: 'POST' })
      .then(r => r.ok ? r.json() : null)
      .then((data: { status?: QuoteStatus } | null) => {
        if (data?.status && data.status !== status) setStatus(data.status)
      })
      .catch(() => {})
  }, [token, status, viewTracked])

  async function handleApprove() {
    setLoading(true)
    try {
      const res = await fetch(`/api/quotes/public/${token}/respond`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'approve' }),
      })
      if (res.ok) {
        setStatus('approved')
        setShowApprove(false)
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleDecline() {
    setLoading(true)
    try {
      const res = await fetch(`/api/quotes/public/${token}/respond`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'decline', note: declineNote || undefined }),
      })
      if (res.ok) {
        setStatus('declined')
        setShowDecline(false)
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Status banners for resolved / expired states ───────────────────────────

  if (status === 'approved') {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center space-y-2">
        <div className="text-4xl">✓</div>
        <p className="text-emerald-400 font-bold text-xl">Quote Approved</p>
        <p className="text-white/60 text-sm">
          Thank you for approving. Your service professional will be in touch directly with any questions or updates.
        </p>
      </div>
    )
  }

  if (status === 'declined') {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center space-y-2">
        <p className="text-white/70 font-semibold">Quote Declined</p>
        <p className="text-white/40 text-sm">Thanks for letting us know. {bizName} has been notified.</p>
      </div>
    )
  }

  if (status === 'expired' || isExpired) {
    return (
      <div className="rounded-2xl border border-orange-500/30 bg-orange-500/10 p-5 text-center space-y-2">
        <p className="text-orange-400 font-semibold">This quote has expired</p>
        <p className="text-white/50 text-sm">
          Please contact {bizName} for an updated quote.
        </p>
      </div>
    )
  }

  if (status === 'converted') {
    return (
      <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-5 text-center space-y-1">
        <p className="text-purple-400 font-semibold">This quote has been converted to an invoice.</p>
      </div>
    )
  }

  // ── Active quote: show approve / decline buttons ────────────────────────────

  if (status !== 'sent') return null

  return (
    <>
      <div className="space-y-3 pt-2">
        <button
          onClick={() => setShowApprove(true)}
          className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white font-bold text-lg rounded-2xl transition-colors shadow-lg shadow-emerald-500/20"
        >
          Approve Quote
        </button>
        <button
          onClick={() => setShowDecline(true)}
          className="w-full py-3.5 border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-semibold text-base rounded-2xl transition-colors"
        >
          Decline Quote
        </button>
      </div>

      {/* Approve confirmation modal */}
      {showApprove && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 space-y-4">
            <h2 className="text-white font-bold text-lg">Approve this quote?</h2>
            <p className="text-white/60 text-sm">
              You are approving quote{' '}
              <span className="font-mono text-[#FF6600]">{quoteNumber}</span>{' '}
              for a total of{' '}
              <span className="text-white font-semibold">{fmt(grandTotal)}</span>.
            </p>
            <p className="text-white/40 text-xs">
              Your service professional will be in touch directly with any questions or updates.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleApprove}
                disabled={loading}
                className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold rounded-xl transition-colors"
              >
                {loading ? 'Approving…' : 'Yes, Approve'}
              </button>
              <button
                onClick={() => setShowApprove(false)}
                disabled={loading}
                className="flex-1 py-3 border border-white/15 text-white/60 hover:text-white rounded-xl transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Decline modal */}
      {showDecline && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 space-y-4">
            <h2 className="text-white font-bold text-lg">Decline this quote?</h2>
            <div className="space-y-2">
              <label className="text-white/50 text-xs uppercase tracking-widest">
                Tell {bizName} why you&apos;re declining (optional)
              </label>
              <textarea
                rows={3}
                value={declineNote}
                onChange={e => setDeclineNote(e.target.value)}
                placeholder="e.g. Too expensive, found another shop…"
                className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-white/30 resize-none"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleDecline}
                disabled={loading}
                className="flex-1 py-3 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold rounded-xl transition-colors"
              >
                {loading ? 'Declining…' : 'Decline'}
              </button>
              <button
                onClick={() => { setShowDecline(false); setDeclineNote('') }}
                disabled={loading}
                className="flex-1 py-3 border border-white/15 text-white/60 hover:text-white rounded-xl transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
