'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type ProfessionType = 'mobile_mechanic' | 'other'
type Plan = 'starter' | 'professional' | 'elite'

const PLANS: { id: Plan; name: string; price: string; description: string; features: string[] }[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '$29',
    description: 'Perfect for solo operators just getting started.',
    features: [
      'Up to 50 customers',
      'Job scheduling',
      'Basic invoicing',
      'Vehicle history',
    ],
  },
  {
    id: 'professional',
    name: 'Professional',
    price: '$59',
    description: 'For growing mobile pros who mean business.',
    features: [
      'Unlimited customers',
      'Advanced invoicing',
      'Expense tracking',
      'SMS notifications',
      'Reporting dashboard',
    ],
  },
  {
    id: 'elite',
    name: 'Elite',
    price: '$99',
    description: 'Full suite for high-volume operations.',
    features: [
      'Everything in Professional',
      'Multi-technician support',
      'Route optimization',
      'Priority support',
      'Custom branding',
    ],
  },
]

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

export default function SignupPage() {
  const router = useRouter()

  const [step, setStep]               = useState<1 | 2>(1)
  const [fullName, setFullName]       = useState('')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [confirmPwd, setConfirmPwd]   = useState('')
  const [profession, setProfession]   = useState<ProfessionType>('mobile_mechanic')
  const [plan, setPlan]               = useState<Plan>('professional')
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
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          full_name:       fullName,
          profession_type: profession,
          plan,
        },
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // If email confirmation is disabled in Supabase, the user is auto-logged in
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      router.push('/onboarding')
      return
    }

    // Email confirmation is enabled — show confirmation message
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
          Click the link to activate your account and start your onboarding.
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
          Join thousands of mobile pros on the NWI platform.
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
            <span
              className={`text-xs font-medium ${
                step === s ? 'text-white' : 'text-white/30'
              }`}
            >
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
              placeholder="Marcus Rodriguez"
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

          {/* Profession type */}
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
        <form onSubmit={handleSignup} className="space-y-4">
          <p className="text-white/50 text-xs uppercase tracking-widest mb-1">All plans include a 14-day free trial</p>

          <div className="space-y-3">
            {PLANS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPlan(p.id)}
                className={`w-full rounded-xl border p-4 text-left transition-all relative ${
                  plan === p.id
                    ? 'border-orange bg-orange-muted'
                    : 'border-dark-border bg-dark-card hover:border-white/30'
                }`}
              >
                {p.id === 'professional' && (
                  <span className="absolute top-3 right-3 bg-orange text-white text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wider">
                    POPULAR
                  </span>
                )}
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="font-condensed font-bold text-white text-xl">{p.name}</span>
                  <span className="text-orange font-bold">{p.price}<span className="text-white/40 text-xs font-normal">/mo</span></span>
                </div>
                <p className="text-white/50 text-xs mb-2">{p.description}</p>
                <ul className="space-y-0.5">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-1.5 text-xs text-white/70">
                      <svg className="w-3 h-3 text-success flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
              </button>
            ))}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => { setStep(1); setError(null) }}
              className="w-1/3 border border-dark-border rounded-lg py-3 text-white/60 hover:text-white text-sm font-medium transition-colors"
            >
              ← Back
            </button>
            <button type="submit" disabled={loading} className="flex-1 btn-primary">
              {loading ? 'Creating account…' : 'START FREE TRIAL'}
            </button>
          </div>

          <p className="text-white/30 text-xs text-center">
            No credit card required. Cancel anytime.
          </p>
        </form>
      )}
    </div>
  )
}
