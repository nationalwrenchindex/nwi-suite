'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Subscription } from '@/lib/subscription'
import { MODULE_LABELS, type PlanTier } from '@/lib/stripe'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Plan {
  tier:     PlanTier
  name:     string
  price:    number
  priceKey: string
  modules:  string[]
  badge?:   string
  features: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_DISPLAY: Record<string, { label: string; badge: string }> = {
  active:     { label: 'Active',     badge: 'bg-success/15 text-success border-success/30'          },
  trialing:   { label: 'Trialing',   badge: 'bg-blue/15 text-blue-light border-blue/30'             },
  past_due:   { label: 'Past Due',   badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30'    },
  canceled:   { label: 'Cancelled',  badge: 'bg-white/5 text-white/30 border-white/10'              },
  inactive:   { label: 'Inactive',   badge: 'bg-white/5 text-white/30 border-white/10'              },
}

const TIER_DISPLAY: Record<string, string> = {
  starter:    'Starter',
  pro:        'Pro',
  full_suite: 'Full Suite',
}

function fmtPeriodEnd(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// ─── Plan card ────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  isCurrent,
  isDowngrade,
  onSelect,
  loading,
}: {
  plan:       Plan
  isCurrent:  boolean
  isDowngrade: boolean
  onSelect:   (tier: PlanTier) => void
  loading:    PlanTier | null
}) {
  const isLoading = loading === plan.tier

  return (
    <div className={`relative rounded-2xl border p-6 flex flex-col transition-all
      ${isCurrent
        ? 'border-orange bg-orange/5 ring-1 ring-orange/20'
        : plan.badge
        ? 'border-blue/40 bg-blue/5'
        : 'border-dark-border bg-dark-card hover:border-white/20'}`}>

      {plan.badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="bg-blue text-white text-[10px] font-bold px-3 py-1 rounded-full tracking-wide uppercase">
            {plan.badge}
          </span>
        </div>
      )}

      {isCurrent && (
        <div className="absolute -top-3 right-4">
          <span className="bg-orange text-white text-[10px] font-bold px-3 py-1 rounded-full tracking-wide uppercase">
            Current Plan
          </span>
        </div>
      )}

      {/* Price header */}
      <div className="mb-5">
        <p className="font-condensed font-bold text-white text-xl tracking-wide mb-1">{plan.name}</p>
        <div className="flex items-baseline gap-1">
          <span className="font-condensed font-bold text-4xl text-white">${plan.price / 100}</span>
          <span className="text-white/40 text-sm">/month</span>
        </div>
      </div>

      {/* Modules */}
      <div className="mb-4">
        <p className="text-white/30 text-[10px] uppercase tracking-widest mb-2">Modules Included</p>
        <div className="flex flex-wrap gap-1.5">
          {plan.modules.map(m => (
            <span key={m} className="rounded-lg border border-orange/30 bg-orange/10 text-orange text-xs px-2.5 py-1 font-medium">
              {MODULE_LABELS[m] ?? m}
            </span>
          ))}
        </div>
      </div>

      {/* Features */}
      <ul className="space-y-2 mb-6 flex-1">
        {plan.features.map(f => (
          <li key={f} className="flex items-start gap-2">
            <svg className="w-3.5 h-3.5 text-success flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span className="text-white/60 text-xs leading-tight">{f}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      {isCurrent ? (
        <div className="w-full py-2.5 rounded-xl border border-orange/30 text-orange text-sm font-condensed font-bold text-center">
          ✓ Current Plan
        </div>
      ) : (
        <button
          onClick={() => onSelect(plan.tier)}
          disabled={!!loading}
          className={`w-full py-2.5 rounded-xl text-sm font-condensed font-bold transition-colors disabled:opacity-50
            ${plan.badge
              ? 'bg-blue hover:bg-blue/90 text-white'
              : 'bg-dark-border hover:bg-white/10 text-white border border-dark-border hover:border-white/20'}`}
        >
          {isLoading
            ? <span className="flex items-center justify-center gap-2"><Spinner />{isDowngrade ? 'Switching…' : 'Starting…'}</span>
            : isDowngrade ? 'Switch to This Plan' : `Get ${plan.name}`}
        </button>
      )}
    </div>
  )
}

// ─── Active subscription view ─────────────────────────────────────────────────

function ActiveSubscriptionView({
  subscription,
  plans,
  onOpenPortal,
  onChangePlan,
  loadingPortal,
  loadingPlan,
}: {
  subscription:  Subscription
  plans:         Plan[]
  onOpenPortal:  () => void
  onChangePlan:  (tier: PlanTier) => void
  loadingPortal: boolean
  loadingPlan:   PlanTier | null
}) {
  const statusCfg = STATUS_DISPLAY[subscription.status] ?? STATUS_DISPLAY.inactive
  const currentPlan = plans.find(p => p.tier === subscription.tier)

  return (
    <div className="space-y-6">
      {/* Current plan card */}
      <div className="nwi-card">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Current Plan</p>
            <div className="flex items-center gap-3 flex-wrap">
              <p className="font-condensed font-bold text-3xl text-white">
                {TIER_DISPLAY[subscription.tier ?? ''] ?? 'Unknown'}
              </p>
              <span className={`text-xs font-semibold rounded-full border px-2.5 py-0.5 ${statusCfg.badge}`}>
                {statusCfg.label}
              </span>
            </div>
            {currentPlan && (
              <p className="text-white/40 text-sm mt-1">
                ${currentPlan.price / 100}/month
              </p>
            )}
          </div>
          <button
            onClick={onOpenPortal}
            disabled={loadingPortal}
            className="flex items-center gap-2 border border-dark-border hover:border-white/20 text-white/60 hover:text-white rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loadingPortal ? <Spinner /> : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
            )}
            Manage Billing
          </button>
        </div>

        {/* Module access chips */}
        <div className="mt-5 pt-5 border-t border-dark-border">
          <p className="text-white/30 text-xs uppercase tracking-widest mb-3">Module Access</p>
          <div className="flex flex-wrap gap-2">
            {['scheduler', 'intel', 'financials'].map(mod => {
              const has = subscription.modules.includes(mod)
              return (
                <div key={mod} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm
                  ${has ? 'border-success/30 bg-success/10 text-success' : 'border-dark-border text-white/20'}`}>
                  {has
                    ? <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                    : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m0 0v2m0-2h2m-2 0H10"/><path strokeLinecap="round" strokeLinejoin="round" d="M5 3a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2H5z"/></svg>}
                  {MODULE_LABELS[mod] ?? mod}
                </div>
              )
            })}
          </div>
        </div>

        {subscription.current_period_end && (
          <p className="text-white/25 text-xs mt-4 pt-4 border-t border-dark-border">
            {subscription.cancel_at_period_end
              ? `⚠️ Cancels on ${fmtPeriodEnd(subscription.current_period_end)}`
              : `Renews on ${fmtPeriodEnd(subscription.current_period_end)}`}
          </p>
        )}
      </div>

      {/* Upgrade options (show plans above current) */}
      {subscription.tier !== 'full_suite' && (
        <div>
          <p className="text-white/30 text-xs uppercase tracking-widest mb-3">Available Upgrades</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {plans.map(plan => (
              <PlanCard
                key={plan.tier}
                plan={plan}
                isCurrent={plan.tier === subscription.tier}
                isDowngrade={
                  plans.findIndex(p => p.tier === plan.tier) <
                  plans.findIndex(p => p.tier === subscription.tier)
                }
                onSelect={onChangePlan}
                loading={loadingPlan}
              />
            ))}
          </div>
          <p className="text-white/25 text-xs mt-3">
            Plan changes take effect immediately. You&apos;ll be charged the prorated difference.
            Upgrades and downgrades are handled via the Manage Billing portal.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BillingClient({
  subscription,
  plans,
}: {
  subscription: Subscription | null
  plans:        Plan[]
}) {
  const searchParams  = useSearchParams()
  const [loadingPlan,   setLoadingPlan]   = useState<PlanTier | null>(null)
  const [loadingPortal, setLoadingPortal] = useState(false)
  const [toast,         setToast]         = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const isActive = subscription
    && ['active', 'trialing', 'past_due'].includes(subscription.status)

  // Handle redirect-back from Stripe
  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      setToast({ type: 'success', msg: 'Subscription activated! Welcome to National Wrench Index Suite.' })
    } else if (searchParams.get('canceled') === 'true') {
      setToast({ type: 'error', msg: 'Checkout was cancelled. No charge was made.' })
    }
    // clear query params from URL without re-render
    window.history.replaceState({}, '', '/billing')
  }, [searchParams])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  async function handleSelectPlan(tier: PlanTier) {
    setLoadingPlan(tier)
    try {
      const res  = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tier }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Checkout failed')
      window.location.href = data.url
    } catch (e) {
      setToast({ type: 'error', msg: e instanceof Error ? e.message : 'Something went wrong' })
      setLoadingPlan(null)
    }
  }

  async function handleOpenPortal() {
    setLoadingPortal(true)
    try {
      const res  = await fetch('/api/stripe/portal', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Portal error')
      window.location.href = data.url
    } catch (e) {
      setToast({ type: 'error', msg: e instanceof Error ? e.message : 'Something went wrong' })
      setLoadingPortal(false)
    }
  }

  return (
    <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8">

      {/* Toast */}
      {toast && (
        <div className={`mb-6 rounded-xl border px-4 py-3 text-sm flex items-center gap-3
          ${toast.type === 'success'
            ? 'bg-success/10 border-success/30 text-success'
            : 'bg-danger/10 border-danger/30 text-danger'}`}>
          {toast.type === 'success'
            ? <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
            : <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>}
          {toast.msg}
        </div>
      )}

      {/* Past-due warning */}
      {subscription?.status === 'past_due' && (
        <div className="mb-6 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <p className="text-amber-400 font-medium text-sm">Payment past due</p>
            <p className="text-amber-400/70 text-xs mt-0.5">
              Please update your payment method to keep module access.{' '}
              <button onClick={handleOpenPortal} className="underline hover:no-underline">
                Update now →
              </button>
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Account</p>
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
          {isActive ? 'YOUR SUBSCRIPTION' : 'CHOOSE A PLAN'}
        </h1>
        {!isActive && (
          <p className="text-white/40 text-sm mt-1">
            Subscribe to unlock NWI modules for your business.
          </p>
        )}
      </div>

      {/* Content */}
      {isActive && subscription ? (
        <ActiveSubscriptionView
          subscription={subscription}
          plans={plans}
          onOpenPortal={handleOpenPortal}
          onChangePlan={handleSelectPlan}
          loadingPortal={loadingPortal}
          loadingPlan={loadingPlan}
        />
      ) : (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {plans.map(plan => (
              <PlanCard
                key={plan.tier}
                plan={plan}
                isCurrent={false}
                isDowngrade={false}
                onSelect={handleSelectPlan}
                loading={loadingPlan}
              />
            ))}
          </div>

          <div className="mt-8 nwi-card text-center py-6">
            <p className="text-white/30 text-xs mb-1">All plans include</p>
            <p className="text-white/60 text-sm">
              Public booking page · Secure Stripe billing · Cancel anytime · No contracts
            </p>
          </div>
        </div>
      )}
    </main>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
