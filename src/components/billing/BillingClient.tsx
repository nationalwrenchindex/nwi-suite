'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Subscription } from '@/lib/subscription'
import {
  MODULE_LABELS,
  MODULE_DESCRIPTIONS,
  MODULE_PICK_COUNT,
  type PlanTier,
} from '@/lib/stripe-plans'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Plan {
  tier:      PlanTier
  name:      string
  price:     number
  priceKey:  string
  modules:   string[]
  badge?:    string
  features:  string[]
  trialDays: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_DISPLAY: Record<string, { label: string; badge: string }> = {
  active:   { label: 'Active',   badge: 'bg-success/15 text-success border-success/30'       },
  trialing: { label: 'Trialing', badge: 'bg-blue/15 text-blue-light border-blue/30'          },
  past_due: { label: 'Past Due', badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  canceled: { label: 'Cancelled', badge: 'bg-white/5 text-white/30 border-white/10'          },
  inactive: { label: 'Inactive', badge: 'bg-white/5 text-white/30 border-white/10'           },
}

const TIER_DISPLAY: Record<string, string> = {
  starter:            'NWI Starter',
  pro:                'NWI Pro',
  full_suite:         'NWI Full Suite',
  full_suite_plus:    'NWI Full Suite Plus',
  elite:              'NWI Elite',
  foreman_standalone: 'NWI Foreman Standalone',
  quickwrench:        'NWI QuickWrench',
}

// NWI tiers in price order (excludes foreman_standalone — different product track)
const NWI_TIER_ORDER: PlanTier[] = ['starter', 'pro', 'full_suite', 'full_suite_plus', 'elite']

function fmtPeriodEnd(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

// ─── Plan card ────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  isCurrent,
  onSelect,
  loading,
}: {
  plan:      Plan
  isCurrent: boolean
  onSelect:  (tier: PlanTier) => void
  loading:   PlanTier | null
}) {
  const isLoading    = loading === plan.tier
  const pickCount    = MODULE_PICK_COUNT[plan.tier]
  const noTrial      = plan.trialDays === 0
  const isRecommended = plan.badge === 'RECOMMENDED'

  const borderClass = isCurrent
    ? 'border border-orange bg-orange/5 ring-1 ring-orange/20'
    : isRecommended
    ? 'border-2 border-orange bg-orange/5 scale-[1.02]'
    : plan.badge === 'Most Popular'
    ? 'border border-blue/40 bg-blue/5'
    : plan.badge === 'All-In-One'
    ? 'border border-purple-500/40 bg-purple-500/5'
    : plan.badge === 'STANDALONE'
    ? 'border border-white/15 bg-dark-card hover:border-white/25'
    : 'border border-dark-border bg-dark-card hover:border-white/20'

  const cardStyle = isRecommended
    ? { boxShadow: '0 0 0 3px rgba(255,102,0,0.2)' }
    : {}

  return (
    <div className={`relative rounded-2xl p-6 flex flex-col transition-all ${borderClass}`} style={cardStyle}>

      {plan.badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className={`text-[10px] font-bold px-3 py-1 rounded-full tracking-wide uppercase
            ${plan.badge === 'Most Popular'  ? 'bg-blue text-white' :
              plan.badge === 'RECOMMENDED'   ? 'bg-orange text-white' :
              plan.badge === 'All-In-One'    ? 'bg-purple-600 text-white' :
              plan.badge === 'STANDALONE'    ? 'bg-dark-lighter border border-white/20 text-white/60' :
              'bg-dark-lighter border border-dark-border text-white'}`}>
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
        <p className="text-white/30 text-[11px] mt-1">
          {noTrial ? 'Billed immediately · No free trial' : '14-day free trial included'}
        </p>
      </div>

      {/* Module selection preview (Starter / Pro only) */}
      {pickCount ? (
        <div className="mb-4">
          <p className="text-orange text-[11px] font-condensed font-bold tracking-wide uppercase mb-2.5">
            {pickCount === 1 ? 'Choose 1 of these 3 modules:' : 'Choose any 2 of these 3 modules:'}
          </p>
          <ul className="space-y-2">
            {(Object.keys(MODULE_DESCRIPTIONS) as (keyof typeof MODULE_DESCRIPTIONS)[]).map(slug => (
              <li key={slug} className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-orange/50 flex-shrink-0 mt-1.5" />
                <p className="text-white/55 text-xs leading-snug">
                  <span className="text-white/80 font-medium">{MODULE_LABELS[slug]}</span>
                  {' — '}{MODULE_DESCRIPTIONS[slug]}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : plan.modules.length > 0 ? (
        /* Module chips for fixed-module plans */
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
      ) : null}

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
            ${plan.badge === 'Most Popular'
              ? 'bg-blue hover:bg-blue/90 text-white'
              : plan.badge === 'RECOMMENDED'
              ? 'bg-orange hover:bg-orange-hover text-white'
              : plan.badge === 'All-In-One'
              ? 'bg-purple-600 hover:bg-purple-700 text-white'
              : 'bg-dark-border hover:bg-white/10 text-white border border-dark-border hover:border-white/20'
            }`}
        >
          {isLoading
            ? <span className="flex items-center justify-center gap-2"><Spinner />Starting…</span>
            : pickCount === 1
            ? 'Choose 1 Module →'
            : pickCount === 2
            ? 'Choose 2 Modules →'
            : `Get ${plan.name}`}
        </button>
      )}
    </div>
  )
}

// ─── Module access chips (used in subscription views) ─────────────────────────

function ModuleChips({
  ownedModules,
  foremanActive,
}: {
  ownedModules:  string[]
  foremanActive: boolean
}) {
  const allModules = ['scheduler', 'intel', 'financials', 'quickwrench', 'torquewrench', 'foreman']
  // Only show modules relevant to what the user might have (avoid showing empty locked chips)
  const maxModule = allModules.filter(m =>
    m === 'foreman'
      ? foremanActive || ownedModules.includes('foreman')
      : ownedModules.includes(m) || ['scheduler','intel','financials'].includes(m)
  )

  return (
    <div className="flex flex-wrap gap-2">
      {maxModule.map(mod => {
        const has = ownedModules.includes(mod) || (mod === 'foreman' && foremanActive)
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
  )
}

// ─── Manage billing button ────────────────────────────────────────────────────

function ManageBillingButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-2 border border-dark-border hover:border-white/20 text-white/60 hover:text-white rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
    >
      {loading ? <Spinner /> : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
          <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
      )}
      Manage Billing
    </button>
  )
}

// ─── Foreman-only view (add-on without base tier) ─────────────────────────────

function ForemanOnlyView({
  plans,
  onOpenPortal,
  onChangePlan,
  loadingPortal,
  loadingPlan,
}: {
  plans:         Plan[]
  onOpenPortal:  () => void
  onChangePlan:  (tier: PlanTier) => void
  loadingPortal: boolean
  loadingPlan:   PlanTier | null
}) {
  const nwiPlans = plans.filter(p => NWI_TIER_ORDER.includes(p.tier))
  return (
    <div className="space-y-6">
      <div className="nwi-card">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Current Plan</p>
            <div className="flex items-center gap-3 flex-wrap">
              <p className="font-condensed font-bold text-3xl text-white">Foreman</p>
              <span className="text-xs font-semibold rounded-full border px-2.5 py-0.5 bg-success/15 text-success border-success/30">
                Active
              </span>
            </div>
            <p className="text-white/40 text-sm mt-1">$59/month · AI Receptionist Add-On</p>
          </div>
          <ManageBillingButton onClick={onOpenPortal} loading={loadingPortal} />
        </div>

        <div className="mt-5 pt-5 border-t border-dark-border">
          <p className="text-white/30 text-xs uppercase tracking-widest mb-3">Module Access</p>
          <ModuleChips ownedModules={['scheduler']} foremanActive={true} />
          <p className="text-white/25 text-xs mt-3">
            Foreman includes free Scheduler access. Add an NWI tier to unlock Intel Hub, Financials, and more.
          </p>
        </div>
      </div>

      <div>
        <p className="text-white/30 text-xs uppercase tracking-widest mb-3">Add an NWI Tier</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {nwiPlans.map(plan => (
            <PlanCard key={plan.tier} plan={plan} isCurrent={false} onSelect={onChangePlan} loading={loadingPlan} />
          ))}
        </div>
        <p className="text-white/25 text-xs mt-3">
          NWI tiers are billed separately alongside your Foreman subscription.
        </p>
      </div>
    </div>
  )
}

// ─── Active subscription view ─────────────────────────────────────────────────

function ActiveSubscriptionView({
  subscription,
  plans,
  foremanAddonActive,
  onOpenPortal,
  onChangePlan,
  loadingPortal,
  loadingPlan,
}: {
  subscription:       Subscription
  plans:              Plan[]
  foremanAddonActive: boolean
  onOpenPortal:       () => void
  onChangePlan:       (tier: PlanTier) => void
  loadingPortal:      boolean
  loadingPlan:        PlanTier | null
}) {
  const statusCfg = STATUS_DISPLAY[subscription.status] ?? STATUS_DISPLAY.inactive
  const currentPlan = plans.find(p => p.tier === subscription.tier)

  const isForemanStandalone     = subscription.tier === 'foreman_standalone'
  const isQuickWrenchStandalone = subscription.tier === 'quickwrench'
  const currentNwiIndex         = NWI_TIER_ORDER.indexOf(subscription.tier as PlanTier)

  // Plans to offer as upgrades / additions
  const upgradePlans = (isForemanStandalone || isQuickWrenchStandalone)
    ? plans.filter(p => NWI_TIER_ORDER.includes(p.tier))
    : currentNwiIndex >= 0
    ? plans.filter(p => NWI_TIER_ORDER.indexOf(p.tier) > currentNwiIndex)
    : []

  return (
    <div className="space-y-6">
      {/* Trial banner */}
      {subscription.status === 'trialing' && subscription.current_period_end && (() => {
        const end  = new Date(subscription.current_period_end)
        const days = Math.max(0, Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        return (
          <div
            className="bg-blue/10 border border-blue/30 rounded-xl px-4 py-3 flex items-start gap-3"
            suppressHydrationWarning
          >
            <span className="text-lg leading-none mt-0.5" aria-hidden>🎉</span>
            <div className="flex-1">
              <p className="text-blue-light font-medium text-sm">
                Free Trial Active — {days} day{days !== 1 ? 's' : ''} remaining
              </p>
              <p className="text-blue-light/60 text-xs mt-0.5">
                Your first payment will be on {fmtPeriodEnd(subscription.current_period_end)}.
                {' '}Cancel anytime before then with no charge.
              </p>
            </div>
            <button
              onClick={onOpenPortal}
              className="text-blue-light/40 hover:text-blue-light text-xs underline whitespace-nowrap mt-0.5"
            >
              Cancel trial
            </button>
          </div>
        )
      })()}

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
                {currentPlan.trialDays > 0 && ' · 14-day free trial'}
              </p>
            )}
          </div>
          <ManageBillingButton onClick={onOpenPortal} loading={loadingPortal} />
        </div>

        {/* Module access chips */}
        <div className="mt-5 pt-5 border-t border-dark-border">
          <p className="text-white/30 text-xs uppercase tracking-widest mb-3">Module Access</p>
          <ModuleChips
            ownedModules={subscription.modules}
            foremanActive={foremanAddonActive || subscription.tier === 'elite' || subscription.tier === 'foreman_standalone'}
          />
        </div>

        {subscription.current_period_end && (
          <p className="text-white/25 text-xs mt-4 pt-4 border-t border-dark-border" suppressHydrationWarning>
            {subscription.cancel_at_period_end
              ? `⚠️ Cancels on ${fmtPeriodEnd(subscription.current_period_end)}`
              : `Renews on ${fmtPeriodEnd(subscription.current_period_end)}`}
          </p>
        )}
      </div>

      {/* Upgrades / add-ons */}
      {upgradePlans.length > 0 && (
        <div>
          <p className="text-white/30 text-xs uppercase tracking-widest mb-3">
            {(isForemanStandalone || isQuickWrenchStandalone) ? 'Add an NWI Tier' : 'Available Upgrades'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {upgradePlans.map(plan => (
              <PlanCard
                key={plan.tier}
                plan={plan}
                isCurrent={false}
                onSelect={onChangePlan}
                loading={loadingPlan}
              />
            ))}
          </div>
          {(isForemanStandalone || isQuickWrenchStandalone) && (
            <p className="text-white/25 text-xs mt-3">
              NWI tiers are billed separately alongside your standalone subscription.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BillingClient({
  subscription,
  plans,
  foremanAddonActive,
}: {
  subscription:       Subscription | null
  plans:              Plan[]
  foremanAddonActive: boolean
}) {
  const searchParams  = useSearchParams()
  const [loadingPlan,      setLoadingPlan]      = useState<PlanTier | null>(null)
  const [loadingPortal,    setLoadingPortal]    = useState(false)
  const [toast,            setToast]            = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [promoInput,       setPromoInput]       = useState('')
  const [promoStatus,      setPromoStatus]      = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle')
  const [promoError,       setPromoError]       = useState<string | null>(null)
  const [promotionCodeId,  setPromotionCodeId]  = useState<string | null>(null)

  const isActive     = subscription && ['active', 'trialing', 'past_due'].includes(subscription.status)
  const isForemanOnly = foremanAddonActive && !subscription?.tier

  // Handle redirect-back from Stripe
  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      setToast({ type: 'success', msg: 'Subscription activated! Welcome to National Wrench Index Suite™.' })
    } else if (searchParams.get('canceled') === 'true') {
      setToast({ type: 'error', msg: 'Checkout was cancelled. No charge was made.' })
    }
    window.history.replaceState({}, '', '/billing')
  }, [searchParams])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  async function handleApplyPromo() {
    if (!promoInput.trim()) return
    setPromoStatus('checking')
    setPromoError(null)
    try {
      const res  = await fetch('/api/stripe/validate-promo', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: promoInput.trim() }),
      })
      const data = await res.json()
      if (data.valid) {
        setPromoStatus('valid')
        setPromotionCodeId(data.promotionCodeId)
      } else {
        setPromoStatus('invalid')
        setPromoError(data.error ?? 'Invalid promo code')
        setPromotionCodeId(null)
      }
    } catch {
      setPromoStatus('invalid')
      setPromoError('Unable to validate code — please try again')
    }
  }

  function handleRemovePromo() {
    setPromoInput('')
    setPromoStatus('idle')
    setPromoError(null)
    setPromotionCodeId(null)
  }

  async function handleSelectPlan(tier: PlanTier) {
    // Starter and Pro require module selection before checkout
    if (MODULE_PICK_COUNT[tier]) {
      const url = promotionCodeId
        ? `/billing/select?plan=${tier}&promo=${promotionCodeId}`
        : `/billing/select?plan=${tier}`
      window.location.href = url
      return
    }
    setLoadingPlan(tier)
    try {
      const body: Record<string, unknown> = { tier }
      if (promotionCodeId) body.promotionCodeId = promotionCodeId
      const res  = await fetch('/api/stripe/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
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
          {isActive || isForemanOnly ? 'YOUR SUBSCRIPTION' : 'CHOOSE A PLAN'}
        </h1>
        {!isActive && !isForemanOnly && (
          <p className="text-white/40 text-sm mt-1">
            Subscribe to unlock National Wrench Index modules for your business.
          </p>
        )}
      </div>

      {/* Content */}
      {isForemanOnly ? (
        <ForemanOnlyView
          plans={plans}
          onOpenPortal={handleOpenPortal}
          onChangePlan={handleSelectPlan}
          loadingPortal={loadingPortal}
          loadingPlan={loadingPlan}
        />
      ) : isActive && subscription ? (
        <ActiveSubscriptionView
          subscription={subscription}
          plans={plans}
          foremanAddonActive={foremanAddonActive}
          onOpenPortal={handleOpenPortal}
          onChangePlan={handleSelectPlan}
          loadingPortal={loadingPortal}
          loadingPlan={loadingPlan}
        />
      ) : (
        <div>
          {/* Promo code */}
          <div className="mb-6">
            {promoStatus === 'valid' ? (
              <div className="bg-success/10 border border-success/30 rounded-xl px-4 py-3 flex items-start gap-3">
                <svg className="w-4 h-4 text-success flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div className="flex-1" suppressHydrationWarning>
                  <p className="text-success font-medium text-sm">90-day free trial applied</p>
                  <p className="text-success/70 text-xs mt-0.5">
                    {(() => {
                      const d = new Date()
                      d.setDate(d.getDate() + 90)
                      const fmt = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                      return `You will not be charged for 90 days. Your first payment will be on ${fmt}.`
                    })()}
                  </p>
                  <button
                    onClick={handleRemovePromo}
                    className="text-success/50 hover:text-success/80 text-xs mt-1.5 underline"
                  >
                    Remove code
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p className="text-white/30 text-xs mb-2">Have a promo code?</p>
                <div className="flex gap-2 max-w-sm">
                  <input
                    type="text"
                    value={promoInput}
                    onChange={e => {
                      setPromoInput(e.target.value)
                      if (promoStatus !== 'idle') { setPromoStatus('idle'); setPromoError(null) }
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') handleApplyPromo() }}
                    placeholder="Enter code"
                    className="flex-1 bg-dark-card border border-dark-border rounded-xl px-3 py-2 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-white/20 min-w-0"
                  />
                  <button
                    onClick={handleApplyPromo}
                    disabled={!promoInput.trim() || promoStatus === 'checking'}
                    className="px-4 py-2 rounded-xl border border-dark-border text-white/60 hover:text-white hover:border-white/20 text-sm transition-colors disabled:opacity-40 whitespace-nowrap"
                  >
                    {promoStatus === 'checking' ? <Spinner /> : 'Apply'}
                  </button>
                </div>
                {promoStatus === 'invalid' && promoError && (
                  <p className="text-danger text-xs mt-1.5">{promoError}</p>
                )}
              </div>
            )}
          </div>

          {/* NWI Suite Plans */}
          <p className="text-white/30 text-[11px] uppercase tracking-widest mb-3">NWI Suite Plans</p>

          {/* Row 1: Starter, Pro, Full Suite */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-5">
            {plans.filter(p => ['starter', 'pro', 'full_suite'].includes(p.tier)).map(plan => (
              <PlanCard
                key={plan.tier}
                plan={plan}
                isCurrent={false}
                onSelect={handleSelectPlan}
                loading={loadingPlan}
              />
            ))}
          </div>

          {/* Row 2: Full Suite Plus, Elite */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-10">
            {plans.filter(p => ['full_suite_plus', 'elite'].includes(p.tier)).map(plan => (
              <PlanCard
                key={plan.tier}
                plan={plan}
                isCurrent={false}
                onSelect={handleSelectPlan}
                loading={loadingPlan}
              />
            ))}
          </div>

          {/* Standalone Tools */}
          <div className="border-t border-dark-border pt-8 mb-8">
            <p className="font-condensed font-bold text-white/60 text-base tracking-wide mb-1">
              Already have a shop management system?
            </p>
            <p className="text-white/30 text-sm mb-5">Add just the tool you need.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {plans.filter(p => ['foreman_standalone', 'quickwrench'].includes(p.tier)).map(plan => (
                <PlanCard
                  key={plan.tier}
                  plan={plan}
                  isCurrent={false}
                  onSelect={handleSelectPlan}
                  loading={loadingPlan}
                />
              ))}
            </div>
          </div>

          <div className="nwi-card text-center py-5">
            <p className="text-white/30 text-xs mb-1">All plans include</p>
            <p className="text-white/60 text-sm">
              Secure Stripe billing · Cancel anytime · No contracts
            </p>
          </div>
        </div>
      )}
    </main>
  )
}
