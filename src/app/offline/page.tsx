'use client'

/**
 * The offline fallback. The service worker precaches this route and serves it for
 * any navigation that cannot reach the network and has no cached copy.
 *
 * Two constraints shape this file:
 *
 *  1. NO SERVER DATA. It is a client component with zero fetches and zero imports
 *     beyond React, so Next prerenders it to static HTML at build time and the SW
 *     can precache it with a plain `cache.addAll(['/offline'])`. Add a Supabase call
 *     or a cookie read here and the route becomes dynamic, the precache fetch
 *     returns a redirect or a 500, and the fallback that is supposed to work when
 *     nothing else does stops working.
 *
 *  2. SELF-CONTAINED STYLING. Inline styles rather than shared components, because
 *     this page renders precisely when things are broken. It should not depend on a
 *     chunk that may not be in the cache.
 *
 * No `export const metadata` — that is a server-component export, and the root
 * layout's default title covers this page.
 */

const BG = '#0a0f14'
const CARD = '#111920'
const BORDER = '#1e3040'
const ACCENT = '#ff6600'
const TEXT = '#e6edf3'
const MUTED = '#8b9bad'

/** Kept in sync with the service worker's offline-capable routes. */
const AVAILABLE: {
  href: string | null
  title: string
  body: string
  note: string | null
}[] = [
  {
    // No link: pre-trip forms are per-unit (/inspect/<unitId>) and are reached from
    // the unit's QR code, so there is no generic URL to send a driver to.
    href: null,
    title: 'Pre-Trip Inspections',
    body: 'Driver pre-trip forms you have already opened on this device work offline. Completed inspections are held on the device and upload the moment you have signal.',
    note: 'Scan the unit QR code or use your saved link.',
  },
  {
    href: '/hd/work-orders?new=1',
    title: 'New Work Order',
    body: 'Create a work order in the yard and let it sync when you are back in range.',
    note: null,
  },
  {
    href: '/hd/dot-inspections/new',
    title: 'DOT Inspection Form',
    body: 'Fill out a DOT inspection with no connection. It queues locally until the network comes back.',
    note: null,
  },
]

export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        background: BG,
        color: TEXT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 20px',
        fontFamily:
          'var(--font-barlow), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ width: '100%', maxWidth: 620 }}>
        {/* ── Header ────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <span
            aria-hidden="true"
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: ACCENT,
              boxShadow: `0 0 12px ${ACCENT}`,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-barlow-condensed), sans-serif',
              fontWeight: 700,
              fontSize: 15,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: MUTED,
            }}
          >
            National Wrench Index
          </span>
        </div>

        <h1
          style={{
            fontFamily: 'var(--font-barlow-condensed), sans-serif',
            fontSize: 'clamp(30px, 7vw, 44px)',
            lineHeight: 1.05,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.01em',
            margin: '0 0 12px',
          }}
        >
          You&rsquo;re Offline
        </h1>

        <p style={{ margin: '0 0 26px', fontSize: 16, lineHeight: 1.6, color: MUTED }}>
          This page needs a connection. Your work is not lost &mdash; anything you
          submitted while offline is stored on this device and uploads automatically
          as soon as you have signal.
        </p>

        {/* ── Retry ─────────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            padding: '15px 22px',
            marginBottom: 34,
            background: ACCENT,
            color: '#0a0f14',
            border: 'none',
            borderRadius: 8,
            fontFamily: 'var(--font-barlow-condensed), sans-serif',
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          Retry Connection
        </button>

        {/* ── What still works ──────────────────────────────────────── */}
        <h2
          style={{
            fontFamily: 'var(--font-barlow-condensed), sans-serif',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: MUTED,
            margin: '0 0 12px',
          }}
        >
          Available Offline
        </h2>

        <div style={{ display: 'grid', gap: 12 }}>
          {AVAILABLE.map((item) => {
            const Tag = item.href ? 'a' : 'div'
            return (
            <Tag
              key={item.title}
              {...(item.href ? { href: item.href } : {})}
              style={{
                display: 'block',
                background: CARD,
                border: `1px solid ${BORDER}`,
                borderLeft: `3px solid ${ACCENT}`,
                borderRadius: 8,
                padding: '16px 18px',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-barlow-condensed), sans-serif',
                  fontSize: 19,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                  marginBottom: 5,
                  color: TEXT,
                }}
              >
                {item.title}
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.55, color: MUTED }}>
                {item.body}
              </div>
              {item.note && (
                <div style={{ fontSize: 12.5, marginTop: 7, color: ACCENT }}>
                  {item.note}
                </div>
              )}
            </Tag>
            )
          })}
        </div>

        <p style={{ marginTop: 26, fontSize: 13, lineHeight: 1.6, color: '#5f7386' }}>
          Everything else in the NWI Suite &mdash; dashboards, invoicing, parts,
          scheduling &mdash; needs a live connection and will return automatically.
        </p>
      </div>
    </main>
  )
}
