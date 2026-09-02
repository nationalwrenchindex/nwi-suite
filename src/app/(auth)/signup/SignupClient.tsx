'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PLANS, SELECTABLE_MODULES, MODULE_LABELS, MODULE_DESCRIPTIONS } from '@/lib/stripe-plans'
import type { PlanTier, SelectableModule } from '@/lib/stripe-plans'
import { resolveLdSlug, ldSlugNeedsModulePick, describeSlugResolution } from '@/lib/plan-slugs'

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

function SignupForm({ foremanAvailable }: Props) {
  const router       = useRouter()
  const searchParams = useSearchParams()

  // ?plan=<slug> preselects the tier so the subscriber never picks it twice. Resolved
  // once on first render rather than in an effect, so step 2 never paints before being
  // skipped. An unknown slug resolves to null and the normal two-step flow runs.
  const rawSlug     = searchParams.get('plan')
  const presetTier  = resolveLdSlug(rawSlug)
  // Starter and Pro still need their module picker — see SLUG_REQUIRES_MODULE_PICK.
  // The plan is locked in those cases, but the step is still shown, because
  // /api/stripe/checkout 400s without exactly the right number of modules and the
  // account would already exist by then.
  const needsModules = ldSlugNeedsModulePick(presetTier)
  const [preselected] = useState<PlanTier | null>(presetTier)

  const [step, setStep]               = useState<1 | 2>(1)
  const [fullName, setFullName]       = useState('')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [confirmPwd, setConfirmPwd]   = useState('')
  const [profession, setProfession]   = useState<ProfessionType>('mobile_mechanic')
  const [plan, setPlan]               = useState<SignupPlan>(presetTier ?? 'starter')
  const [selectedModules, setSelectedModules]   = useState<SelectableModule[]>([])
  const [moduleWarningShown, setModuleWarningShown] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [success, setSuccess]         = useState(false)

  function handlePlanSelect(tier: SignupPlan) {
    setPlan(tier)
    setSelectedModules([])
    setModuleWarningShown(false)
  }

  function handleModuleToggle(mod: SelectableModule) {
    setModuleWarningShown(false)
    if (plan === 'starter') {
      setSelectedModules([mod])
    } else {
      setSelectedModules(prev =>
        prev.includes(mod)
          ? prev.filter(m => m !== mod)
          : prev.length < 2 ? [...prev, mod] : prev
      )
    }
  }

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

    // Preselected and nothing left to ask -> straight to account creation and checkout.
    // Starter and Pro fall through to step 2 because their modules are still unanswered;
    // that step renders with the plan locked, so the tier is still only chosen once.
    if (preselected && !needsModules) {
      void runSignup()
      return
    }
    setStep(2)
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    await runSignup()
  }

  async function runSignup() {
    setLoading(true)
    setError(null)

    console.log('[handleSignup] plan:', plan, '| selectedModules:', selectedModules)
    console.log(describeSlugResolution('ld', rawSlug, preselected))

    if (plan === 'starter' && selectedModules.length === 0) {
      setModuleWarningShown(true)
      setLoading(false)
      return
    }
    if (plan === 'pro' && selectedModules.length < 2) {
      setModuleWarningShown(true)
      setLoading(false)
      return
    }

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
            body:    JSON.stringify({ tier: plan, selectedModules, source: 'signup' }),
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
          <span className="text-orange">Billing</span> to get started.
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

      {/* Step indicator. Hidden entirely when a slug preselected a plan that needs no
          module picks — there is only one step left, and a "1 of 2" that never reaches
          2 reads as an interrupted flow. */}
      <div className={`flex items-center gap-2 mb-7 ${preselected && !needsModules ? 'hidden' : ''}`}>
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
              {s === 1 ? 'Your Info' : needsModules ? 'Pick Modules' : 'Choose Plan'}
            </span>
            {s < 2 && <div className="w-8 h-px bg-dark-border mx-1" />}
          </div>
        ))}
      </div>

      {/* Confirms which plan the link chose, so the subscriber can see it before paying
          and is not surprised at the Stripe page. */}
      {preselected && (
        <div className="mb-5 rounded-lg border border-orange/30 bg-orange/5 px-4 py-3">
          <p className="text-xs uppercase tracking-wider text-white/40 mb-0.5">Selected plan</p>
          <p className="text-white font-medium text-sm">
            {PLANS.find(p => p.tier === preselected)?.name ?? preselected}
            {(() => {
              const price = PLANS.find(p => p.tier === preselected)?.price
              return typeof price === 'number' ? ` — $${(price / 100).toFixed(0)}/mo` : ''
            })()}
          </p>
        </div>
      )}

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
            {preselected
              ? (needsModules ? 'NEXT — PICK YOUR MODULES' : 'CREATE ACCOUNT & CONTINUE TO PAYMENT')
              : 'NEXT — CHOOSE PLAN'}
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
            if (!planData) return null
            return (
              <p className="text-white/50 text-xs uppercase tracking-widest mb-4">
                No setup fee · No contracts · Cancel anytime
              </p>
            )
          })()}

          <div className="space-y-3 mb-5">

            {/* ── Main tier cards: Starter, Pro, Full Suite, Full Suite Plus, Elite ──
                Suppressed when a slug already chose the plan. The subscriber reached
                this step only because their tier still needs module picks; re-showing
                every tier would be asking them to choose the plan a second time, which
                is the whole thing preselection exists to avoid. The chosen plan is
                confirmed in the banner above. */}
            {!preselected && PLANS.filter(p => p.tier !== 'foreman_standalone' && p.tier !== 'quickwrench').map((p) => {
              const isSelected = plan === p.tier
              const isElite    = p.tier === 'elite'
              const dollars    = (p.price / 100).toFixed(0)

              return (
                <button
                  key={p.tier}
                  type="button"
                  onClick={() => handlePlanSelect(p.tier)}
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
                    ${dollars}/mo
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

            {/* ── Module picker for Starter / Pro ── */}
            {(plan === 'starter' || plan === 'pro') && (
              <div className="rounded-xl border border-orange/30 bg-dark-card p-4">
                <p className="text-xs font-semibold text-white/70 uppercase tracking-widest mb-1">
                  {plan === 'starter' ? 'Choose your 1 module' : 'Choose your 2 modules'}
                </p>
                <p className="text-[11px] text-white/40 mb-3">
                  {plan === 'starter'
                    ? 'Pick the tool that fits your workflow.'
                    : 'Pick any two — you can always upgrade later.'}
                </p>
                <div className="space-y-2">
                  {SELECTABLE_MODULES.map((mod) => {
                    const isSelected = selectedModules.includes(mod)
                    const isDisabled = !isSelected && plan === 'pro' && selectedModules.length >= 2
                    return (
                      <button
                        key={mod}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => handleModuleToggle(mod)}
                        className={`w-full rounded-lg border p-3 text-left transition-all relative ${
                          isSelected
                            ? 'border-orange bg-orange/8'
                            : isDisabled
                            ? 'border-dark-border bg-dark-card opacity-40 cursor-not-allowed'
                            : 'border-dark-border bg-dark-card hover:border-white/30'
                        }`}
                      >
                        <div className="flex items-center justify-between pr-2">
                          <span className="font-semibold text-sm text-white">{MODULE_LABELS[mod]}</span>
                          {isSelected && (
                            <div className="w-4 h-4 rounded-full bg-orange flex items-center justify-center flex-shrink-0">
                              <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </div>
                          )}
                        </div>
                        <p className="text-[11px] text-white/40 mt-0.5 leading-snug">
                          {MODULE_DESCRIPTIONS[mod]}
                        </p>
                      </button>
                    )
                  })}
                </div>
                {moduleWarningShown && (
                  <p className="text-red-400 text-xs mt-3">
                    {plan === 'starter'
                      ? 'Please select a module to continue.'
                      : 'Please select 2 modules to continue.'}
                  </p>
                )}
              </div>
            )}

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
                onClick={() => handlePlanSelect('foreman')}
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
                    onClick={() => handlePlanSelect('quickwrench')}
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
                : 'START TODAY →'}
            </button>
          </div>

          <p className="text-white/30 text-xs text-center mt-3">
            {plan === 'foreman'
              ? '$59/mo · No NWI tier required · Cancel anytime.'
              : plan === 'quickwrench'
              ? '$69/mo · No NWI tier required · Cancel anytime.'
              : 'No setup fee. Cancel anytime.'}
          </p>
        </form>
      )}
    </div>
  )
}

// useSearchParams() puts the subtree into client-side rendering and Next refuses to
// build a page that reads it without a Suspense boundary. Same split /hd/signup and
// (auth)/login already use. fallback={null} because the boundary resolves in the same
// tick on the client — a skeleton here would only flicker.
export default function SignupClient(props: Props) {
  return (
    <Suspense fallback={null}>
      <SignupForm {...props} />
    </Suspense>
  )
}
