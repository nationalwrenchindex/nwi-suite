'use client'

import { useState } from 'react'
import Link from 'next/link'

interface TorqueWrenchSettings {
  is_enabled?:               boolean
  google_place_id?:          string | null
  google_review_url?:        string | null
  business_name_override?:   string | null
  send_delay_minutes?:       number | null
  service_recovery_enabled?: boolean
  service_recovery_phone?:   string | null
}

interface Props {
  torquewrenchActive: boolean
  businessName:       string
  initialSettings:    TorqueWrenchSettings | null
}

export default function TorqueWrenchSettingsClient({
  torquewrenchActive,
  businessName,
  initialSettings,
}: Props) {
  const [isEnabled,           setIsEnabled]           = useState(initialSettings?.is_enabled           ?? true)
  const [googlePlaceId,       setGooglePlaceId]       = useState(initialSettings?.google_place_id      ?? '')
  const [businessNameOverride,setBusinessNameOverride] = useState(initialSettings?.business_name_override ?? '')
  const [sendDelayMinutes,    setSendDelayMinutes]    = useState(initialSettings?.send_delay_minutes    ?? 10)
  const [recoveryEnabled,     setRecoveryEnabled]     = useState(initialSettings?.service_recovery_enabled ?? true)
  const [recoveryPhone,       setRecoveryPhone]       = useState(initialSettings?.service_recovery_phone   ?? '')

  const [saving,      setSaving]      = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError,   setSaveError]   = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setSaveSuccess(false)
    setSaveError(null)
    try {
      const res = await fetch('/api/torquewrench/settings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          is_enabled:               isEnabled,
          google_place_id:          googlePlaceId.trim() || null,
          business_name_override:   businessNameOverride.trim() || null,
          send_delay_minutes:       sendDelayMinutes,
          service_recovery_enabled: recoveryEnabled,
          service_recovery_phone:   recoveryPhone.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Upgrade card ──────────────────────────────────────────────────────────
  if (!torquewrenchActive) {
    return (
      <div className="space-y-6">
        <div className="nwi-card border-orange/30 bg-orange/5">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-12 h-12 rounded-xl bg-orange/15 border border-orange/30 flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-orange" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
            </div>
            <div>
              <h2 className="font-condensed font-bold text-2xl text-white tracking-wide leading-tight">
                TorqueWrench — Automatic Google Reviews
              </h2>
              <p className="text-white/50 text-sm mt-1">
                Collect 5-star reviews while your hands are still dirty.
              </p>
            </div>
          </div>

          <div className="space-y-3 mb-6">
            {[
              'Texts customers a Google review link minutes after the job closes',
              'Service recovery alert if they rate 3 stars or lower — catch problems before they go public',
              'Dashboard tracks every request, click, and review left',
            ].map((text, i) => (
              <div key={i} className="flex items-start gap-3">
                <svg className="w-4 h-4 text-orange flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <p className="text-white/70 text-sm leading-relaxed">{text}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-4 pt-4 border-t border-dark-border">
            <div>
              <p className="font-condensed font-bold text-lg text-white/80">
                Included with Full Suite, QuickWrench &amp; Elite
              </p>
              <p className="text-white/30 text-xs mt-0.5">Upgrade your plan to unlock</p>
            </div>
            <Link
              href="/billing"
              className="px-6 py-3 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm rounded-xl transition-colors active:scale-95 min-h-[48px] flex items-center whitespace-nowrap"
            >
              Upgrade Plan
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'More reviews',    value: '3×',     sub: 'vs asking manually' },
            { label: 'Send delay',      value: '10 min', sub: 'After job closes' },
            { label: 'Setup time',      value: '2 min',  sub: 'Just add Place ID' },
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

  // ── Settings form ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Enable toggle */}
      <div className="nwi-card">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-white/80 text-sm font-medium">TorqueWrench Active</p>
            <p className="text-white/40 text-xs mt-0.5">
              {isEnabled ? 'Sending review requests after job completion' : 'Review requests paused'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsEnabled(prev => !prev)}
            className={`relative w-12 h-6 rounded-full transition-colors focus:outline-none ${
              isEnabled ? 'bg-orange' : 'bg-dark-border'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                isEnabled ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Google Place ID */}
      <div className="nwi-card">
        <p className="text-white/40 text-xs uppercase tracking-widest mb-4">Google Business</p>

        <div className="space-y-4">
          <div>
            <label className="block text-white/60 text-xs font-medium mb-1.5">
              Google Place ID
            </label>
            <input
              type="text"
              value={googlePlaceId}
              onChange={e => setGooglePlaceId(e.target.value)}
              placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
              className="w-full bg-dark-lighter border border-dark-border rounded-xl px-4 py-3 text-white text-sm placeholder-white/20 focus:outline-none focus:border-orange/50 min-h-[44px]"
            />
            <p className="text-white/30 text-xs mt-1.5">
              Find yours at{' '}
              <a
                href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder"
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange/70 hover:text-orange underline"
              >
                Google&apos;s Place ID Finder
              </a>
            </p>
          </div>

          <div>
            <label className="block text-white/60 text-xs font-medium mb-1.5">
              Business name override <span className="text-white/30 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={businessNameOverride}
              onChange={e => setBusinessNameOverride(e.target.value)}
              placeholder={businessName}
              className="w-full bg-dark-lighter border border-dark-border rounded-xl px-4 py-3 text-white text-sm placeholder-white/20 focus:outline-none focus:border-orange/50 min-h-[44px]"
            />
            <p className="text-white/30 text-xs mt-1.5">Overrides the name used in your review request texts</p>
          </div>
        </div>
      </div>

      {/* Timing */}
      <div className="nwi-card">
        <p className="text-white/40 text-xs uppercase tracking-widest mb-4">Timing</p>
        <div>
          <label className="block text-white/60 text-xs font-medium mb-1.5">
            Send delay after job closes (minutes)
          </label>
          <input
            type="number"
            min={1}
            max={1440}
            value={sendDelayMinutes}
            onChange={e => setSendDelayMinutes(Number(e.target.value))}
            className="w-full bg-dark-lighter border border-dark-border rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-orange/50 min-h-[44px]"
          />
          <p className="text-white/30 text-xs mt-1.5">Default 10 minutes — long enough for them to drive away, short enough to still be top of mind</p>
        </div>
      </div>

      {/* Service recovery */}
      <div className="nwi-card">
        <p className="text-white/40 text-xs uppercase tracking-widest mb-4">Service Recovery</p>

        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <p className="text-white/80 text-sm font-medium">Service recovery alerts</p>
            <p className="text-white/40 text-xs mt-0.5">
              Get a text if a customer rates 1–3 stars so you can make it right before a bad review goes public
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRecoveryEnabled(prev => !prev)}
            className={`relative w-12 h-6 rounded-full transition-colors focus:outline-none flex-shrink-0 ${
              recoveryEnabled ? 'bg-orange' : 'bg-dark-border'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                recoveryEnabled ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {recoveryEnabled && (
          <div>
            <label className="block text-white/60 text-xs font-medium mb-1.5">
              Recovery alert phone number
            </label>
            <input
              type="tel"
              value={recoveryPhone}
              onChange={e => setRecoveryPhone(e.target.value)}
              placeholder="+1 (555) 000-0000"
              className="w-full bg-dark-lighter border border-dark-border rounded-xl px-4 py-3 text-white text-sm placeholder-white/20 focus:outline-none focus:border-orange/50 min-h-[44px]"
            />
            <p className="text-white/30 text-xs mt-1.5">You&apos;ll be texted immediately when a low rating comes in</p>
          </div>
        )}
      </div>

      {/* Save */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-8 py-3 bg-orange hover:bg-orange-hover disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-xl transition-colors active:scale-95 min-h-[48px]"
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
        {saveSuccess && (
          <span className="text-success text-sm font-medium">Saved</span>
        )}
        {saveError && (
          <span className="text-danger text-xs">{saveError}</span>
        )}
      </div>

    </div>
  )
}
