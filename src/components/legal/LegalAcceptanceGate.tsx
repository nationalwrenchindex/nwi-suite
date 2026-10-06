'use client'

// The one-time prompt for accounts that predate the current Terms version.
//
// IT ASKS. IT DOES NOT LOCK ANYONE OUT, and that is deliberate: every existing
// subscriber is a paying customer who has already been using the product, and holding
// their work orders hostage behind a modal to collect a signature would be a worse act
// than the one it is trying to document. Clause 10.3 says continued use constitutes
// acceptance; this prompt exists to get an explicit record on top of that, not to
// manufacture consent under duress.
//
// So: it appears once per session until accepted, "Remind me later" closes it, and
// nothing behind it is blocked. Accepting records version, timestamp, IP and User-Agent
// server-side.

import { useEffect, useState } from 'react'
import Link from 'next/link'

const DISMISS_KEY = 'nwi.legal.dismissed'

export default function LegalAcceptanceGate() {
  const [needed, setNeeded]     = useState(false)
  const [version, setVersion]   = useState('')
  const [checked, setChecked]   = useState(false)
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/legal/accept', { cache: 'no-store' })
        if (!res.ok) return                       // not signed in, or a transient failure
        const json = await res.json()
        if (cancelled) return

        // THREE STATES, not two. `unavailable` means migration 147 is not applied, so
        // nothing can be recorded - prompting would show a button that can only fail.
        if (json.acceptance?.unavailable) return
        if (json.acceptance?.current) return

        // Dismissed for this session already?
        try {
          if (sessionStorage.getItem(DISMISS_KEY) === json.version) return
        } catch { /* private mode: show it, which is the safer default */ }

        setVersion(String(json.version ?? ''))
        setNeeded(true)
      } catch {
        // A failed check must never block the app. No prompt is better than a broken one.
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (!needed) return null

  async function accept() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/legal/accept', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ accepted: true, version }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not record your acceptance.')
      setNeeded(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record your acceptance.')
    } finally {
      setSaving(false)
    }
  }

  function later() {
    try { sessionStorage.setItem(DISMISS_KEY, version) } catch { /* nothing to do */ }
    setNeeded(false)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#1a1a1a] p-6 shadow-2xl">
        <h2 className="font-condensed font-bold text-white text-xl tracking-wide">
          Updated Terms of Service
        </h2>
        <p className="text-white/60 text-sm mt-2 leading-relaxed">
          We have published an updated Terms of Service and Privacy Policy
          <span className="text-white/35"> (version {version})</span>. Please read and accept
          them. Your account keeps working either way - we are asking for the record, not
          holding anything back.
        </p>

        <label className="flex items-start gap-2.5 mt-4 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={checked}
            onChange={e => setChecked(e.target.checked)}
            className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-white/25 bg-transparent accent-orange"
          />
          <span className="text-white/70 text-sm leading-relaxed">
            I have read and agree to the{' '}
            <Link href="/terms" target="_blank" className="text-orange hover:text-orange-light underline">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" target="_blank" className="text-orange hover:text-orange-light underline">
              Privacy Policy
            </Link>.
          </span>
        </label>

        {error && <p className="text-danger text-xs mt-3">{error}</p>}

        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={accept}
            disabled={!checked || saving}
            className="px-5 py-2.5 bg-[#FF6600] hover:bg-orange-600 disabled:opacity-40 text-white font-condensed font-bold text-sm tracking-wide rounded-xl transition-colors"
          >
            {saving ? 'Recording...' : 'Accept'}
          </button>
          <button
            onClick={later}
            className="px-4 py-2.5 text-white/45 hover:text-white/75 text-sm font-medium rounded-xl transition-colors"
          >
            Remind me later
          </button>
        </div>
      </div>
    </div>
  )
}
