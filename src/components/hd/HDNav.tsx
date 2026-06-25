'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface NavItem {
  href:  string
  label: string
  icon:  React.ReactNode
}

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

function navIcon(path: string) {
  const icons: Record<string, React.ReactNode> = {
    dashboard: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
    'work-orders': (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="12" y2="17" />
      </svg>
    ),
    'fleet-units': (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <rect x="1" y="3" width="15" height="13" rx="2" />
        <path d="M16 8h4l3 5v3h-7V8z" />
        <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
      </svg>
    ),
    'fleet-accounts': (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    invoicing: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    quotes: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" />
        <circle cx="17" cy="17" r="3" /><line x1="19.5" y1="19.5" x2="21" y2="21" />
      </svg>
    ),
    invoices: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
        <line x1="6" y1="8" x2="10" y2="8" />
        <line x1="6" y1="12" x2="14" y2="12" />
      </svg>
    ),
    financials: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
    'dot-inspections': (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
    'pm-schedules': (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
    'epa-log': (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path d="M12 2a10 10 0 1 0 10 10H12V2z" />
        <path d="M12 2a10 10 0 0 1 10 10h-10V2z" />
      </svg>
    ),
    quickwrench: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
      </svg>
    ),
    'cargo-watch': (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" />
        <path d="M15 18H9" />
        <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14" />
        <circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" />
      </svg>
    ),
    scheduler: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    intel: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    ),
    reefer: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <polyline points="8 6 2 12 8 18" /><polyline points="16 6 22 12 16 18" />
        <line x1="2" y1="12" x2="22" y2="12" />
      </svg>
    ),
    foreman: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
      </svg>
    ),
    parts: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    ),
    resources: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        <line x1="9" y1="7" x2="15" y2="7" /><line x1="9" y1="11" x2="15" y2="11" />
      </svg>
    ),
    import: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
    settings: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    ),
  }
  return icons[path] ?? null
}

const NAV_ITEMS: NavItem[] = [
  { href: '/hd/dashboard',       label: 'Dashboard'     },
  { href: '/hd/scheduler',       label: 'Scheduler'     },
  { href: '/hd/quickwrench',     label: 'HD QuickWrench'},
  { href: '/hd/cargo-watch',     label: 'Cargo Watch'   },
  { href: '/hd/intel',           label: 'Intel Hub'     },
  { href: '/hd/financials',      label: 'Financials'    },
  { href: '/hd/parts',           label: 'Parts Lookup'  },
  { href: '/hd/work-orders',     label: 'Work Orders'   },
  { href: '/hd/fleet-units',     label: 'Fleet Units'   },
  { href: '/hd/fleet-accounts',  label: 'Fleet Accounts'},
  { href: '/hd/invoicing',       label: 'Invoicing'     },
  { href: '/hd/quotes',          label: 'Quotes'        },
  { href: '/hd/invoices',        label: 'Invoices'      },
  { href: '/hd/dot-inspections', label: 'DOT Inspections'},
  { href: '/hd/pm-schedules',    label: 'PM Schedules'  },
  { href: '/hd/epa-log',         label: 'EPA 608 Log'   },
  { href: '/hd/reefer',          label: 'Reefer Module' },
  { href: '/hd/foreman',         label: 'Foreman'       },
  { href: '/hd/resources',       label: 'OEM Resources' },
  { href: '/hd/import',          label: 'Import Data'   },
  { href: '/hd/settings',        label: 'Settings'      },
].map(item => ({
  ...item,
  icon: navIcon(item.href.replace('/hd/', '')),
}))

export default function HDNav({ businessName }: { businessName?: string }) {
  const pathname = usePathname()
  const router   = useRouter()
  const [open, setOpen] = useState(false)

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/hd/login')
  }

  function NavLink({ item }: { item: NavItem }) {
    const isActive = item.href === '/hd/dashboard'
      ? pathname === item.href
      : pathname.startsWith(item.href)
    return (
      <Link
        href={item.href}
        onClick={() => setOpen(false)}
        className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors"
        style={isActive
          ? { background: `${HD_ORANGE}20`, color: HD_ORANGE, minHeight: 44 }
          : { color: 'rgba(255,255,255,0.5)', minHeight: 44 }
        }
        onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.9)' }}
        onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.5)' }}
      >
        <span className="flex-shrink-0">{item.icon}</span>
        <span className="font-medium truncate">{item.label}</span>
      </Link>
    )
  }

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="px-4 pt-5 pb-4 flex items-center gap-3 border-b" style={{ borderColor: '#1e3040' }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: HD_ORANGE }}>
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <rect x="1" y="3" width="15" height="13" rx="2" />
            <path d="M16 8h4l3 5v3h-7V8z" />
            <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="font-condensed font-bold text-white text-sm leading-tight tracking-wide">NWI HD SUITE</p>
          <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {businessName ?? 'Heavy Duty'}
          </p>
        </div>
      </div>

      {/* PM Checklist — prominent CTA */}
      <div className="px-3 pt-3 pb-1">
        <Link
          href="/hd/pm-checklist"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: `linear-gradient(135deg, ${HD_ORANGE}, #c44a1a)` }}
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          Start PM Checklist
        </Link>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto space-y-0.5">
        {NAV_ITEMS.map(item => <NavLink key={item.href} item={item} />)}
      </nav>

      {/* Footer */}
      <div className="px-3 pb-4 pt-2 border-t" style={{ borderColor: '#1e3040' }}>
        <button
          onClick={signOut}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm transition-colors text-left"
          style={{ color: 'rgba(255,255,255,0.35)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.35)' }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Sign out
        </button>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop sidebar — visible at md (768px) and up */}
      <aside
        className="hidden md:flex flex-col w-56 flex-shrink-0 min-h-dvh sticky top-0"
        style={{ background: '#0a0f14', borderRight: '1px solid #1e3040' }}
      >
        {sidebarContent}
      </aside>

      {/* Mobile top bar — visible below md (768px) */}
      <header
        className="md:hidden flex items-center gap-3 px-4 h-14 sticky top-0 z-40"
        style={{ background: '#0a0f14', borderBottom: '1px solid #1e3040' }}
      >
        <button
          onClick={() => setOpen(true)}
          className="flex items-center justify-center rounded-lg transition-colors"
          style={{ color: 'rgba(255,255,255,0.6)', minWidth: 44, minHeight: 44 }}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6"  x2="21" y2="6"  />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded flex items-center justify-center" style={{ background: HD_ORANGE }}>
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <rect x="1" y="3" width="15" height="13" rx="2" />
              <path d="M16 8h4l3 5v3h-7V8z" />
              <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
            </svg>
          </div>
          <span className="font-condensed font-bold text-white text-sm tracking-wide">NWI HD SUITE</span>
        </div>
        <Link
          href="/hd/pm-checklist"
          className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
          style={{ background: HD_ORANGE }}
        >
          PM Checklist
        </Link>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside
            className="relative flex flex-col w-64 max-h-dvh overflow-y-auto"
            style={{ background: '#0a0f14', borderRight: '1px solid #1e3040' }}
          >
            <button
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 p-1.5 rounded-lg"
              style={{ color: 'rgba(255,255,255,0.4)' }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  )
}
