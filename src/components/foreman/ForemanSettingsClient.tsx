'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface BusinessHoursDay {
  open:   string
  close:  string
  closed: boolean
}

type BusinessHours = Partial<Record<string, BusinessHoursDay>>

const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  Mon: { open: '08:00', close: '17:00', closed: false },
  Tue: { open: '08:00', close: '17:00', closed: false },
  Wed: { open: '08:00', close: '17:00', closed: false },
  Thu: { open: '08:00', close: '17:00', closed: false },
  Fri: { open: '08:00', close: '17:00', closed: false },
  Sat: { open: '09:00', close: '14:00', closed: false },
  Sun: { open: '00:00', close: '00:00', closed: true  },
}

interface ForemanSettings {
  is_enabled?:               boolean
  phone_number?:             string | null
  business_name?:            string | null
  mechanic_first_name?:      string | null
  mechanic_phone?:           string | null
  working_hours_start?:      string
  working_hours_end?:        string
  working_days?:             string[]
  after_hours_message?:      string | null
  auto_job_activation?:      boolean | null
  auto_hours_activation?:    boolean | null
  business_hours?:           BusinessHours | null
  foreman_activated_reason?: string | null
}

interface Props {
  foremanActive:   boolean
  businessName:    string
  businessType?:   string
  initialSettings: ForemanSettings | null
  canceledFlow?:   boolean
  capAvailable:    boolean
  userEmail?:      string
}

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function ForemanSettingsClient({
  foremanActive,
  businessName,
  initialSettings,
  canceledFlow,
  capAvailable,
  userEmail = '',
}: Props) {
  const router = useRouter()

  // ── Checkout flow ─────────────────────────────────────────────────────────
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutError,   setCheckoutError]   = useState<string | null>(null)

  async function startCheckout() {
    setCheckoutLoading(true)
    setCheckoutError(null)
    try {
      const res  = await fetch('/api/stripe/foreman/checkout', { method: 'POST' })
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      window.location.href = json.url
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : 'Checkout failed. Please try again.')
      setCheckoutLoading(false)
    }
  }

  // ── Waitlist flow ─────────────────────────────────────────────────────────
  const [showWaitlist,      setShowWaitlist]      = useState(false)
  const [waitlistEmail,     setWaitlistEmail]     = useState(userEmail)
  const [waitlistName,      setWaitlistName]      = useState('')
  const [waitlistBusiness,  setWaitlistBusiness]  = useState(businessName ?? '')
  const [waitlistNotes,     setWaitlistNotes]     = useState('')
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false)
  const [waitlistSuccess,   setWaitlistSuccess]   = useState(false)
  const [waitlistPosition,  setWaitlistPosition]  = useState<number | null>(null)
  const [waitlistError,     setWaitlistError]     = useState<string | null>(null)

  async function joinWaitlist() {
    if (!waitlistEmail) { setWaitlistError('Email is required.'); return }
    setWaitlistSubmitting(true)
    setWaitlistError(null)
    try {
      const res = await fetch('/api/foreman/waitlist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email:         waitlistEmail,
          mechanic_name: waitlistName || undefined,
          business_name: waitlistBusiness || undefined,
          notes:         waitlistNotes || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to join waitlist.')
      setWaitlistSuccess(true)
      setWaitlistPosition(json.position ?? null)
    } catch (e) {
      setWaitlistError(e instanceof Error ? e.message : 'Failed to join waitlist.')
    } finally {
      setWaitlistSubmitting(false)
    }
  }

  // ── Settings form state ───────────────────────────────────────────────────
  const [isEnabled,          setIsEnabled]         = useState(initialSettings?.is_enabled          ?? false)
  const [bName,              setBName]              = useState(initialSettings?.business_name       ?? businessName ?? '')
  const [mechName,           setMechName]           = useState(initialSettings?.mechanic_first_name ?? '')
  const [mechPhone,          setMechPhone]          = useState(initialSettings?.mechanic_phone      ?? '')
  const [hoursStart,         setHoursStart]         = useState(initialSettings?.working_hours_start ?? '08:00')
  const [hoursEnd,           setHoursEnd]           = useState(initialSettings?.working_hours_end   ?? '18:00')
  const [workingDays,        setWorkingDays]        = useState<string[]>(initialSettings?.working_days ?? ['Mon','Tue','Wed','Thu','Fri'])
  const [afterHoursMessage,  setAfterHoursMessage]  = useState(initialSettings?.after_hours_message ?? 'Sorry we missed you — please call back during business hours.')
  const [autoJobActivation,  setAutoJobActivation]  = useState(initialSettings?.auto_job_activation  ?? false)
  const [autoHoursActivation,setAutoHoursActivation]= useState(initialSettings?.auto_hours_activation ?? false)
  const [businessHours,      setBusinessHours]      = useState<BusinessHours>(
    (initialSettings?.business_hours && Object.keys(initialSettings.business_hours).length > 0)
      ? initialSettings.business_hours as BusinessHours
      : DEFAULT_BUSINESS_HOURS
  )

  const [saving,       setSaving]       = useState(false)
  const [saveSuccess,  setSaveSuccess]  = useState(false)
  const [saveError,    setSaveError]    = useState<string | null>(null)

  function toggleDay(day: string) {
    setWorkingDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    )
  }

  function updateBizHours(day: string, field: keyof BusinessHoursDay, value: string | boolean) {
    setBusinessHours(prev => ({
      ...prev,
      [day]: { ...(prev[day] ?? { open: '08:00', close: '17:00', closed: false }), [field]: value },
    }))
  }

  async function handleSave() {
    setSaving(true)
    setSaveSuccess(false)
    setSaveError(null)
    try {
      const res = await fetch('/api/foreman/settings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_enabled:            isEnabled,
          business_name:         bName,
          mechanic_first_name:   mechName,
          mechanic_phone:        mechPhone,
          working_hours_start:   hoursStart,
          working_hours_end:     hoursEnd,
          working_days:          workingDays,
          after_hours_message:   afterHoursMessage,
          auto_job_activation:   autoJobActivation,
          auto_hours_activation: autoHoursActivation,
          business_hours:        businessHours,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
      router.refresh()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const PhoneIcon = () => (
    <svg className="w-6 h-6 text-orange" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
  )

  const CheckIcon = () => (
    <svg className="w-4 h-4 text-orange flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )

  const features = [
    'Answers calls instantly — even when you\'re elbows-deep in an engine',
    'Books jobs directly into your NWI Scheduler — no manual entry',
    'Texts customers confirmation and on-my-way alerts automatically',
  ]

  // ── Waitlist modal ────────────────────────────────────────────────────────
  if (showWaitlist && !foremanActive) {
    return (
      <div className="space-y-6">
        <div className="nwi-card border-orange/20">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-orange/15 border border-orange/30 flex items-center justify-center flex-shrink-0">
              <PhoneIcon />
            </div>
            <div>
              <h2 className="font-condensed font-bold text-2xl text-white tracking-wide">Join the Foreman Waitlist</h2>
              <p className="text-white/40 text-xs mt-0.5">We&apos;ll email you the moment a spot opens up</p>
            </div>
          </div>

          {waitlistSuccess ? (
            <div className="text-center py-6 space-y-3">
              <div className="w-14 h-14 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center mx-auto">
                <svg className="w-7 h-7 text-green-400" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className="text-white font-medium">You&apos;re on the list!</p>
              <p className="text-white/50 text-sm">
                {waitlistPosition ? `You're #${waitlistPosition} in line. ` : ''}We&apos;ll email you when a Foreman slot opens up.
              </p>
              <button
                onClick={() => setShowWaitlist(false)}
                className="text-white/30 hover:text-white text-sm transition-colors"
              >
                ← Back
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="nwi-label">Email Address *</label>
                <input
                  className="nwi-input"
                  type="email"
                  value={waitlistEmail}
                  onChange={e => setWaitlistEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="nwi-label">Your First Name</label>
                <input
                  className="nwi-input"
                  type="text"
                  value={waitlistName}
                  onChange={e => setWaitlistName(e.target.value)}
                  placeholder="e.g. Charlotte"
                />
              </div>
              <div>
                <label className="nwi-label">Business Name</label>
                <input
                  className="nwi-input"
                  type="text"
                  value={waitlistBusiness}
                  onChange={e => setWaitlistBusiness(e.target.value)}
                  placeholder="Your shop name"
                />
              </div>
              <div>
                <label className="nwi-label">Anything else? (optional)</label>
                <textarea
                  className="nwi-input resize-none"
                  rows={2}
                  value={waitlistNotes}
                  onChange={e => setWaitlistNotes(e.target.value)}
                  placeholder="How many calls do you miss per week?"
                />
              </div>
              {waitlistError && <p className="text-danger text-xs">{waitlistError}</p>}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={joinWaitlist}
                  disabled={waitlistSubmitting}
                  className="flex-1 px-6 py-3 bg-orange hover:bg-orange-hover disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-xl transition-colors active:scale-95 min-h-[48px]"
                >
                  {waitlistSubmitting ? 'Joining…' : 'Join Waitlist'}
                </button>
                <button
                  onClick={() => setShowWaitlist(false)}
                  className="px-4 py-3 border border-dark-border hover:border-white/20 text-white/40 hover:text-white text-sm rounded-xl transition-colors min-h-[48px]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Upgrade card ──────────────────────────────────────────────────────────
  if (!foremanActive) {
    return (
      <div className="space-y-6">
        {canceledFlow && (
          <div className="nwi-card border-white/10 bg-white/3">
            <p className="text-white/50 text-sm">Checkout canceled — no charges were made.</p>
          </div>
        )}

        {!capAvailable && (
          <div className="nwi-card border-yellow-500/30 bg-yellow-500/5">
            <p className="text-yellow-400 text-sm font-medium">Foreman is at capacity for this launch period.</p>
            <p className="text-white/40 text-xs mt-1">Join the waitlist below and we&apos;ll notify you the moment a spot opens up.</p>
          </div>
        )}

        <div className="nwi-card border-orange/30 bg-orange/5">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-12 h-12 rounded-xl bg-orange/15 border border-orange/30 flex items-center justify-center flex-shrink-0">
              <PhoneIcon />
            </div>
            <div>
              <h2 className="font-condensed font-bold text-2xl text-white tracking-wide leading-tight">
                Add Foreman — Your AI Receptionist
              </h2>
              <p className="text-white/50 text-sm mt-1">
                Never miss another job while you&apos;re under a hood.
              </p>
            </div>
          </div>

          <div className="space-y-3 mb-6">
            {features.map((text, i) => (
              <div key={i} className="flex items-start gap-3">
                <CheckIcon />
                <p className="text-white/70 text-sm leading-relaxed">{text}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-4 pt-4 border-t border-dark-border">
            <div>
              <p className="font-condensed font-bold text-3xl text-orange">$59<span className="text-white/40 text-base font-normal">/month</span></p>
              <p className="text-white/30 text-xs mt-0.5">Add to any existing NWI plan</p>
            </div>
            {capAvailable ? (
              <button
                onClick={startCheckout}
                disabled={checkoutLoading}
                className="px-6 py-3 bg-orange hover:bg-orange-hover disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-xl transition-colors active:scale-95 min-h-[48px] whitespace-nowrap"
              >
                {checkoutLoading ? 'Opening checkout…' : 'Add Foreman to My Plan'}
              </button>
            ) : (
              <button
                onClick={() => setShowWaitlist(true)}
                className="px-6 py-3 border border-orange/50 hover:border-orange text-orange font-condensed font-bold text-sm rounded-xl transition-colors active:scale-95 min-h-[48px] whitespace-nowrap"
              >
                Join Foreman Waitlist
              </button>
            )}
          </div>

          {checkoutError && (
            <p className="text-danger text-xs mt-3">{checkoutError}</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Calls answered', value: '24/7', sub: 'Even at 2am' },
            { label: 'Time saved/week', value: '~3 hrs', sub: 'No more tag' },
            { label: 'Setup time', value: '30 sec', sub: 'We handle the rest' },
          ].map(card => (
            <div key={card.label} className="nwi-card border-white/10 text-center py-5">
              <p className="font-condensed font-bold text-2xl text-orange">{card.value}</p>
              <p className="text-white/80 text-xs font-medium mt-0.5">{card.label}</p>
              <p className="text-white/30 text-xs mt-0.5">{card.sub}</p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Config form ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Enable / Disable toggle card */}
      <div className="nwi-card">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-white font-medium text-sm">Foreman Status</p>
            <p className="text-white/40 text-xs mt-0.5">
              {isEnabled
                ? 'Foreman is ON — answering calls'
                : 'Foreman is OFF — calls go to you directly'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsEnabled(v => !v)}
            aria-label={isEnabled ? 'Disable Foreman' : 'Enable Foreman'}
            className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
              isEnabled ? 'bg-orange' : 'bg-dark-border'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                isEnabled ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Phone number (read-only — provisioned in Session 2) */}
      <div className="nwi-card border-white/10">
        <p className="text-white/40 text-xs uppercase tracking-widest mb-2">Foreman Phone Number</p>
        <div className="flex items-center gap-3 py-3 px-4 rounded-lg bg-dark-lighter border border-dark-border">
          <svg className="w-4 h-4 text-white/30 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
          <p className="text-white/40 text-sm italic">
            {initialSettings?.phone_number ?? 'Number provisioned shortly — finish setup below and check back.'}
          </p>
        </div>
      </div>

      {/* Core identity fields */}
      <div className="nwi-card space-y-5">
        <p className="text-white/40 text-xs uppercase tracking-widest">Identity</p>

        <div>
          <label className="nwi-label">Business Name</label>
          <input
            className="nwi-input"
            type="text"
            value={bName}
            onChange={e => setBName(e.target.value)}
            placeholder="Green Valley Lawn Care"
          />
          <p className="text-white/30 text-xs mt-1">What Foreman says when answering: &ldquo;Thank you for calling [Business Name]…&rdquo;</p>
        </div>

        <div>
          <label className="nwi-label">Your First Name</label>
          <input
            className="nwi-input"
            type="text"
            value={mechName}
            onChange={e => setMechName(e.target.value)}
            placeholder="e.g. Brock"
          />
          <p className="text-white/30 text-xs mt-1">Foreman uses this to personalize conversations with callers.</p>
        </div>

        <div>
          <label className="nwi-label">Your Contact Phone (for SMS alerts)</label>
          <input
            className="nwi-input"
            type="tel"
            value={mechPhone}
            onChange={e => setMechPhone(e.target.value)}
            placeholder="(555) 000-0000"
          />
          <p className="text-white/30 text-xs mt-1">Foreman texts you here after every call with a summary.</p>
        </div>
      </div>

      {/* Availability */}
      <div className="nwi-card space-y-5">
        <p className="text-white/40 text-xs uppercase tracking-widest">Availability</p>

        <div>
          <label className="nwi-label mb-3 block">Working Days</label>
          <div className="flex flex-wrap gap-2">
            {ALL_DAYS.map(day => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors active:scale-95 min-h-[44px] min-w-[52px] ${
                  workingDays.includes(day)
                    ? 'border-orange/60 bg-orange/15 text-orange'
                    : 'border-dark-border text-white/40 hover:border-white/20 hover:text-white/70'
                }`}
              >
                {day}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="nwi-label">Hours Start</label>
            <input
              className="nwi-input"
              type="time"
              value={hoursStart}
              onChange={e => setHoursStart(e.target.value)}
            />
          </div>
          <div>
            <label className="nwi-label">Hours End</label>
            <input
              className="nwi-input"
              type="time"
              value={hoursEnd}
              onChange={e => setHoursEnd(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* After-hours message */}
      <div className="nwi-card space-y-3">
        <p className="text-white/40 text-xs uppercase tracking-widest">After-Hours Message</p>
        <textarea
          className="nwi-input min-h-[96px] resize-none"
          value={afterHoursMessage}
          onChange={e => setAfterHoursMessage(e.target.value)}
          rows={3}
          placeholder="Sorry we missed you — please call back during business hours."
        />
        <p className="text-white/30 text-xs">Foreman reads this message to callers outside your working hours.</p>
      </div>

      {/* ── Automation section ── */}
      <div className="nwi-card space-y-1">
        <p className="text-white/40 text-xs uppercase tracking-widest mb-4">Automation</p>
        <p className="text-white/30 text-xs mb-5">Both toggles default to OFF. You stay in full control — opt in only if you want automatic coverage.</p>

        {/* Toggle 1 — On The Job Coverage */}
        <div className="flex items-start justify-between gap-4 py-4 border-b border-dark-border">
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium">Auto-activate Foreman when I arrive at a job</p>
            <p className="text-white/40 text-xs mt-1 leading-relaxed">
              Foreman answers your calls automatically while you work. Deactivates when you complete the job.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAutoJobActivation(v => !v)}
            aria-label={autoJobActivation ? 'Disable on-job coverage' : 'Enable on-job coverage'}
            className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
              autoJobActivation ? 'bg-orange' : 'bg-dark-border'
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
              autoJobActivation ? 'translate-x-6' : 'translate-x-0'
            }`} />
          </button>
        </div>

        {/* Toggle 2 — After Hours Coverage */}
        <div className="flex items-start justify-between gap-4 py-4">
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium">Auto-activate Foreman outside my business hours</p>
            <p className="text-white/40 text-xs mt-1 leading-relaxed">
              Foreman answers automatically before you open and after you close so you never miss a booking.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAutoHoursActivation(v => !v)}
            aria-label={autoHoursActivation ? 'Disable after-hours coverage' : 'Enable after-hours coverage'}
            className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
              autoHoursActivation ? 'bg-orange' : 'bg-dark-border'
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
              autoHoursActivation ? 'translate-x-6' : 'translate-x-0'
            }`} />
          </button>
        </div>
      </div>

      {/* Business Hours Picker — shown when after-hours toggle is on */}
      {autoHoursActivation && (
        <div className="nwi-card space-y-4">
          <div>
            <p className="text-white/40 text-xs uppercase tracking-widest">Business Hours</p>
            <p className="text-white/30 text-xs mt-1">Foreman activates automatically outside these hours. Days marked Closed have Foreman active all day.</p>
          </div>
          <div className="space-y-3">
            {ALL_DAYS.map(day => {
              const cfg = businessHours[day] ?? { open: '08:00', close: '17:00', closed: false }
              return (
                <div key={day} className="flex items-center gap-3">
                  <span className="text-white/60 text-sm w-10 shrink-0">{day}</span>

                  {/* Closed toggle */}
                  <button
                    type="button"
                    onClick={() => updateBizHours(day, 'closed', !cfg.closed)}
                    className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors min-w-[60px] ${
                      cfg.closed
                        ? 'border-danger/50 bg-danger/15 text-danger'
                        : 'border-dark-border text-white/40 hover:border-white/20'
                    }`}
                  >
                    {cfg.closed ? 'Closed' : 'Open'}
                  </button>

                  {!cfg.closed && (
                    <>
                      <input
                        type="time"
                        value={cfg.open}
                        onChange={e => updateBizHours(day, 'open', e.target.value)}
                        className="nwi-input w-auto text-sm py-1.5 px-3"
                      />
                      <span className="text-white/30 text-xs">to</span>
                      <input
                        type="time"
                        value={cfg.close}
                        onChange={e => updateBizHours(day, 'close', e.target.value)}
                        className="nwi-input w-auto text-sm py-1.5 px-3"
                      />
                    </>
                  )}

                  {cfg.closed && (
                    <span className="text-white/25 text-xs">Foreman active all day</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Save */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-8 py-3 bg-orange hover:bg-orange-hover disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-xl transition-colors active:scale-95 min-h-[48px]"
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
        {saveSuccess && (
          <p className="text-success text-sm font-medium flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Saved
          </p>
        )}
        {saveError && <p className="text-danger text-sm">{saveError}</p>}
      </div>
    </div>
  )
}
