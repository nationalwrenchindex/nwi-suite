'use client'

import { useState } from 'react'

interface Props {
  onProvisioned?: (number: string) => void
}

export default function ForemanProvisionButton({ onProvisioned }: Props) {
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [number,   setNumber]   = useState<string | null>(null)

  async function provision() {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/foreman/provision-number', { method: 'POST' })
      const json = await res.json() as { phone_number?: string; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Provisioning failed')
      const n = json.phone_number ?? null
      setNumber(n)
      if (n && onProvisioned) onProvisioned(n)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (number) {
    return (
      <div>
        <p className="font-condensed font-bold text-4xl text-orange tracking-widest mb-3">
          {number}
        </p>
        <p className="text-success text-sm flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Your Foreman number is live. Forward your business calls here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3 py-2">
        <div className="w-8 h-8 rounded-lg bg-orange/10 border border-orange/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <svg className="w-4 h-4 text-orange/60" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
        </div>
        <div>
          <p className="text-white/70 text-sm font-medium">No Foreman number yet</p>
          <p className="text-white/30 text-xs mt-0.5">
            Get a dedicated local number. Foreman answers every call you miss.
          </p>
        </div>
      </div>

      <button
        onClick={provision}
        disabled={loading}
        className="w-full px-5 py-3 bg-orange hover:bg-orange-hover disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-xl transition-colors active:scale-95 min-h-[48px]"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            Provisioning your number…
          </span>
        ) : (
          'Get My Foreman Number'
        )}
      </button>

      {error && (
        <p className="text-danger text-xs px-1">{error}</p>
      )}

      <p className="text-white/20 text-xs">
        This provisions a dedicated local phone number (~$1/mo included in your plan).
      </p>
    </div>
  )
}
