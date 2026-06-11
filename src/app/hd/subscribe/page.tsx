'use client'

import { useState } from 'react'

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

const PLANS: {
  key:      string
  name:     string
  price:    number
  badge?:   string
  features: string[]
}[] = [
  {
    key:      'starter',
    name:     'HD Starter',
    price:    49,
    features: ['Quoting & Invoicing', 'Parts Inventory', 'Work Orders & Scheduler', 'Fleet Management', 'Truck Engine Diagnostics'],
  },
  {
    key:      'pro',
    name:     'HD Pro',
    price:    99,
    badge:    'Most Popular',
    features: ['Everything in HD Starter', 'DOT Inspection Reports', 'EPA 608 Refrigerant Log', 'Financials & P&L'],
  },
  {
    key:      'elite',
    name:     'HD Elite',
    price:    199,
    badge:    'RECOMMENDED',
    features: ['Everything in HD Pro', 'Reefer Module (alarm codes)', 'Foreman AI Receptionist'],
  },
]

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4 inline-block" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

export default function HDSubscribePage() {
  const [plan,    setPlan]    = useState('pro')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // Promo code
  const [promoInput,      setPromoInput]      = useState('')
  const [promoStatus,     setPromoStatus]     = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle')
  const [promoError,      setPromoError]      = useState<string | null>(null)
  const [promotionCodeId, setPromotionCodeId] = useState<string | null>(null)

  const selectedPlan = PLANS.find(p => p.key === plan)!

  async function handleApplyPromo() {
    if (!promoInput.trim()) return
    setPromoStatus('checking')
    setPromoError(null)
    try {
      const res  = await fetch('/api/stripe/validate-promo', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: promoInput.trim() }),
      })
      const data = await res.json()
      if (data.valid && data.promotionCodeId) {
        setPromoStatus('valid')
        setPromotionCodeId(data.promotionCodeId)
      } else {
        setPromoStatus('invalid')
        setPromoError(data.error ?? 'Invalid promo code')
        setPromotionCodeId(null)
      }
    } catch {
      setPromoStatus('invalid')
      setPromoError('Could not validate code')
    }
  }

  async function handleCheckout() {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/hd/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ plan, ...(promotionCodeId ? { promotionCodeId } : {}) }),
      })
      if (res.status === 401) {
        window.location.href = '/hd/login?next=/hd/subscribe'
        return
      }
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        setError(data.error ?? 'Something went wrong')
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#0a0f14', color: '#fff', padding: '2rem 1.25rem' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: `${HD_ORANGE}18`, border: `1px solid ${HD_ORANGE}40`, borderRadius: 999, padding: '0.375rem 0.875rem', marginBottom: '1rem' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: HD_ORANGE, display: 'inline-block' }} />
            <span style={{ fontSize: 11, color: HD_ORANGE, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>HD Suite</span>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 900, margin: '0 0 0.5rem', letterSpacing: '-0.01em' }}>
            Choose Your HD Plan
          </h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', margin: 0 }}>
            Select a plan to activate your HD Suite access
          </p>
        </div>

        {/* Plan cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', marginBottom: '2rem', alignItems: 'start' }}>
          {PLANS.map(({ key, name, price, badge, features }) => {
            const isSelected = plan === key
            const isRec      = badge === 'RECOMMENDED'
            return (
              <button
                key={key}
                type="button"
                onClick={() => setPlan(key)}
                style={{
                  background:   '#111920',
                  border:       isSelected
                    ? `2px solid ${HD_ORANGE}`
                    : isRec
                      ? `1px solid ${HD_ORANGE}60`
                      : '1px solid #1e3040',
                  borderRadius: 14,
                  padding:      '1.375rem 1.25rem',
                  textAlign:    'left',
                  cursor:       'pointer',
                  position:     'relative',
                  transform:    isSelected ? 'scale(1.02)' : 'none',
                  boxShadow:    isSelected ? `0 0 0 3px ${HD_ORANGE}22` : 'none',
                  transition:   'all 0.15s',
                  width:        '100%',
                }}
              >
                {badge && (
                  <div style={{
                    position:    'absolute',
                    top:         -11,
                    left:        '50%',
                    transform:   'translateX(-50%)',
                    background:  isRec ? HD_ORANGE : '#374151',
                    color:       '#fff',
                    fontSize:    10,
                    fontWeight:  700,
                    letterSpacing: '0.1em',
                    padding:     '0.2rem 0.625rem',
                    borderRadius: 999,
                    whiteSpace:  'nowrap',
                  }}>
                    {badge}
                  </div>
                )}

                {/* Selection indicator */}
                <div style={{ position: 'absolute', top: '1rem', right: '1rem' }}>
                  <div style={{
                    width:       18,
                    height:      18,
                    borderRadius: '50%',
                    border:      `2px solid ${isSelected ? HD_ORANGE : '#1e3040'}`,
                    background:  isSelected ? HD_ORANGE : 'transparent',
                    display:     'flex',
                    alignItems:  'center',
                    justifyContent: 'center',
                  }}>
                    {isSelected && <span style={{ color: '#fff', fontSize: 10, fontWeight: 900 }}>✓</span>}
                  </div>
                </div>

                <p style={{ fontWeight: 800, fontSize: 15, color: '#fff', margin: '0 0 0.25rem' }}>{name}</p>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, margin: '0 0 1rem' }}>
                  <span style={{ fontSize: 30, fontWeight: 900, color: isSelected ? HD_ORANGE : '#fff', lineHeight: 1 }}>${price}</span>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>/month</span>
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {features.map(f => (
                    <li key={f} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                      <span style={{ color: isSelected ? HD_ORANGE : '#22C55E', fontSize: 13, lineHeight: 1 }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </button>
            )
          })}
        </div>

        {/* Promo code */}
        <div style={{ background: '#111920', border: '1px solid #1e3040', borderRadius: 12, padding: '1.125rem 1.25rem', marginBottom: '1.25rem' }}>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: '0 0 0.625rem', fontWeight: 500 }}>
            Promo Code (optional)
          </p>
          <div style={{ display: 'flex', gap: '0.625rem' }}>
            <input
              type="text"
              value={promoInput}
              onChange={e => {
                setPromoInput(e.target.value.toUpperCase())
                setPromoStatus('idle')
                setPromoError(null)
                setPromotionCodeId(null)
              }}
              placeholder="ENTER CODE"
              style={{
                flex:        1,
                background:  '#162030',
                border:      `1px solid ${promoStatus === 'valid' ? '#22C55E' : promoStatus === 'invalid' ? '#EF4444' : '#1e3040'}`,
                borderRadius: 8,
                padding:     '0.625rem 0.875rem',
                color:       '#fff',
                fontSize:    13,
                fontFamily:  'monospace',
                letterSpacing: '0.08em',
                outline:     'none',
              }}
            />
            <button
              type="button"
              onClick={handleApplyPromo}
              disabled={!promoInput.trim() || promoStatus === 'checking'}
              style={{
                padding:     '0.625rem 1rem',
                borderRadius: 8,
                background:  '#1e3040',
                border:      '1px solid #2a4050',
                color:       'rgba(255,255,255,0.7)',
                fontSize:    13,
                fontWeight:  600,
                cursor:      'pointer',
                whiteSpace:  'nowrap',
              }}
            >
              {promoStatus === 'checking' ? <Spinner /> : 'Apply'}
            </button>
          </div>
          {promoStatus === 'valid' && (
            <p style={{ fontSize: 12, color: '#22C55E', margin: '0.5rem 0 0' }}>
              ✓ Promo applied — 90-day free trial activated
            </p>
          )}
          {promoStatus === 'invalid' && (
            <p style={{ fontSize: 12, color: '#EF4444', margin: '0.5rem 0 0' }}>
              {promoError ?? 'Invalid promo code'}
            </p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: '#450a0a', border: '1px solid #ef444440', borderRadius: 10, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: 13, color: '#FCA5A5' }}>
            {error}
          </div>
        )}

        {/* CTA */}
        <button
          type="button"
          onClick={handleCheckout}
          disabled={loading}
          style={{
            width:       '100%',
            padding:     '1rem',
            borderRadius: 12,
            background:  loading ? 'rgba(232,93,36,0.5)' : HD_ORANGE,
            border:      'none',
            color:       '#fff',
            fontWeight:  800,
            fontSize:    15,
            cursor:      loading ? 'not-allowed' : 'pointer',
            letterSpacing: '0.04em',
            display:     'flex',
            alignItems:  'center',
            justifyContent: 'center',
            gap:         '0.5rem',
          }}
        >
          {loading ? <><Spinner /> Processing…</> : `Continue to Checkout — ${selectedPlan.name} $${selectedPlan.price}/mo`}
        </button>

        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center', marginTop: '1rem' }}>
          Secure checkout via Stripe · Cancel anytime
        </p>
      </div>
    </div>
  )
}
