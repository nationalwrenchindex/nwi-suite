'use client'

import { useState } from 'react'

const HD_ORANGE = '#E85D24'

export default function PartsComingSoon() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  async function subscribe() {
    if (status === 'done') return
    setStatus('loading')
    try {
      const res = await fetch('/api/hd/feature-waitlist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ feature: 'parts_integration' }),
      })
      setStatus(res.ok ? 'done' : 'error')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div
      className="rounded-xl p-6 mt-6"
      style={{
        background: 'linear-gradient(135deg, #111920 0%, #0d1820 100%)',
        border: `1px solid ${HD_ORANGE}40`,
      }}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${HD_ORANGE}20`, border: `1px solid ${HD_ORANGE}40` }}
        >
          <svg className="w-6 h-6" fill="none" stroke={HD_ORANGE} strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-condensed font-bold text-white text-lg tracking-wide">PARTS PRICING &amp; INVENTORY</p>
            <span
              className="text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background: `${HD_ORANGE}20`, color: HD_ORANGE, border: `1px solid ${HD_ORANGE}50` }}
            >
              COMING SOON
            </span>
          </div>

          <p className="text-sm leading-relaxed mb-4" style={{ color: 'rgba(255,255,255,0.6)' }}>
            NWI HD Suite is pending approval for{' '}
            <span style={{ color: 'rgba(255,255,255,0.85)' }}>O&apos;Reilly Auto Parts</span> and{' '}
            <span style={{ color: 'rgba(255,255,255,0.85)' }}>NAPA</span> API integration for real-time
            heavy duty parts pricing and availability. Once approved, parts lookup will be available directly
            from work orders and HD QuickWrench results — no more tab-switching.
          </p>

          <div className="flex flex-wrap gap-3 text-xs mb-4">
            {[
              'Real-time pricing',
              'Live inventory',
              'Cross-reference lookup',
              'Work order integration',
              'QuickWrench parts lists',
            ].map(f => (
              <span
                key={f}
                className="px-2.5 py-1 rounded-full"
                style={{ background: '#162030', color: 'rgba(255,255,255,0.5)', border: '1px solid #1e3040' }}
              >
                {f}
              </span>
            ))}
          </div>

          {status === 'done' ? (
            <p className="text-sm font-semibold" style={{ color: '#22C55E' }}>
              ✓ You&apos;re on the list — we&apos;ll email you when parts integration launches.
            </p>
          ) : (
            <button
              type="button"
              onClick={subscribe}
              disabled={status === 'loading'}
              className="px-5 py-2.5 rounded-lg text-sm font-bold text-white transition-opacity"
              style={{
                background: `linear-gradient(135deg, ${HD_ORANGE}, #c44a1a)`,
                opacity: status === 'loading' ? 0.6 : 1,
              }}
            >
              {status === 'loading' ? 'Subscribing…' : 'Notify Me at Launch'}
            </button>
          )}
          {status === 'error' && (
            <p className="text-xs mt-2" style={{ color: '#EF4444' }}>Something went wrong — try again.</p>
          )}
        </div>
      </div>
    </div>
  )
}
