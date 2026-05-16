'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

interface Props {
  initialPhoneNumber: string | null
}

const POLL_INTERVAL_MS = 3000
const MAX_POLL_MS      = 120_000 // 2 minutes

function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
  if (d.length === 10)                        return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return phone
}

export default function ForemanWelcomeClient({ initialPhoneNumber }: Props) {
  const [phoneNumber, setPhoneNumber] = useState<string | null>(initialPhoneNumber)
  const [timedOut,   setTimedOut]   = useState(false)
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(Date.now())

  useEffect(() => {
    if (phoneNumber) return

    startTimeRef.current = Date.now()

    intervalRef.current = setInterval(async () => {
      if (Date.now() - startTimeRef.current >= MAX_POLL_MS) {
        if (intervalRef.current) clearInterval(intervalRef.current)
        setTimedOut(true)
        return
      }
      try {
        const res = await fetch('/api/foreman/settings')
        if (!res.ok) return
        const { settings } = await res.json() as { settings?: { phone_number?: string | null } }
        if (settings?.phone_number) {
          setPhoneNumber(settings.phone_number)
          if (intervalRef.current) clearInterval(intervalRef.current)
        }
      } catch { /* keep polling */ }
    }, POLL_INTERVAL_MS)

    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [phoneNumber])

  // ── Timeout state ──────────────────────────────────────────────────────────
  if (timedOut) {
    return (
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-20 h-20 rounded-2xl bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center mx-auto">
          <svg className="w-10 h-10 text-yellow-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <div>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide mb-2">
            Taking Longer Than Usual
          </h1>
          <p className="text-white/50 text-sm leading-relaxed">
            Your number is taking longer than expected to provision — we&apos;ve been notified and are looking into it. You&apos;ll receive an email once it&apos;s ready.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/settings/foreman"
            className="flex items-center justify-center gap-2 px-8 py-3 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm rounded-xl transition-colors active:scale-95 min-h-[48px]"
          >
            Configure Settings
          </Link>
          <Link
            href="/foreman"
            className="flex items-center justify-center gap-2 px-6 py-3 border border-dark-border hover:border-white/20 text-white/50 hover:text-white text-sm font-medium rounded-xl transition-colors min-h-[48px]"
          >
            View Dashboard
          </Link>
        </div>
      </div>
    )
  }

  // ── Provisioning state ─────────────────────────────────────────────────────
  if (!phoneNumber) {
    return (
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-20 h-20 rounded-2xl bg-orange/15 border border-orange/30 flex items-center justify-center mx-auto">
          <svg className="w-10 h-10 text-orange animate-pulse" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
        </div>
        <div>
          <h1 className="font-condensed font-bold text-4xl text-white tracking-wide mb-2">
            Setting Up Foreman
          </h1>
          <p className="text-white/50 text-base leading-relaxed">
            Provisioning your dedicated phone number&hellip;
          </p>
          <p className="text-white/30 text-sm mt-1">Usually takes about 30 seconds</p>
        </div>
        <div className="flex items-center justify-center gap-2 text-white/30 text-sm">
          <span className="w-2 h-2 rounded-full bg-orange animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 rounded-full bg-orange animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 rounded-full bg-orange animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    )
  }

  // ── Ready state ────────────────────────────────────────────────────────────
  return (
    <div className="max-w-md w-full text-center space-y-6">
      <div className="w-20 h-20 rounded-2xl bg-green-500/10 border border-green-500/30 flex items-center justify-center mx-auto">
        <svg className="w-10 h-10 text-green-400" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <div>
        <p className="text-green-400 text-xs font-medium uppercase tracking-widest mb-1">
          ✓ Your Foreman number is live
        </p>
        <h1 className="font-condensed font-bold text-4xl text-white tracking-wide mb-3">
          Foreman is Active
        </h1>
        <div className="inline-block bg-orange/10 border border-orange/30 rounded-2xl px-6 py-3">
          <p className="font-condensed font-bold text-3xl text-orange tracking-wider">
            {formatPhone(phoneNumber)}
          </p>
        </div>
        <p className="text-white/40 text-sm mt-3 leading-relaxed">
          This is your dedicated Foreman number. Share it with customers or forward your existing number to it.
        </p>
      </div>

      <div className="space-y-2 text-left nwi-card">
        {[
          'Foreman answers calls and books jobs automatically',
          'Configure your hours and greeting below',
          'Forward calls to this number whenever you\'re unavailable',
        ].map((step, i) => (
          <div key={i} className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-orange/15 border border-orange/30 flex items-center justify-center font-condensed font-bold text-orange text-xs flex-shrink-0 mt-0.5">
              {i + 1}
            </span>
            <p className="text-white/70 text-sm">{step}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link
          href="/settings/foreman"
          className="flex items-center justify-center gap-2 px-8 py-3 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm rounded-xl transition-colors active:scale-95 min-h-[48px]"
        >
          Configure Your Foreman
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </Link>
        <Link
          href="/foreman"
          className="flex items-center justify-center gap-2 px-6 py-3 border border-dark-border hover:border-white/20 text-white/50 hover:text-white text-sm font-medium rounded-xl transition-colors min-h-[48px]"
        >
          View Dashboard
        </Link>
      </div>
    </div>
  )
}
