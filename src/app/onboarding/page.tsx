'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// ── Types ──────────────────────────────────────────────────

type DayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'

interface DaySchedule {
  enabled: boolean
  open: string
  close: string
}

type WorkingHours = Record<DayKey, DaySchedule>

const DAYS: { key: DayKey; label: string; short: string }[] = [
  { key: 'monday',    label: 'Monday',    short: 'Mon' },
  { key: 'tuesday',   label: 'Tuesday',   short: 'Tue' },
  { key: 'wednesday', label: 'Wednesday', short: 'Wed' },
  { key: 'thursday',  label: 'Thursday',  short: 'Thu' },
  { key: 'friday',    label: 'Friday',    short: 'Fri' },
  { key: 'saturday',  label: 'Saturday',  short: 'Sat' },
  { key: 'sunday',    label: 'Sunday',    short: 'Sun' },
]

const DEFAULT_HOURS: WorkingHours = {
  monday:    { enabled: true,  open: '08:00', close: '17:00' },
  tuesday:   { enabled: true,  open: '08:00', close: '17:00' },
  wednesday: { enabled: true,  open: '08:00', close: '17:00' },
  thursday:  { enabled: true,  open: '08:00', close: '17:00' },
  friday:    { enabled: true,  open: '08:00', close: '17:00' },
  saturday:  { enabled: false, open: '09:00', close: '14:00' },
  sunday:    { enabled: false, open: '09:00', close: '14:00' },
}

// ── Step progress indicator ────────────────────────────────

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => i + 1).map((s) => (
        <div key={s} className="flex items-center gap-2">
          <div
            className={`rounded-full transition-all duration-300 ${
              s < current
                ? 'w-6 h-6 bg-success flex items-center justify-center'
                : s === current
                ? 'w-6 h-6 bg-orange flex items-center justify-center'
                : 'w-5 h-5 bg-dark-border'
            }`}
          >
            {s < current && (
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
            {s === current && (
              <span className="text-white text-[10px] font-bold">{s}</span>
            )}
          </div>
          {s < total && (
            <div className={`h-0.5 w-8 transition-colors ${s < current ? 'bg-success' : 'bg-dark-border'}`} />
          )}
        </div>
      ))}
      <span className="ml-2 text-white/40 text-xs">Step {current} of {total}</span>
    </div>
  )
}

// ── Toggle switch ──────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex w-10 h-5 rounded-full transition-colors focus:outline-none ${
        checked ? 'bg-orange' : 'bg-dark-border'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

// ── Main page ──────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()

  const [step, setStep] = useState(1)

  // Step 1 — Business info
  const [businessName, setBusinessName] = useState('')
  const [phone, setPhone]               = useState('')
  const [slug, setSlug]                 = useState('')
  const [slugEdited, setSlugEdited]     = useState(false)

  // Step 2 — Service area
  const [serviceArea, setServiceArea]   = useState('')
  const [radius, setRadius]             = useState('30')

  // Step 3 — Working hours
  const [hours, setHours] = useState<WorkingHours>(DEFAULT_HOURS)

  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  // Immediately provision the subscription when arriving from Stripe checkout.
  // This ensures module access is available before the webhook fires.
  useEffect(() => {
    const params    = new URLSearchParams(window.location.search)
    const sessionId = params.get('session_id')
    if (!sessionId) return
    fetch('/api/stripe/provision-session', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ session_id: sessionId }),
    }).catch(() => {})
  }, [])

  // ── Helpers ──

  function slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  }

  function handleBusinessNameChange(val: string) {
    setBusinessName(val)
    if (!slugEdited) setSlug(slugify(val))
  }

  function updateDay(day: DayKey, field: keyof DaySchedule, value: string | boolean) {
    setHours((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }))
  }

  function validateStep(s: number) {
    if (s === 1 && !businessName.trim()) return 'Please enter your business name.'
    if (s === 2 && !serviceArea.trim()) return 'Please describe your service area.'
    return null
  }

  function next() {
    const err = validateStep(step)
    if (err) { setError(err); return }
    setError(null)
    setStep((s) => s + 1)
  }

  // ── Submit ──

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      router.push('/login')
      return
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        business_name:            businessName.trim(),
        phone:                    phone.trim() || null,
        service_area_description: serviceArea.trim(),
        service_area_radius_miles: parseFloat(radius) || null,
        working_hours:            hours,
        slug:                     slug.trim() || null,
      })
      .eq('id', user.id)

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/dashboard')
  }

  // ── Render ──

  return (
    <div className="min-h-dvh bg-dark flex items-start justify-center p-6 sm:p-10">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center gap-3 mb-10">
          <div className="w-9 h-9 bg-orange rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          </div>
          <div>
            <p className="font-condensed font-bold text-white text-base tracking-widest">NATIONAL WRENCH INDEX</p>
            <p className="text-white/40 text-xs">Let&apos;s set up your account</p>
          </div>
        </div>

        <StepDots current={step} total={3} />

        {error && <div className="alert-error mb-5">{error}</div>}

        {/* ── Step 1: Business info ── */}
        {step === 1 && (
          <div>
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide mb-1">
              YOUR BUSINESS
            </h1>
            <p className="text-white/50 text-sm mb-7">
              This is how customers and invoices will identify you.
            </p>

            <div className="space-y-5">
              <div>
                <label htmlFor="businessName" className="nwi-label">Business name <span className="text-danger">*</span></label>
                <input
                  id="businessName"
                  type="text"
                  required
                  value={businessName}
                  onChange={(e) => handleBusinessNameChange(e.target.value)}
                  placeholder="Marcus Mobile Mechanics LLC"
                  className="nwi-input"
                />
              </div>

              <div>
                <label htmlFor="slug" className="nwi-label">Your booking link</label>
                <div className="flex items-center rounded-lg border border-dark-border bg-dark-input overflow-hidden focus-within:border-orange transition-colors">
                  <span className="px-3 text-white/30 text-sm select-none whitespace-nowrap border-r border-dark-border py-3">
                    /book/
                  </span>
                  <input
                    id="slug"
                    type="text"
                    value={slug}
                    onChange={(e) => {
                      setSlugEdited(true)
                      setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40))
                    }}
                    placeholder="marcus-mobile-mechanics"
                    className="flex-1 bg-transparent px-3 py-3 text-white text-sm placeholder-white/20 focus:outline-none"
                  />
                </div>
                {slug && (
                  <p className="text-white/30 text-xs mt-1.5">
                    Customers can book at: <span className="text-white/50">nationalwrenchindex.com/book/{slug}</span>
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="phone" className="nwi-label">Business phone <span className="text-white/30">(optional)</span></label>
                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 867-5309"
                  className="nwi-input"
                />
              </div>
            </div>

            <button onClick={next} className="btn-primary mt-8">
              NEXT — SERVICE AREA
            </button>
          </div>
        )}

        {/* ── Step 2: Service area ── */}
        {step === 2 && (
          <div>
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide mb-1">
              SERVICE AREA
            </h1>
            <p className="text-white/50 text-sm mb-7">
              Where do you typically take jobs? Customers will see this on your profile.
            </p>

            <div className="space-y-5">
              <div>
                <label htmlFor="serviceArea" className="nwi-label">Coverage description <span className="text-danger">*</span></label>
                <input
                  id="serviceArea"
                  type="text"
                  required
                  value={serviceArea}
                  onChange={(e) => setServiceArea(e.target.value)}
                  placeholder="Dallas, TX and surrounding cities"
                  className="nwi-input"
                />
                <p className="text-white/30 text-xs mt-1.5">e.g. &ldquo;Houston metro area&rdquo; or &ldquo;Phoenix, Scottsdale, Tempe&rdquo;</p>
              </div>

              <div>
                <label htmlFor="radius" className="nwi-label">Travel radius (miles)</label>
                <div className="flex items-center gap-4">
                  <input
                    id="radius"
                    type="range"
                    min="5"
                    max="100"
                    step="5"
                    value={radius}
                    onChange={(e) => setRadius(e.target.value)}
                    className="flex-1 accent-orange"
                  />
                  <div className="w-20 nwi-input text-center py-2 font-condensed font-bold text-orange text-lg">
                    {radius} mi
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => { setStep(1); setError(null) }}
                className="w-1/3 border border-dark-border rounded-lg py-3 text-white/60 hover:text-white text-sm font-medium transition-colors"
              >
                ← Back
              </button>
              <button onClick={next} className="flex-1 btn-primary">
                NEXT — WORKING HOURS
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Working hours ── */}
        {step === 3 && (
          <form onSubmit={handleSubmit}>
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide mb-1">
              WORKING HOURS
            </h1>
            <p className="text-white/50 text-sm mb-7">
              Set the days and times you&apos;re available for jobs.
            </p>

            <div className="space-y-2">
              {DAYS.map(({ key, label }) => {
                const day = hours[key]
                return (
                  <div
                    key={key}
                    className={`rounded-xl border px-4 py-3 transition-colors ${
                      day.enabled ? 'border-dark-border bg-dark-card' : 'border-dark-border/50 bg-dark opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      {/* Toggle */}
                      <Toggle
                        checked={day.enabled}
                        onChange={(v) => updateDay(key, 'enabled', v)}
                      />

                      {/* Day label */}
                      <span className={`w-24 text-sm font-medium ${day.enabled ? 'text-white' : 'text-white/40'}`}>
                        {label}
                      </span>

                      {/* Time range */}
                      {day.enabled ? (
                        <div className="flex items-center gap-2 ml-auto">
                          <input
                            type="time"
                            value={day.open}
                            onChange={(e) => updateDay(key, 'open', e.target.value)}
                            className="bg-dark-input border border-dark-border rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-orange"
                          />
                          <span className="text-white/30 text-xs">to</span>
                          <input
                            type="time"
                            value={day.close}
                            onChange={(e) => updateDay(key, 'close', e.target.value)}
                            className="bg-dark-input border border-dark-border rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-orange"
                          />
                        </div>
                      ) : (
                        <span className="ml-auto text-white/30 text-xs">Closed</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex gap-3 mt-8">
              <button
                type="button"
                onClick={() => { setStep(2); setError(null) }}
                className="w-1/3 border border-dark-border rounded-lg py-3 text-white/60 hover:text-white text-sm font-medium transition-colors"
              >
                ← Back
              </button>
              <button type="submit" disabled={loading} className="flex-1 btn-primary">
                {loading ? 'Saving…' : 'LAUNCH MY DASHBOARD →'}
              </button>
            </div>

            <p className="text-white/25 text-xs text-center mt-4">
              You can update all of this anytime from your profile settings.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
