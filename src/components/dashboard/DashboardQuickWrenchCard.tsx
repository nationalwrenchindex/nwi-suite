'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const QW_ICON = (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
)

function UpsellModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [loading, setLoading] = useState<'elite' | 'quickwrench' | null>(null)
  const [error, setError]     = useState<string | null>(null)

  async function handleUpgrade(tier: 'elite' | 'quickwrench') {
    setLoading(tier)
    setError(null)
    try {
      // Try subscription upgrade first (existing subscriber path)
      const res  = await fetch('/api/stripe/upgrade', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tier }),
      })
      const json = await res.json()

      if (res.ok && json.success) {
        // Subscription modified — reload page so QW unlocks
        const tierLabel = tier === 'elite' ? 'Elite' : 'QuickWrench'
        router.refresh()
        onClose()
        // Brief delay then hard reload so the server component re-runs
        setTimeout(() => window.location.href = '/dashboard?upgraded=1', 300)
        return
      }

      if (json.redirect_to_checkout) {
        // No existing subscription — go through Stripe Checkout
        const coRes  = await fetch('/api/stripe/checkout', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ tier }),
        })
        const coJson = await coRes.json()
        if (coJson.url) {
          window.location.href = coJson.url
          return
        }
      }

      setError(json.error ?? 'Something went wrong. Please try again.')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-lg bg-[#141414] border border-white/10 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4 border-b border-white/8">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange/15 border border-orange/30 flex items-center justify-center text-orange">
              {QW_ICON}
            </div>
            <div>
              <h2 className="font-condensed font-bold text-white text-xl tracking-wide">
                Unlock NWI QuickWrench
              </h2>
              <p className="text-white/40 text-xs mt-0.5">Requires QuickWrench or Elite plan</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/30 hover:text-white transition-colors p-1 -mr-1"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Description */}
        <div className="px-6 pt-4 pb-3">
          <p className="text-white/60 text-sm leading-relaxed">
            Scan any VIN and generate a customer-ready quote in under 2 minutes. AI tech guide, multi-supplier parts pricing, customer-facing quotes, and per-job profit tracking — all in one place.
          </p>
        </div>

        {/* Plan options */}
        <div className="px-6 pb-4 grid sm:grid-cols-2 gap-3">
          {/* Elite — recommended */}
          <div className="relative rounded-xl border-2 border-orange/50 bg-orange/5 p-4 flex flex-col gap-3">
            <div className="absolute -top-2.5 left-4">
              <span className="bg-orange text-white text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wider">
                RECOMMENDED
              </span>
            </div>
            <div className="pt-1">
              <div className="flex items-baseline gap-1.5 mb-0.5">
                <span className="font-condensed font-bold text-white text-lg">Upgrade to Elite</span>
              </div>
              <p className="text-orange font-bold text-sm">$99<span className="text-white/40 text-xs font-normal">/mo</span></p>
            </div>
            <p className="text-white/60 text-xs leading-relaxed">
              Everything you have now + QuickWrench + per-job P&L tracking + fuel tracking. Best value.
            </p>
            <p className="text-[10px] text-orange/80 leading-snug">
              🔥 LAUNCH PRICING: $99 locked for first 100 subscribers. After, $129/mo.
            </p>
            <button
              onClick={() => handleUpgrade('elite')}
              disabled={loading !== null}
              className="mt-auto w-full py-2.5 bg-orange hover:bg-orange/90 disabled:opacity-50 text-white font-bold text-sm rounded-lg transition-colors"
            >
              {loading === 'elite' ? 'Redirecting…' : 'Upgrade to Elite'}
            </button>
          </div>

          {/* QuickWrench Standalone */}
          <div className="rounded-xl border border-white/10 bg-white/3 p-4 flex flex-col gap-3">
            <div>
              <div className="flex items-baseline gap-1.5 mb-0.5">
                <span className="font-condensed font-bold text-white text-lg">QuickWrench Only</span>
              </div>
              <p className="text-white/60 font-semibold text-sm">$69<span className="text-white/40 text-xs font-normal">/mo</span></p>
            </div>
            <p className="text-white/50 text-xs leading-relaxed">
              Just the diagnostic engine. Keep your current plan, add QuickWrench as a standalone add-on.
            </p>
            <button
              onClick={() => handleUpgrade('quickwrench')}
              disabled={loading !== null}
              className="mt-auto w-full py-2.5 border border-white/20 hover:border-white/40 disabled:opacity-50 text-white/80 hover:text-white font-semibold text-sm rounded-lg transition-colors"
            >
              {loading === 'quickwrench' ? 'Redirecting…' : 'Get QuickWrench'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-6 mb-4 px-4 py-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">
            {error}
          </div>
        )}

        {/* Footer links */}
        <div className="px-6 pb-5 flex items-center gap-4 text-xs text-white/25">
          <span>Questions?</span>
          <a href="mailto:support@nationalwrenchindex.com" className="hover:text-white/60 transition-colors underline">
            Contact Support
          </a>
          <Link href="/billing" onClick={onClose} className="hover:text-white/60 transition-colors underline">
            View full plan comparison
          </Link>
        </div>
      </div>
    </div>
  )
}

interface Props {
  hasAccess:  boolean
  autoOpen?:  boolean
}

export default function DashboardQuickWrenchCard({ hasAccess, autoOpen }: Props) {
  const [modalOpen, setModalOpen] = useState(false)

  // Auto-open upsell if redirected from /quickwrench with ?upsell=1
  useEffect(() => {
    if (autoOpen && !hasAccess) setModalOpen(true)
  }, [autoOpen, hasAccess])

  const cardBase =
    'nwi-card flex items-start gap-3 transition-colors group relative'

  if (hasAccess) {
    return (
      <Link
        href="/quickwrench"
        className={`${cardBase} hover:border-orange/40 hover:bg-orange/5`}
      >
        <div className="w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 bg-orange/10 border-orange/20 text-orange">
          {QW_ICON}
        </div>
        <div className="min-w-0">
          <p className="font-condensed font-bold text-white text-sm tracking-wide">QUICKWRENCH</p>
          <p className="text-white/30 text-[11px] mt-0.5 leading-tight truncate">Parts · Specs · Quotes</p>
        </div>
      </Link>
    )
  }

  // Locked state
  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className={`${cardBase} hover:border-white/20 hover:bg-white/3 text-left w-full`}
      >
        {/* Lock badge */}
        <div className="relative flex-shrink-0">
          <div className="w-9 h-9 rounded-xl border flex items-center justify-center bg-white/5 border-white/10 text-white/30">
            {QW_ICON}
          </div>
          <div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#1a1a1a] border border-white/15 flex items-center justify-center">
            <svg className="w-2.5 h-2.5 text-white/50" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5 9V7a5 5 0 0 1 10 0v2a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2zm8-2v2H7V7a3 3 0 0 1 6 0z" clipRule="evenodd"/>
            </svg>
          </div>
        </div>
        <div className="min-w-0">
          <p className="font-condensed font-bold text-white/40 text-sm tracking-wide">QUICKWRENCH</p>
          <p className="text-orange text-[10px] mt-0.5 font-semibold tracking-wider">UPGRADE TO UNLOCK</p>
        </div>
      </button>

      {modalOpen && <UpsellModal onClose={() => setModalOpen(false)} />}
    </>
  )
}
