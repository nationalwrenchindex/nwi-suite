'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

const PLANS: { key: string; name: string; price: number; priceKey: string; badge?: string; features: string[] }[] = [
  {
    key:      'hd_reefer',
    name:     'Reefer Standalone',
    price:    79,
    priceKey: 'STRIPE_PRICE_HD_REEFER',
    features: ['HD QuickWrench', 'EPA 608 Refrigerant Log', 'PM Interval Calculator', 'Alarm Code Lookup'],
  },
  {
    key:      'starter',
    name:     'HD Starter',
    price:    149,
    priceKey: 'STRIPE_PRICE_HD_STARTER',
    features: ['Work Orders', 'Fleet Units', 'PM Checklist', 'Fleet Accounts', 'Scheduler'],
  },
  {
    key:      'pro',
    name:     'HD Pro',
    price:    249,
    priceKey: 'STRIPE_PRICE_HD_PRO',
    badge:    'Most Popular',
    features: ['Everything in HD Starter', 'HD QuickWrench', 'EPA 608 Log', 'DOT Inspections', 'Invoicing', 'Financials'],
  },
  {
    key:      'elite',
    name:     'HD Elite',
    price:    399,
    priceKey: 'STRIPE_PRICE_HD_ELITE',
    badge:    'All-In-One',
    features: ['Everything in HD Pro', 'Foreman AI Receptionist', 'Reefer Module', 'Community Knowledge Base'],
  },
]

export default function HDSignupPage() {
  const router  = useRouter()
  const [step,  setStep]  = useState<'plan' | 'account'>('plan')
  const [plan,  setPlan]  = useState<string>('pro')
  const [email, setEmail] = useState('')
  const [pass,  setPass]  = useState('')
  const [name,  setName]  = useState('')
  const [biz,   setBiz]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

      // Redirect to HD-specific Stripe checkout
      const res = await fetch('/api/hd/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ plan, userId: data.user.id }),
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
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Heavy Duty & Transport Refrigeration</p>
            </div>
          </div>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
            {step === 'plan' ? 'CHOOSE YOUR PLAN' : 'CREATE YOUR ACCOUNT'}
          </h1>
        </div>

        {step === 'plan' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {PLANS.map(p => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPlan(p.key)}
                  className="relative rounded-xl p-5 text-left transition-all"
                  style={{
                    background: plan === p.key ? `${HD_ORANGE}15` : '#111920',
                    border:     plan === p.key ? `2px solid ${HD_ORANGE}` : '2px solid #1e3040',
                  }}
                >
                  {p.badge && (
                    <span
                      className="absolute -top-2.5 left-4 text-xs font-bold px-2.5 py-0.5 rounded-full"
                      style={{ background: HD_ORANGE, color: '#fff' }}
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
                        <span className="flex-shrink-0 mt-0.5" style={{ color: plan === p.key ? HD_ORANGE : '#22C55E' }}>✓</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep('account')}
              className="w-full py-3 rounded-xl font-bold text-white text-sm"
              style={{ background: HD_ORANGE }}
            >
              Continue with {PLANS.find(p => p.key === plan)?.name} →
            </button>
            <p className="text-center text-xs mt-3" style={{ color: 'rgba(255,255,255,0.3)' }}>
              14-day free trial · Cancel anytime · No credit card required to start
            </p>
          </>
        )}

        {step === 'account' && (
          <form onSubmit={handleSignup} className="max-w-md mx-auto">
            <div className="rounded-xl p-6 space-y-4" style={{ background: '#111920', border: '1px solid #1e3040' }}>
              <div className="flex items-center justify-between">
                <p className="font-condensed font-bold text-white text-lg">Account Details</p>
                <div className="text-xs px-2 py-1 rounded-full" style={{ background: `${HD_ORANGE}25`, color: HD_ORANGE }}>
                  {PLANS.find(p => p.key === plan)?.name}
                </div>
              </div>

              {[
                { label: 'Full Name', value: name, setter: setName, type: 'text',     placeholder: 'John Smith'          },
                { label: 'Business Name', value: biz, setter: setBiz, type: 'text',   placeholder: 'Smith Refrigeration' },
                { label: 'Email', value: email, setter: setEmail, type: 'email',       placeholder: 'john@example.com'    },
                { label: 'Password', value: pass, setter: setPass, type: 'password',   placeholder: '8+ characters'        },
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

              {error && <p className="text-sm text-red-400">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl font-bold text-white text-sm"
                style={{ background: HD_ORANGE, opacity: loading ? 0.6 : 1 }}
              >
                {loading ? 'Creating Account…' : 'Start Free Trial'}
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
