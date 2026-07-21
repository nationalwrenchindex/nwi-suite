'use client'

import { useRef, useEffect } from 'react'
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
  modules,
}: {
  businessName?:       string
  businessType?:       string
  foremanActive?:      boolean
  torquewrenchActive?: boolean
  modules?:            string[]
}) {
  const pathname = usePathname()
  const router   = useRouter()
  const navRef   = useRef<HTMLElement>(null)

  // Force iOS Safari to initialise the overflow-x scroll container on mount.
  // Without this, the sticky-header scroll area is unresponsive until the
  // user's first manual tap.
  useEffect(() => {
    if (navRef.current) navRef.current.scrollTo(0, 0)
  }, [])

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
      href: '/field-assist',
      label: 'Field Assist',
      active: pathname === '/field-assist',
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
    if (item.href === '/field-assist' && businessType === 'detailer') return false
    if (item.href === '/inventory'   && businessType !== 'detailer') return false
    return true
  })

  // Determines whether a nav item should render as locked (padlock, no navigation)
  function isLocked(href: string): boolean {
    if (href === '/foreman')      return !foremanActive
    if (href === '/torquewrench') return !torquewrenchActive
    // Module-based locking only applies when caller explicitly passes the modules list
    if (!modules) return false
    if (href === '/intel')      return !modules.includes('intel')
    if (href === '/financials') return !modules.includes('financials')
    if (href === '/field-assist') return !modules.includes('quickwrench')
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
          {/* Temporary LP wordmark — replace with logo image when brand is confirmed */}
          <span
            className="flex items-center justify-center h-10 w-10 rounded-lg font-condensed font-extrabold text-lg text-white"
            style={{ backgroundColor: '#16a34a' }}
          >
            LP
          </span>
          <span className="hidden md:flex flex-col leading-tight whitespace-nowrap">
            <span className="font-condensed font-bold text-sm" style={{ color: '#16a34a' }}>
              LawnPlatform
            </span>
            <span className="text-[10px] text-white/50">Built for lawn and landscape pros</span>
          </span>
        </Link>

        {/* Nav items — full remaining width, horizontally scrollable */}
        <nav ref={navRef} className="flex items-center gap-1 flex-1 overflow-x-auto hide-scrollbar">
          {visibleNavItems.map((item) => {
            const isComingSoon = item.href === '#'
            const locked       = isLocked(item.href)
            // Mobile: stacked (icon above label), min 44px touch target
            // Desktop: inline (icon beside label), compact
            const base = 'flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1.5 px-2 sm:px-3 min-h-[44px] justify-center rounded-lg transition-colors whitespace-nowrap'

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
      </div>
    </header>
  )
}
