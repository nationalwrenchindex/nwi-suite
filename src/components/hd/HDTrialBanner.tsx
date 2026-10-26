'use client'

import { useState, useEffect } from 'react'
import { tint } from '@/lib/hd/text-tone'

const HD_ORANGE = '#E85D24'

// The HD Elite free trial's notice (15 days, card required - src/lib/ld-trial.ts).
// Shown by /hd/dashboard while the subscription is trialing; current_period_end is the
// trial's end, which the webhook and hd-provision.ts both record from Stripe.
export default function HDTrialBanner({
  trialEndISO,
  monthlyPrice,
}: {
  trialEndISO:  string
  monthlyPrice: number
}) {
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const endDate  = new Date(trialEndISO)
  const daysLeft = Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
  const dateFmt  = endDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  async function handleCancel() {
    setLoading(true)
    try {
      const res  = await fetch('/api/stripe/portal', { method: 'POST' })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } finally {
      setLoading(false)
    }
  }

  if (!mounted) return null

  return (
    <div
      className="rounded-xl px-5 py-4 flex items-start gap-3"
      style={{ background: `${tint(HD_ORANGE, 7)}`, border: `1px solid ${tint(HD_ORANGE, 25)}` }}
      suppressHydrationWarning
    >
      <span className="text-xl leading-none mt-0.5" aria-hidden>🎉</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-white">
          Free Trial Active — {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--hd-text-muted)' }}>
          Your first payment of ${monthlyPrice}/month will be on {dateFmt}.
          {' '}Cancel anytime before then — you will never be charged.
        </p>
        <button
          onClick={handleCancel}
          disabled={loading}
          className="text-xs mt-1.5 underline disabled:opacity-50"
          style={{ color: 'var(--hd-text-faint)' }}
        >
          {loading ? 'Opening portal…' : `Cancel anytime before ${dateFmt}`}
        </button>
      </div>
    </div>
  )
}
