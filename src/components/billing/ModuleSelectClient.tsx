'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MODULE_LABELS, MODULE_DESCRIPTIONS, MODULE_PICK_COUNT } from '@/lib/stripe-plans'
import type { SelectableModule, PlanTier } from '@/lib/stripe-plans'

// ─── Module definitions ───────────────────────────────────────────────────────

const MODULES: { slug: SelectableModule; icon: React.ReactNode }[] = [
  {
    slug: 'scheduler',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8"  y1="2" x2="8"  y2="6" />
        <line x1="3"  y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    slug: 'intel',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    slug: 'financials',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
]

const PLAN_META: Record<'starter' | 'pro', { name: string; price: string; pickCount: number; heading: string; sub: string }> = {
  starter: {
    name:      'NWI Starter',
    price:     '$19',
    pickCount: 1,
    heading:   'CHOOSE YOUR 1 MODULE',
    sub:       'Pick the module that matters most to your business right now. You can upgrade to Pro anytime to add more.',
  },
  pro: {
    name:      'NWI Pro',
    price:     '$34',
    pickCount: 2,
    heading:   'CHOOSE YOUR 2 MODULES',
    sub:       'Pick the 2 modules that matter most to your business right now. Upgrade to Full Suite anytime to unlock all three.',
  },
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ModuleSelectClient({
  plan,
  promotionCodeId,
}: {
  plan:            'starter' | 'pro'
  promotionCodeId: string | null
}) {
  const [selected,  setSelected]  = useState<SelectableModule[]>([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const meta      = PLAN_META[plan]
  const pickCount = meta.pickCount
  const isReady   = selected.length === pickCount

  function toggle(slug: SelectableModule) {
    setSelected(prev => {
      if (prev.includes(slug)) return prev.filter(s => s !== slug)
      if (prev.length < pickCount) return [...prev, slug]
      // At capacity — replace oldest selection so the UI never gets stuck
      return [...prev.slice(1), slug]
    })
  }

  async function handleContinue() {
    if (!isReady || loading) return
    setLoading(true)
    setError(null)
    try {
      const checkoutBody: Record<string, unknown> = { tier: plan as PlanTier, selectedModules: selected }
      if (promotionCodeId) checkoutBody.promotionCodeId = promotionCodeId
      const res  = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(checkoutBody),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Checkout failed')
      window.location.href = data.url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-8">

      {/* Back */}
      <Link
        href="/billing"
        className="inline-flex items-center gap-1.5 text-white/30 hover:text-white text-sm transition-colors mb-6"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Plans
      </Link>

      {/* Header */}
      <div className="mb-8">
        <p className="text-white/40 text-xs uppercase tracking-widest mb-1">
          {meta.name} · {meta.price}/month · {promotionCodeId ? '90-day free trial' : '14-day free trial'}
        </p>
        <h1 className="font-condensed font-bold text-3xl sm:text-4xl text-white tracking-wide mb-2">
          {meta.heading}
        </h1>
        <p className="text-white/40 text-sm leading-relaxed">{meta.sub}</p>
      </div>

      {/* Module cards */}
      <div className="space-y-3 mb-8">
        {MODULES.map(({ slug, icon }) => {
          const isSelected  = selected.includes(slug)
          const atMax       = selected.length >= pickCount && !isSelected

          return (
            <button
              key={slug}
              onClick={() => toggle(slug)}
              className={`w-full text-left rounded-2xl border p-5 transition-all flex items-start gap-4 min-h-[88px]
                ${isSelected
                  ? 'border-orange bg-orange/5 ring-1 ring-orange/20'
                  : atMax
                  ? 'border-dark-border bg-dark-card opacity-50 cursor-not-allowed'
                  : 'border-dark-border bg-dark-card hover:border-white/20 hover:bg-dark-lighter'}`}
            >
              {/* Icon */}
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors
                ${isSelected ? 'bg-orange/20 text-orange' : 'bg-dark-lighter text-white/25'}`}>
                {icon}
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center justify-between gap-3">
                  <p className={`font-condensed font-bold text-xl tracking-wide leading-none
                    ${isSelected ? 'text-orange' : 'text-white'}`}>
                    {MODULE_LABELS[slug].toUpperCase()}
                  </p>
                  {isSelected && (
                    <div className="w-6 h-6 rounded-full bg-orange flex items-center justify-center flex-shrink-0">
                      <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </div>
                <p className="text-white/50 text-sm mt-1.5 leading-relaxed">
                  {MODULE_DESCRIPTIONS[slug]}
                </p>
              </div>
            </button>
          )
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 bg-danger/10 border border-danger/40 text-danger rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Sticky bottom bar */}
      <div className="sticky bottom-4 z-10">
        <div className="bg-dark-card rounded-2xl border border-dark-border p-4 shadow-xl">

          {/* Selection state */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-white/40 text-sm">
              <span className={isReady ? 'text-success font-medium' : 'text-white/40'}>
                {selected.length}
              </span>
              <span className="text-white/25"> / {pickCount} selected</span>
            </p>
            {isReady && (
              <span className="text-success text-xs font-condensed tracking-wider uppercase">✓ Ready</span>
            )}
          </div>

          {/* Selected chips */}
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {selected.map(s => (
                <span key={s} className="rounded-lg border border-orange/30 bg-orange/10 text-orange text-xs px-2.5 py-1 font-medium">
                  {MODULE_LABELS[s]}
                </span>
              ))}
            </div>
          )}

          {/* CTA */}
          <button
            onClick={handleContinue}
            disabled={!isReady || loading}
            className="w-full py-3.5 rounded-xl font-condensed font-bold text-base tracking-wider transition-all
              bg-orange hover:bg-orange-hover text-white
              disabled:opacity-40 disabled:cursor-not-allowed
              flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                REDIRECTING TO CHECKOUT…
              </>
            ) : !isReady ? (
              `SELECT ${pickCount - selected.length} MORE MODULE${pickCount - selected.length !== 1 ? 'S' : ''} TO CONTINUE`
            ) : (
              'CONTINUE TO CHECKOUT →'
            )}
          </button>

          <p className="text-white/20 text-[11px] text-center mt-2.5">
            14-day free trial · No credit card charged today · Cancel anytime
          </p>
        </div>
      </div>

    </main>
  )
}
