import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

export const metadata = {
  title:       'NWI HD Suite — Transport Refrigeration & Heavy Duty',
  description: 'Professional tools for transport refrigeration and heavy duty technicians. Alarm codes, labor guides, fleet management, and invoicing.',
}

const FEATURES = [
  {
    title: 'HD QuickWrench Diagnostics',
    desc:  'Reefer alarm codes, fault analysis, and repair sequences for Thermo King, Carrier, and major OEMs',
    icon: (
      <svg width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path d="M9.663 17h4.673M12 3v1m6.364 1.636-.707.707M21 12h-1M4 12H3m3.343-5.657-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    title: 'Labor Guides',
    desc:  'Flat-rate labor times for common reefer and HD diesel repairs — build accurate quotes in seconds',
    icon: (
      <svg width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
      </svg>
    ),
  },
  {
    title: 'Alarm Code Library',
    desc:  'Full code database for Thermo King, Carrier Transicold, and major truck engine OEMs',
    icon: (
      <svg width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
      </svg>
    ),
  },
  {
    title: 'Quotes & Invoices',
    desc:  'Professional quotes with labor and parts — convert to invoice in one click and track financials',
    icon: (
      <svg width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" />
      </svg>
    ),
  },
]

const PLANS = [
  {
    key:      'starter',
    name:     'HD Starter',
    price:    49,
    badge:    null,
    features: ['Work Orders', 'Fleet Units', 'PM Checklist', 'Scheduler'],
  },
  {
    key:      'pro',
    name:     'HD Pro',
    price:    99,
    badge:    'Most Popular',
    features: ['Everything in Starter', 'HD QuickWrench', 'EPA 608 Log', 'Invoicing & Financials'],
  },
  {
    key:      'elite',
    name:     'HD Elite',
    price:    199,
    badge:    'RECOMMENDED',
    features: ['Everything in Pro', 'Foreman AI Receptionist', 'Reefer Module', 'OEM Knowledge Base'],
  },
]

export default async function HDLandingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/hd/dashboard')

  return (
    <div style={{ minHeight: '100dvh', background: '#0a0f14', color: '#fff' }}>

      {/* ── Nav ── */}
      <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.5rem', borderBottom: '1px solid #1e3040' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: HD_ORANGE, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width={18} height={18} fill="none" stroke="#fff" strokeWidth={2} viewBox="0 0 24 24">
              <rect x="1" y="3" width="15" height="13" rx="2" />
              <path d="M16 8h4l3 5v3h-7V8z" />
              <circle cx="5.5" cy="18.5" r="2.5" />
              <circle cx="18.5" cy="18.5" r="2.5" />
            </svg>
          </div>
          <div>
            <p style={{ fontWeight: 800, fontSize: 13, letterSpacing: '0.12em', lineHeight: 1, color: '#fff', textTransform: 'uppercase', margin: 0 }}>NWI HD Suite</p>
            <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', margin: '3px 0 0' }}>Heavy Duty &amp; Transport Refrigeration</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.625rem' }}>
          <Link
            href="/hd/login"
            style={{ fontSize: 13, padding: '0.5rem 1rem', borderRadius: 8, border: '1px solid #1e3040', color: 'rgba(255,255,255,0.55)', textDecoration: 'none', fontWeight: 500 }}
          >
            Log In
          </Link>
          <Link
            href="/hd/signup"
            style={{ fontSize: 13, padding: '0.5rem 1rem', borderRadius: 8, background: HD_ORANGE, color: '#fff', fontWeight: 700, textDecoration: 'none' }}
          >
            Sign Up
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ textAlign: 'center', padding: '5rem 1.5rem 4rem', maxWidth: 640, margin: '0 auto' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: `${HD_ORANGE}18`, border: `1px solid ${HD_ORANGE}40`, borderRadius: 999, padding: '0.375rem 0.875rem', marginBottom: '1.5rem' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: HD_ORANGE, display: 'inline-block' }} />
          <span style={{ fontSize: 11, color: HD_ORANGE, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>HD Suite</span>
        </div>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.25rem)', fontWeight: 900, lineHeight: 1.1, letterSpacing: '-0.02em', margin: '0 0 1.25rem' }}>
          Built for Transport Refrigeration<br />and Heavy Duty Techs
        </h1>
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)', lineHeight: 1.65, margin: '0 auto 2.5rem', maxWidth: 460 }}>
          Alarm codes, labor guides, fleet management, EPA 608 logging, and professional invoicing — everything a reefer or HD tech needs in one tool.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link
            href="/hd/signup"
            style={{ padding: '0.875rem 2rem', borderRadius: 10, background: HD_ORANGE, color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none', letterSpacing: '0.04em' }}
          >
            Sign Up for HD Suite
          </Link>
          <Link
            href="/hd/login"
            style={{ padding: '0.875rem 2rem', borderRadius: 10, border: '1px solid #1e3040', color: 'rgba(255,255,255,0.65)', fontWeight: 600, fontSize: 14, textDecoration: 'none' }}
          >
            Log In
          </Link>
        </div>
      </section>

      {/* ── Features ── */}
      <section style={{ maxWidth: 960, margin: '0 auto', padding: '3rem 1.5rem' }}>
        <p style={{ textAlign: 'center', fontSize: 11, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: '2.5rem', fontWeight: 600 }}>
          What&apos;s Included
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem' }}>
          {FEATURES.map(({ title, desc, icon }) => (
            <div key={title} style={{ background: '#111920', border: '1px solid #1e3040', borderRadius: 14, padding: '1.25rem 1.25rem 1.375rem' }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `${HD_BLUE}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#60A5FA', marginBottom: '0.875rem' }}>
                {icon}
              </div>
              <p style={{ fontWeight: 700, fontSize: 14, color: '#fff', margin: '0 0 0.375rem' }}>{title}</p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6, margin: 0 }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pricing ── */}
      <section style={{ maxWidth: 920, margin: '0 auto', padding: '3rem 1.5rem 5rem' }}>
        <p style={{ textAlign: 'center', fontSize: 11, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: '0.5rem', fontWeight: 600 }}>
          Pricing
        </p>
        <h2 style={{ textAlign: 'center', fontSize: 28, fontWeight: 800, margin: '0 0 2.5rem', letterSpacing: '-0.01em' }}>
          Simple Monthly Plans
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(255px, 1fr))', gap: '1.25rem', alignItems: 'start' }}>
          {PLANS.map(({ key, name, price, badge, features }) => {
            const isRec = badge === 'RECOMMENDED'
            return (
              <div
                key={key}
                style={{
                  background: '#111920',
                  border:     isRec ? `2px solid ${HD_ORANGE}` : '1px solid #1e3040',
                  borderRadius: 16,
                  padding:    '1.625rem 1.5rem',
                  position:   'relative',
                  transform:  isRec ? 'scale(1.02)' : 'none',
                  boxShadow:  isRec ? `0 0 0 4px ${HD_ORANGE}20` : 'none',
                }}
              >
                {badge && (
                  <div style={{
                    position:    'absolute',
                    top:         -12,
                    left:        '50%',
                    transform:   'translateX(-50%)',
                    background:  isRec ? HD_ORANGE : '#374151',
                    color:       '#fff',
                    fontSize:    10,
                    fontWeight:  700,
                    letterSpacing: '0.1em',
                    padding:     '0.25rem 0.75rem',
                    borderRadius: 999,
                    whiteSpace:  'nowrap',
                  }}>
                    {badge}
                  </div>
                )}
                <p style={{ fontWeight: 800, fontSize: 15, color: '#fff', margin: '0 0 0.25rem' }}>{name}</p>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, margin: '0 0 1.125rem' }}>
                  <span style={{ fontSize: 34, fontWeight: 900, color: isRec ? HD_ORANGE : '#fff', lineHeight: 1 }}>${price}</span>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>/month</span>
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1.375rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {features.map(f => (
                    <li key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
                      <span style={{ color: isRec ? HD_ORANGE : '#22C55E', fontSize: 15, lineHeight: 1 }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/hd/signup"
                  style={{
                    display:     'block',
                    textAlign:   'center',
                    padding:     '0.75rem',
                    borderRadius: 10,
                    background:  isRec ? HD_ORANGE : 'transparent',
                    border:      isRec ? 'none' : '1px solid #1e3040',
                    color:       '#fff',
                    fontWeight:  600,
                    fontSize:    13,
                    textDecoration: 'none',
                  }}
                >
                  Get Started
                </Link>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ borderTop: '1px solid #1e3040', padding: '2rem 1.5rem', textAlign: 'center' }}>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', margin: 0 }}>
          © {new Date().getFullYear()} National Wrench Index · HD Suite
        </p>
      </footer>

    </div>
  )
}
