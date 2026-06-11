'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

const PLANS: {
  key:     string
  name:    string
  price:   number
  badge?:  string
  features: string[]
}[] = [
  {
    key:      'hd_reefer',
    name:     'Reefer Standalone',
    price:    79,
    features: ['Reefer Alarm Codes (TK, Carrier)', 'Reefer QuickWrench Diagnostics', 'EPA 608 Refrigerant Log', 'PM Interval Calculator'],
  },
  {
    key:      'starter',
    name:     'HD Starter',
    price:    49,
    features: ['Quoting & Invoicing', 'Parts Inventory', 'Work Orders & Scheduler', 'Fleet Management', 'Truck Engine Diagnostics'],
  },
  {
    key:      'pro',
    name:     'HD Pro',
    price:    99,
    badge:    'Most Popular',
    features: ['Everything in HD Starter', 'DOT Inspection Reports', 'EPA 608 Refrigerant Log', 'Financials & P&L'],
  },
  {
    key:      'elite',
    name:     'HD Elite',
    price:    199,
    badge:    'RECOMMENDED',
    features: ['Everything in HD Pro', 'Reefer Module (alarm codes)', 'Foreman AI Receptionist'],
  },
]

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4 inline-block" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

export default function HDSignupPage() {
  const router  = useRouter()

  // Signup form state
  const [step,    setStep]    = useState<'plan' | 'account'>('plan')
  const [plan,    setPlan]    = useState<string>('pro')
  const [email,   setEmail]   = useState('')
  const [pass,    setPass]    = useState('')
  const [name,    setName]    = useState('')
  const [biz,     setBiz]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // Promo code state
  const [promoInput,       setPromoInput]       = useState('')
  const [promoStatus,      setPromoStatus]      = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle')
  const [promoError,       setPromoError]       = useState<string | null>(null)
  const [promotionCodeId,  setPromotionCodeId]  = useState<string | null>(null)

  const selectedPlan = PLANS.find(p => p.key === plan)!

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
        setPromoError('This promo code is not valid. Please check the code and try again.')
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

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data, error: signupErr } = await supabase.auth.signUp({
        email,
        password: pass,
        options: {
          data: { full_name: name, business_name: biz },
        },
      })
      if (signupErr) throw signupErr
      if (!data.user) throw new Error('Signup failed — please try again.')

      const body: Record<string, unknown> = { plan, userId: data.user.id }
      if (promotionCodeId) body.promotionCodeId = promotionCodeId

      const res  = await fetch('/api/hd/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Checkout failed')
      if (json.url) window.location.href = json.url
      else router.push('/hd/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  // Compute first-payment date for promo confirmation
  const promoFirstPaymentDate = (() => {
    const d = new Date()
    d.setDate(d.getDate() + 90)
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  })()

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-6" style={{ background: '#0a0f14' }}>
      <div className="w-full max-w-4xl">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: HD_ORANGE }}>
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <rect x="1" y="3" width="15" height="13" rx="2" />
                <path d="M16 8h4l3 5v3h-7V8z" />
                <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
            </div>
            <div className="text-left">
              <p className="font-condensed font-bold text-white text-xl tracking-wide leading-none">NWI HD SUITE</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Heavy Duty &amp; Transport Refrigeration</p>
            </div>
          </div>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
            {step === 'plan' ? 'CHOOSE YOUR PLAN' : 'CREATE YOUR ACCOUNT'}
          </h1>
        </div>

        {/* ── Step 1: Plan selection ── */}
        {step === 'plan' && (
          <>
            {/* Plan cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {PLANS.map(p => {
                const isSelected    = plan === p.key
                const isRecommended = p.badge === 'RECOMMENDED'
                const isMostPop     = p.badge === 'Most Popular'

                const borderColor = isSelected
                  ? HD_ORANGE
                  : isRecommended ? HD_ORANGE : '#1e3040'
                const bg = isSelected
                  ? `${HD_ORANGE}18`
                  : isRecommended ? `${HD_ORANGE}0D` : '#111920'
                const shadow = isRecommended && !isSelected
                  ? '0 0 0 3px rgba(232,93,36,0.2)'
                  : undefined

                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPlan(p.key)}
                    className="relative rounded-xl p-5 text-left transition-all"
                    style={{
                      background: bg,
                      border:     `2px solid ${borderColor}`,
                      boxShadow:  shadow,
                      transform:  isRecommended ? 'scale(1.02)' : undefined,
                    }}
                  >
                    {p.badge && (
                      <span
                        className="absolute -top-2.5 left-4 text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wide"
                        style={{
                          background: isRecommended ? HD_ORANGE : HD_BLUE,
                          color: '#fff',
                        }}
                      >
                        {p.badge}
                      </span>
                    )}
                    <p className="font-condensed font-bold text-white text-lg tracking-wide">{p.name}</p>
                    <p className="font-condensed font-bold text-3xl mt-1 mb-3" style={{ color: HD_ORANGE }}>
                      ${p.price}<span className="text-base font-normal" style={{ color: 'rgba(255,255,255,0.4)' }}>/mo</span>
                    </p>
                    <ul className="space-y-1.5">
                      {p.features.map(f => (
                        <li key={f} className="flex items-start gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
                          <span className="flex-shrink-0 mt-0.5" style={{ color: isSelected ? HD_ORANGE : '#22C55E' }}>✓</span>
                          {f}
                        </li>
                      ))}
                    </ul>
                  </button>
                )
              })}
            </div>

            {/* Promo code */}
            <div className="mb-4">
              {promoStatus === 'valid' ? (
                <div
                  className="rounded-xl px-4 py-3 flex items-start gap-3"
                  style={{ background: '#22C55E12', border: '1px solid #22C55E40' }}
                >
                  <svg className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-green-400">Promo code applied — 90 day free trial activated</p>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      You will not be charged for 90 days. Your first payment of ${selectedPlan.price}/month will be on {promoFirstPaymentDate}.
                      Card is required but will not be charged until {promoFirstPaymentDate}.
                    </p>
                    <button
                      onClick={handleRemovePromo}
                      className="text-xs mt-1.5 underline"
                      style={{ color: 'rgba(255,255,255,0.3)' }}
                    >
                      Remove code
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-xs mb-2" style={{ color: 'rgba(255,255,255,0.3)' }}>Have a promo code?</p>
                  <div className="flex gap-2 max-w-sm">
                    <input
                      type="text"
                      value={promoInput}
                      onChange={e => {
                        setPromoInput(e.target.value)
                        if (promoStatus !== 'idle') { setPromoStatus('idle'); setPromoError(null) }
                      }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleApplyPromo() } }}
                      placeholder="Enter promo code"
                      className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm text-white placeholder-white/20"
                      style={{ background: '#111920', border: '1px solid #1e3040' }}
                    />
                    <button
                      type="button"
                      onClick={handleApplyPromo}
                      disabled={!promoInput.trim() || promoStatus === 'checking'}
                      className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-40 whitespace-nowrap"
                      style={{ border: '1px solid #1e3040', color: 'rgba(255,255,255,0.5)' }}
                    >
                      {promoStatus === 'checking' ? <Spinner /> : 'Apply'}
                    </button>
                  </div>
                  {promoStatus === 'invalid' && promoError && (
                    <p className="text-red-400 text-xs mt-1.5">{promoError}</p>
                  )}
                </div>
              )}
            </div>

            {/* Continue */}
            <button
              onClick={() => setStep('account')}
              className="w-full py-3 rounded-xl font-bold text-white text-sm"
              style={{ background: HD_ORANGE }}
            >
              Continue with {selectedPlan.name} →
            </button>
            <p className="text-center text-xs mt-3" style={{ color: 'rgba(255,255,255,0.3)' }}>
              {promoStatus === 'valid'
                ? '90-day free trial · Card required · You will not be charged for 90 days'
                : '14-day free trial · Cancel anytime'}
            </p>
          </>
        )}

        {/* ── Step 2: Account creation ── */}
        {step === 'account' && (
          <form onSubmit={handleSignup} className="max-w-md mx-auto">
            <div className="rounded-xl p-6 space-y-4" style={{ background: '#111920', border: '1px solid #1e3040' }}>
              <div className="flex items-center justify-between">
                <p className="font-condensed font-bold text-white text-lg">Account Details</p>
                <div className="flex items-center gap-2">
                  <div className="text-xs px-2 py-1 rounded-full" style={{ background: `${HD_ORANGE}25`, color: HD_ORANGE }}>
                    {selectedPlan.name}
                  </div>
                  {promoStatus === 'valid' && (
                    <div className="text-xs px-2 py-1 rounded-full" style={{ background: '#22C55E18', color: '#22C55E' }}>
                      90-day trial
                    </div>
                  )}
                </div>
              </div>

              {[
                { label: 'Full Name',      value: name,  setter: setName,  type: 'text',     placeholder: 'John Smith'           },
                { label: 'Business Name',  value: biz,   setter: setBiz,   type: 'text',     placeholder: 'Smith Refrigeration'  },
                { label: 'Email',          value: email, setter: setEmail, type: 'email',    placeholder: 'john@example.com'     },
                { label: 'Password',       value: pass,  setter: setPass,  type: 'password', placeholder: '8+ characters'        },
              ].map(({ label, value, setter, type, placeholder }) => (
                <div key={label}>
                  <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    {label}
                  </label>
                  <input
                    type={type}
                    value={value}
                    onChange={e => setter(e.target.value)}
                    placeholder={placeholder}
                    required
                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                    style={{ background: '#162030', border: '1px solid #1e3040' }}
                  />
                </div>
              ))}

              {promoStatus === 'valid' && (
                <div
                  className="rounded-lg px-3 py-2.5 text-xs"
                  style={{ background: '#22C55E10', border: '1px solid #22C55E30', color: '#22C55E' }}
                >
                  90-day free trial applied. Your first payment of ${selectedPlan.price}/month will be on {promoFirstPaymentDate}.
                </div>
              )}

              {error && <p className="text-sm text-red-400">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl font-bold text-white text-sm"
                style={{ background: HD_ORANGE, opacity: loading ? 0.6 : 1 }}
              >
                {loading ? 'Creating Account…' : promoStatus === 'valid' ? 'Start 90-Day Free Trial' : 'Start Free Trial'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setStep('plan')}
              className="mt-3 text-xs w-full text-center"
              style={{ color: 'rgba(255,255,255,0.3)' }}
            >
              ← Change plan
            </button>
          </form>
        )}

        <p className="text-center text-xs mt-6" style={{ color: 'rgba(255,255,255,0.25)' }}>
          Already have an account?{' '}
          <a href="/hd/login" style={{ color: HD_ORANGE }}>Sign in</a>
        </p>
      </div>
    </div>
  )
}
