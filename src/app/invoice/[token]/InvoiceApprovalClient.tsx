'use client'

import { useState } from 'react'

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

export default function InvoiceApprovalClient({
  token,
  invoiceTotal,
}: {
  token:        string
  invoiceTotal: number
}) {
  const [tipCents,   setTipCents]   = useState(0)
  const [customTip,  setCustomTip]  = useState('')
  const [selected,   setSelected]   = useState<'none' | 10 | 15 | 20 | 'custom'>('none')
  const [submitting, setSubmitting] = useState(false)
  const [done,       setDone]       = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  function pickPreset(pct: 10 | 15 | 20) {
    const cents = Math.round(invoiceTotal * pct / 100 * 100)
    setTipCents(cents)
    setSelected(pct)
    setCustomTip('')
  }

  function pickNone() {
    setTipCents(0)
    setSelected('none')
    setCustomTip('')
  }

  function handleCustomChange(val: string) {
    setCustomTip(val)
    setSelected('custom')
    setTipCents(Math.round((Number(val) || 0) * 100))
  }

  async function handleConfirm() {
    setSubmitting(true)
    setError(null)
    try {
      const res  = await fetch(`/api/invoices/public/${token}/tip`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tip_cents: tipCents }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to confirm')
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-5 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
          </svg>
        </div>
        <div>
          <p className="text-emerald-400 font-bold">Payment Confirmed!</p>
          <p className="text-emerald-400/60 text-sm mt-0.5">
            Thank you. Your invoice is now marked as paid
            {tipCents > 0 ? ` with a ${fmt(tipCents / 100)} tip` : ''}.
          </p>
        </div>
      </div>
    )
  }

  const grandTotal = invoiceTotal + tipCents / 100

  return (
    <div className="bg-white/5 rounded-2xl border border-white/10 p-5 space-y-5">
      <div>
        <p className="text-white font-semibold text-base">Confirm Payment</p>
        <p className="text-white/50 text-sm mt-0.5">Optionally add a tip for your detailer.</p>
      </div>

      {/* Tip options */}
      <div className="space-y-3">
        <p className="text-white/40 text-xs uppercase tracking-widest">Tip Amount</p>
        <div className="grid grid-cols-4 gap-2">
          {(['none', 10, 15, 20] as const).map(opt => (
            <button
              key={opt}
              onClick={() => opt === 'none' ? pickNone() : pickPreset(opt)}
              className={`py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
                selected === opt
                  ? 'bg-orange border-orange text-white'
                  : 'border-white/15 bg-white/5 text-white/60 hover:border-white/30 hover:text-white'
              }`}
            >
              {opt === 'none' ? 'No tip' : `${opt}%`}
            </button>
          ))}
        </div>

        {/* Custom tip */}
        <div>
          <label className="text-white/40 text-xs uppercase tracking-widest block mb-1.5">Custom Amount</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">$</span>
            <input
              type="number"
              min={0}
              step={1}
              placeholder="0.00"
              value={customTip}
              onChange={e => handleCustomChange(e.target.value)}
              className="w-full bg-white/8 border border-white/15 rounded-xl pl-7 pr-4 py-2.5 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-orange/50"
            />
          </div>
        </div>
      </div>

      {/* Total with tip */}
      <div className="flex justify-between items-baseline border-t border-white/10 pt-4">
        <span className="text-white/60 text-sm">
          {tipCents > 0 ? `Total with ${fmt(tipCents / 100)} tip` : 'Total'}
        </span>
        <span className="text-[#FF6600] font-bold text-2xl">{fmt(grandTotal)}</span>
      </div>

      {error && (
        <p className="text-red-400 text-sm">{error}</p>
      )}

      <button
        onClick={handleConfirm}
        disabled={submitting}
        className="w-full py-3.5 bg-[#FF6600] hover:bg-orange-600 disabled:opacity-50 text-white font-bold text-base rounded-xl transition-colors shadow-lg shadow-orange/20"
      >
        {submitting ? 'Confirming…' : 'Approve & Confirm Payment'}
      </button>
    </div>
  )
}
