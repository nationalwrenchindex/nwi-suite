'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  active: boolean
}


export default function AppNav({ businessName }: { businessName?: string }) {
  const pathname = usePathname()
  const router   = useRouter()

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

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
  ]

  return (
    <header className="border-b border-dark-border bg-dark-card sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center gap-6 h-16 sm:h-14">
        {/* Logo */}
        <Link href="/dashboard" className="flex-shrink-0">
          <div className="bg-white rounded-lg px-2 py-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/nwi-logo.png" alt="National Wrench Index Suite™" className="h-14 w-auto block sm:h-12" />
          </div>
        </Link>

        {businessName && (
          <span className="text-white/30 text-xs hidden lg:block truncate max-w-[160px]">
            {businessName}
          </span>
        )}

        {/* Nav items */}
        <nav className="flex items-center gap-1 flex-1 overflow-x-auto hide-scrollbar">
          {navItems.map((item) => {
            const isComingSoon = item.href === '#'
            const base = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap'
            if (isComingSoon) {
              return (
                <span
                  key={item.label}
                  title="Coming soon"
                  className={`${base} text-white/20 cursor-not-allowed`}
                >
                  {item.icon}
                  <span className="hidden sm:inline">{item.label}</span>
                </span>
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
                {item.icon}
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Sign out */}
        <button
          onClick={signOut}
          className="flex-shrink-0 text-white/40 hover:text-white text-xs transition-colors border border-dark-border rounded-lg px-3 py-1.5 hover:border-white/20"
        >
          Sign out
        </button>
      </div>
    </header>
  )
}
