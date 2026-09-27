'use client'

import { useRef, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useRouter } from 'next/navigation'

interface NavItem {
  href:   string
  label:  string
  icon:   React.ReactNode
  active: boolean
}

function LockIcon() {
  return (
    <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

export default function AppNav({
  businessName,
  businessType,
  foremanActive,
  torquewrenchActive,
  workOrdersEnabled,
  modules,
}: {
  businessName?:       string
  businessType?:       string
  foremanActive?:      boolean
  torquewrenchActive?: boolean
  workOrdersEnabled?:  boolean
  modules?:            string[]
}) {
  const pathname = usePathname()
  const router   = useRouter()
  const navRef   = useRef<HTMLElement>(null)

  // Account menu. Settings and Billing live in here rather than in the scrolling
  // row: adding Work Orders pushed the row past the width and Settings was clipped
  // off the right edge, in the DOM but cut at "Set" and unreachable, because the
  // row hides its scrollbar. Anything that can be pushed off the end is not a
  // dependable way to reach Settings.
  const [accountOpen, setAccountOpen] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)

  // Force iOS Safari to initialise the overflow-x scroll container on mount.
  // Without this, the sticky-header scroll area is unresponsive until the
  // user's first manual tap.
  useEffect(() => {
    if (navRef.current) navRef.current.scrollTo(0, 0)
  }, [])

  // Close the account menu on outside click and on Escape. Without the keyboard
  // path the menu is a trap for anyone not using a mouse.
  useEffect(() => {
    if (!accountOpen) return
    function onDown(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setAccountOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setAccountOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [accountOpen])

  // A navigation must not leave the menu hanging open over the new page.
  useEffect(() => { setAccountOpen(false) }, [pathname])

  const navItems: NavItem[] = [
    {
      href: '/dashboard',
      label: 'Dashboard',
      active: pathname === '/dashboard',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      ),
    },
    {
      href: '/scheduler',
      label: 'Scheduler',
      active: pathname === '/scheduler',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      ),
    },
    {
      href: '/work-orders',
      label: 'Work Orders',
      active: pathname.startsWith('/work-orders'),
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="13" y2="17" />
        </svg>
      ),
    },
    {
      href: '/intel',
      label: 'Intel Hub',
      active: pathname === '/intel',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      href: '/financials',
      label: 'Financials',
      active: pathname === '/financials',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      ),
    },
    {
      href: '/quickwrench',
      label: 'QuickWrench',
      active: pathname === '/quickwrench',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
        </svg>
      ),
    },
    {
      href: '/parts',
      label: 'Parts',
      active: pathname === '/parts',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.07 4.93A10 10 0 0 1 20.9 8.6l-2.8.4a7 7 0 0 0-1.07-2.58l1.94-1.59zM19.07 19.07A10 10 0 0 1 15.4 20.9l-.4-2.8a7 7 0 0 0 2.58-1.07l1.49 1.04zM4.93 19.07A10 10 0 0 1 3.1 15.4l2.8-.4a7 7 0 0 0 1.07 2.58l-1.04 1.49zM4.93 4.93A10 10 0 0 1 8.6 3.1l.4 2.8A7 7 0 0 0 6.42 7l-1.49-1.07z"/>
        </svg>
      ),
    },
    {
      href: '/foreman',
      label: 'Foreman',
      active: pathname.startsWith('/foreman'),
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
      ),
    },
    {
      href: '/torquewrench',
      label: 'TorqueWrench',
      active: pathname.startsWith('/torquewrench'),
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      ),
    },
    {
      href: '/inventory',
      label: 'Inventory',
      active: pathname === '/inventory',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      ),
    },
    {
      href: '/billing',
      label: 'Billing',
      active: pathname === '/billing',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
          <line x1="1" y1="10" x2="23" y2="10"/>
        </svg>
      ),
    },
    {
      href: '/settings',
      label: 'Settings',
      active: pathname === '/settings',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      ),
    },
  ]

  // Business-type filters (always hide, regardless of tier)
  const visibleNavItems = navItems.filter(item => {
    if (item.href === '/quickwrench' && businessType === 'detailer') return false
    if (item.href === '/inventory'   && businessType !== 'detailer') return false
    // Work orders HIDE rather than lock, and default to hidden when the flag was
    // not passed. A padlock would advertise a feature this business has not been
    // given; absent is the requirement. Every page that renders AppNav therefore
    // has to pass workOrdersEnabled or the item disappears for enabled shops too.
    if (item.href === '/work-orders' && !workOrdersEnabled) return false
    return true
  })

  // Settings and Billing are the account's own pages rather than places the work
  // happens, so they sit in a menu at the far right instead of competing with
  // Dashboard and Financials for room in the row.
  const ACCOUNT_HREFS = ['/settings', '/billing']
  const mainNavItems    = visibleNavItems.filter(i => !ACCOUNT_HREFS.includes(i.href))
  const accountNavItems = visibleNavItems.filter(i =>  ACCOUNT_HREFS.includes(i.href))
  const accountActive   = accountNavItems.some(i => i.active)

  // Determines whether a nav item should render as locked (padlock, no navigation)
  function isLocked(href: string): boolean {
    // Explicit false only. These props are optional and most callers never passed
    // them, so `!undefined` was showing a padlock on Foreman and TorqueWrench to
    // paying subscribers on every page that omitted them — the dashboard included.
    // Unknown means 'do not claim locked'; the destination page still gates access.
    if (href === '/foreman')      return foremanActive === false
    if (href === '/torquewrench') return torquewrenchActive === false
    // Module-based locking only applies when caller explicitly passes the modules list
    if (!modules) return false
    if (href === '/intel')      return !modules.includes('intel')
    if (href === '/financials') return !modules.includes('financials')
    if (href === '/quickwrench') return !modules.includes('quickwrench')
    return false
  }

  function upgradeHref(href: string): string {
    if (href === '/foreman') return '/settings/foreman'
    const feature = href.replace('/', '')
    return `/billing/upgrade?from=${feature}`
  }

  return (
    <header className="border-b border-dark-border bg-dark-card sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center gap-4 h-16 sm:h-14">
        {/* Logo */}
        <Link href="/dashboard" className="flex-shrink-0 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/nwi-logo.png" alt="National Wrench Index Suite™" className="h-14 max-w-[180px] sm:h-12 sm:max-w-[150px] w-auto object-contain block" />
          <span className="hidden md:block font-condensed font-bold text-sm leading-tight whitespace-nowrap">
            <span style={{ color: '#FF6600' }}>National</span>{' '}
            <span style={{ color: '#2969B0' }}>Wrench Index</span>
            <span className="text-white/70">&#8482;</span>
          </span>
        </Link>

        {/* Nav items — full remaining width, horizontally scrollable */}
        {/* The row still scrolls -- on a phone it always will -- but the fade on the
            right edge means overflow now LOOKS like more content instead of looking
            like a cut-off label. The scrollbar is hidden, so without it there was no
            way to tell the row could move at all. */}
        <div className="relative flex-1 min-w-0">
        <nav ref={navRef} className="flex items-center gap-0.5 sm:gap-1 overflow-x-auto hide-scrollbar">
          {mainNavItems.map((item) => {
            const isComingSoon = item.href === '#'
            const locked       = isLocked(item.href)
            // Mobile: stacked (icon above label), min 44px touch target
            // Desktop: inline (icon beside label), compact
            // Tighter than it was on desktop. With Work Orders added there are nine
            // modules in this row, and the old px-3/gap-1.5 spacing pushed the last of
            // them past the edge on a 1280px screen.
            const base = 'flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1 px-2 min-h-[44px] justify-center rounded-lg transition-colors whitespace-nowrap'

            if (isComingSoon) {
              return (
                <span
                  key={item.label}
                  title="Coming soon"
                  className={`${base} text-white/20 cursor-not-allowed`}
                >
                  <span className="flex [&>svg]:w-5 [&>svg]:h-5 sm:[&>svg]:w-4 sm:[&>svg]:h-4">{item.icon}</span>
                  <span className="text-[10px] sm:text-xs font-medium leading-none">{item.label}</span>
                </span>
              )
            }
            if (locked) {
              return (
                <button
                  key={item.href}
                  onClick={() => router.push(upgradeHref(item.href))}
                  title="Upgrade to access"
                  className={`${base} text-white/25 hover:text-white/40 opacity-50 cursor-pointer`}
                >
                  <span className="relative flex [&>svg]:w-5 [&>svg]:h-5 sm:[&>svg]:w-4 sm:[&>svg]:h-4">
                    {item.icon}
                    <span className="absolute -top-1 -right-1"><LockIcon /></span>
                  </span>
                  <span className="text-[10px] sm:text-xs font-medium leading-none">{item.label}</span>
                </button>
              )
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${base} ${
                  item.active
                    ? 'bg-orange/15 text-orange'
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
              >
                <span className="flex [&>svg]:w-5 [&>svg]:h-5 sm:[&>svg]:w-4 sm:[&>svg]:h-4">{item.icon}</span>
                <span className="text-[10px] sm:text-xs font-medium leading-none">{item.label}</span>
              </Link>
            )
          })}
        </nav>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-dark-card to-transparent" />
        </div>

        {/* Account menu — pinned to the right, never part of the scrolling row. */}
        <div ref={accountRef} className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setAccountOpen(v => !v)}
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            aria-label="Account"
            className={`flex items-center gap-1 px-2 sm:px-2.5 min-h-[44px] rounded-lg transition-colors ${
              accountActive || accountOpen
                ? 'bg-orange/15 text-orange'
                : 'text-white/50 hover:text-white hover:bg-white/5'
            }`}
          >
            <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <svg
              className={`w-3 h-3 transition-transform ${accountOpen ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {accountOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-dark-border bg-dark-card shadow-2xl overflow-hidden z-50"
            >
              {accountNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  onClick={() => setAccountOpen(false)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium transition-colors ${
                    item.active
                      ? 'bg-orange/15 text-orange'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span className="flex [&>svg]:w-4 [&>svg]:h-4">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
