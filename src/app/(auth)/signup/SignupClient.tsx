'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PLANS } from '@/lib/stripe-plans'
import type { PlanTier } from '@/lib/stripe-plans'

type SignupPlan = PlanTier | 'foreman'
type ProfessionType = 'mobile_mechanic' | 'other'

const PROFESSIONS: { value: ProfessionType; label: string; emoji: string; sub: string }[] = [
  {
    value: 'mobile_mechanic',
    label: 'Mobile Mechanic',
    emoji: '🔧',
    sub: 'Oil changes, brakes, diagnostics & repair',
  },
  {
    value: 'other',
    label: 'Mobile Detailer',
    emoji: '🚿',
    sub: 'Interior/exterior detailing & paint correction',
  },
]

const FOREMAN_FEATURES = [
  '24/7 AI phone receptionist',
  'Books appointments automatically',
  'Asks engine size (mechanic-specific)',
  'Customer + mechanic SMS notifications',
  'Free Scheduler included',
  'Upgrade to add invoicing, QuickWrench, more',
]

const CheckMark = () => (
  <svg className="w-3 h-3 text-success flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
  </svg>
)

const SelectedDot = () => (
  <div className="absolute top-3 left-3 w-4 h-4 rounded-full bg-orange flex items-center justify-center">
    <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  </div>
)

interface Props {
  foremanAvailable: boolean
}

export default function SignupClient({ foremanAvailable }: Props) {
  const router = useRouter()

  const [step, setStep]               = useState<1 | 2>(1)
  const [fullName, setFullName]       = useState('')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [confirmPwd, setConfirmPwd]   = useState('')
  const [profession, setProfession]   = useState<ProfessionType>('mobile_mechanic')
  const [plan, setPlan]               = useState<SignupPlan>('starter')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [success, setSuccess]         = useState(false)

  function validateStep1() {
    if (!fullName.trim()) return 'Please enter your full name.'
    if (!email.trim()) return 'Please enter your email.'
    if (password.length < 8) return 'Password must be at least 8 characters.'
    if (password !== confirmPwd) return 'Passwords do not match.'
    return null
  }

  function handleNextStep(e: React.FormEvent) {
    e.preventDefault()
    const err = validateStep1()
    if (err) { setError(err); return }
    setError(null)
    setStep(2)
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          full_name:       fullName,
          profession_type: profession,
          plan:            plan === 'foreman' ? null : plan,
        },
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      try {
        if (plan === 'foreman') {
          const res  = await fetch('/api/stripe/foreman/checkout', { method: 'POST' })
          const json = await res.json()
          if (json.url) { window.location.href = json.url; return }
          if (res.status !== 503) {
            setError(json.error ?? 'Checkout failed. Please try again.')
            setLoading(false)
            return
          }
          router.push('/foreman/welcome')
          return
        } else {
          const res  = await fetch('/api/stripe/checkout', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ tier: plan, source: 'signup' }),
          })
          const json = await res.json()
          if (json.url) { window.location.href = json.url; return }
          if (res.status !== 503) {
            setError(json.error ?? 'Checkout failed. Please try again.')
            setLoading(false)
            return
          }
        }
      } catch {
        // Network error in dev — continue
      }
      router.push('/onboarding')
      return
    }

    setSuccess(true)
    setLoading(false)
  }

  if (success) {
    return (
      <div className="py-10 text-center">
        <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl">✉️</span>
        </div>
        <h1 className="font-condensed font-bold text-3xl text-white mb-3">CHECK YOUR EMAIL</h1>
        <p className="text-white/60 text-sm leading-relaxed mb-6">
          We sent a confirmation link to <span className="text-white font-medium">{email}</span>.
          Click the link to activate your account, then visit{' '}
          <span className="text-orange">Billing</span> to start your free trial.
        </p>
        <Link href="/login" className="btn-ghost block">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-condensed font-bold text-4xl text-white tracking-wide mb-1">
          CREATE ACCOUNT
        </h1>
        <p className="text-white/50 text-sm">
          Join mobile pros on the{' '}
          <span style={{ color: '#FF6600' }}>National</span>{' '}
          <span style={{ color: '#2969B0' }}>Wrench Index</span>{' '}
          platform.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-7">
        {[1, 2].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                step === s
                  ? 'bg-orange text-white'
                  : step > s
                  ? 'bg-success text-white'
                  : 'bg-dark-border text-white/40'
              }`}
            >
              {step > s ? '✓' : s}
            </div>
            <span className={`text-xs font-medium ${step === s ? 'text-white' : 'text-white/30'}`}>
              {s === 1 ? 'Your Info' : 'Choose Plan'}
            </span>
            {s < 2 && <div className="w-8 h-px bg-dark-border mx-1" />}
          </div>
        ))}
      </div>

      {error && <div className="alert-error mb-5">{error}</div>}

      {/* ── Step 1: Account info + profession ── */}
      {step === 1 && (
        <form onSubmit={handleNextStep} className="space-y-4">
          <div>
            <label htmlFor="fullName" className="nwi-label">Full name</label>
            <input
              id="fullName"
              type="text"
              required
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              className="nwi-input"
            />
          </div>

          <div>
            <label htmlFor="email" className="nwi-label">Email address</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="nwi-input"
            />
          </div>

          <div>
            <label htmlFor="password" className="nwi-label">Password</label>
            <input
              id="password"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              className="nwi-input"
            />
          </div>

          <div>
            <label htmlFor="confirmPwd" className="nwi-label">Confirm password</label>
            <input
              id="confirmPwd"
              type="password"
              required
              autoComplete="new-password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              placeholder="••••••••"
              className="nwi-input"
            />
          </div>

          <div>
            <label className="nwi-label">I am a</label>
            <div className="grid grid-cols-2 gap-3">
              {PROFESSIONS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setProfession(p.value)}
                  className={`relative rounded-xl border p-4 text-left transition-all ${
                    profession === p.value
                      ? 'border-orange bg-orange-muted'
                      : 'border-dark-border bg-dark-card hover:border-white/30'
                  }`}
                >
                  {profession === p.value && (
                    <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-orange flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                  <span className="text-2xl block mb-1">{p.emoji}</span>
                  <span className="block text-white font-semibold text-sm">{p.label}</span>
                  <span className="block text-white/40 text-xs mt-0.5">{p.sub}</span>
                </button>
              ))}
            </div>
          </div>

          <button type="submit" className="btn-primary mt-2">
            NEXT — CHOOSE PLAN
          </button>

          <p className="text-center text-white/40 text-xs pt-1">
            Already have an account?{' '}
            <Link href="/login" className="text-orange hover:text-orange-light">Sign in</Link>
          </p>
        </form>
      )}

      {/* ── Step 2: Plan selection ── */}
      {step === 2 && (
        <form onSubmit={handleSignup}>
          {(() => {
            const planData = plan === 'foreman' ? null : PLANS.find(p => p.tier === plan)
            if (!planData || planData.trialDays === 0) return null
            return (
              <p className="text-white/50 text-xs uppercase tracking-widest mb-4">
                14-day free trial — no charge until day 15
              </p>
            )
          })()}

          <div className="space-y-3 mb-5">

            {/* ── Main tier cards: Starter, Pro, Full Suite, Full Suite Plus, Elite ── */}
            {PLANS.filter(p => p.tier !== 'foreman_standalone' && p.tier !== 'quickwrench').map((p) => {
              const isSelected = plan === p.tier
              const isElite    = p.tier === 'elite'
              const dollars    = (p.price / 100).toFixed(0)

              return (
                <button
                  key={p.tier}
                  type="button"
                  onClick={() => setPlan(p.tier)}
                  className={`w-full rounded-xl border p-4 text-left transition-all relative ${
                    isSelected
                      ? isElite
                        ? 'border-orange bg-orange/8'
                        : 'border-orange bg-orange-muted'
                      : 'border-dark-border bg-dark-card hover:border-white/30'
                  }`}
                >
                  {p.badge && (
                    <span className={`absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wider ${
                      p.badge === 'Best Value'
                        ? 'bg-orange text-white'
                        : p.badge === 'Most Popular'
                        ? 'bg-orange text-white'
                        : 'bg-white/10 text-white/60'
                    }`}>
                      {p.badge.toUpperCase()}
                    </span>
                  )}

                  <div className="flex items-baseline gap-2 mb-1 pr-20">
                    <span className="font-condensed font-bold text-white text-lg">{p.name}</span>
                    <span className="text-orange font-bold text-sm">
                      ${dollars}<span className="text-white/40 text-xs font-normal">/mo</span>
                    </span>
                  </div>

                  <p className="text-[11px] text-white/40 mb-2">
                    {p.trialDays > 0 ? `14 days free, then $${dollars}/mo` : `Billed immediately · No free trial`}
                  </p>

                  <ul className="space-y-0.5 mb-2">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-center gap-1.5 text-xs text-white/60">
                        <CheckMark />
                        {f}
                      </li>
                    ))}
                  </ul>

                  {isSelected && <SelectedDot />}
                </button>
              )
            })}

            {/* ── Standalone section divider ── */}
            <div className="flex items-center gap-3 pt-1">
              <div className="flex-1 border-t border-dark-border" />
              <p className="text-[10px] text-white/40 text-center leading-snug shrink-0 max-w-[210px]">
                Already have a shop management system?<br />Add just the tool you need.
              </p>
              <div className="flex-1 border-t border-dark-border" />
            </div>

            {/* ── Standalone cards: Foreman + QuickWrench side by side ── */}
            <div className="grid grid-cols-2 gap-2">

              {/* Foreman standalone */}
              <button
                type="button"
                onClick={() => setPlan('foreman')}
                className={`rounded-xl border p-3 text-left transition-all relative ${
                  plan === 'foreman'
                    ? 'border-orange bg-orange/8'
                    : 'border-orange/30 bg-dark-card hover:border-orange/60'
                }`}
              >
                <span className="block text-[9px] font-bold px-1.5 py-0.5 rounded-full tracking-wider bg-orange/20 text-orange border border-orange/30 w-fit mb-2">
                  STANDALONE
                </span>
                <div className="font-condensed font-bold text-white text-sm leading-tight mb-0.5">Foreman</div>
                <div className="text-orange font-bold text-xs mb-1.5">
                  $59<span className="text-white/40 text-[10px] font-normal">/mo</span>
                </div>
                <p className="text-[10px] text-white/40 mb-2 leading-tight">AI Receptionist · No NWI tier required</p>
                <ul className="space-y-0.5">
                  {FOREMAN_FEATURES.slice(0, 4).map((f) => (
                    <li key={f} className="flex items-start gap-1 text-[10px] text-white/60">
                      <CheckMark />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {!foremanAvailable && (
                  <p className="text-[10px] text-yellow-400/80 mt-2 border-t border-yellow-500/20 pt-2 leading-tight">
                    At capacity — joins waitlist.
                  </p>
                )}
                {plan === 'foreman' && <SelectedDot />}
              </button>

              {/* QuickWrench standalone */}
              {(() => {
                const qw = PLANS.find(p => p.tier === 'quickwrench')!
                const isSelected = plan === 'quickwrench'
                return (
                  <button
                    type="button"
                    onClick={() => setPlan('quickwrench')}
                    className={`rounded-xl border p-3 text-left transition-all relative ${
                      isSelected
                        ? 'border-orange bg-orange/8'
                        : 'border-orange/30 bg-dark-card hover:border-orange/60'
                    }`}
                  >
                    <span className="block text-[9px] font-bold px-1.5 py-0.5 rounded-full tracking-wider bg-orange/20 text-orange border border-orange/30 w-fit mb-2">
                      STANDALONE
                    </span>
                    <div className="font-condensed font-bold text-white text-sm leading-tight mb-0.5">QuickWrench</div>
                    <div className="text-orange font-bold text-xs mb-1.5">
                      $69<span className="text-white/40 text-[10px] font-normal">/mo</span>
                    </div>
                    <p className="text-[10px] text-white/40 mb-2 leading-tight">VIN Scanner · No NWI tier required</p>
                    <ul className="space-y-0.5">
                      {qw.features.slice(0, 4).map((f) => (
                        <li key={f} className="flex items-start gap-1 text-[10px] text-white/60">
                          <CheckMark />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    {isSelected && <SelectedDot />}
                  </button>
                )
              })()}

            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setStep(1); setError(null) }}
              className="w-1/3 border border-dark-border rounded-lg py-3 text-white/60 hover:text-white text-sm font-medium transition-colors"
            >
              ← Back
            </button>
            <button type="submit" disabled={loading} className="flex-1 btn-primary">
              {loading
                ? 'Creating account…'
                : plan === 'foreman' || plan === 'elite' || plan === 'quickwrench'
                ? 'GET STARTED TODAY →'
                : 'START FREE TRIAL →'}
            </button>
          </div>

          <p className="text-white/30 text-xs text-center mt-3">
            {plan === 'foreman'
              ? '$59/mo · No NWI tier required · Cancel anytime.'
              : plan === 'quickwrench'
              ? '$69/mo · No NWI tier required · 14-day free trial.'
              : 'No charge for 14 days. Cancel anytime.'}
          </p>
        </form>
      )}
    </div>
  )
}
