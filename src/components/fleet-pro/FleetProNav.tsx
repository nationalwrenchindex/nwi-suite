'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { FleetProRole } from '@/types/fleet-pro'
import { ROLE_LABELS, canManageMembers } from '@/types/fleet-pro'
import { FleetProWordmark, NWI_ORANGE } from './brand'

interface NavItem { href: string; label: string }

export default function FleetProNav({
  fleetName,
  role,
}: {
  fleetName: string
  role:      FleetProRole
}) {
  const pathname = usePathname()

  const items: NavItem[] = [
    { href: '/fleet-pro',         label: 'Fleet'    },
    { href: '/fleet-pro/pm',      label: 'PM Schedule' },
    { href: '/fleet-pro/reports', label: 'Reports'  },
    ...(canManageMembers(role) ? [{ href: '/fleet-pro/team', label: 'Team' }] : []),
  ]

  function isActive(href: string) {
    return href === '/fleet-pro' ? pathname === '/fleet-pro' : pathname.startsWith(href)
  }

  return (
    <header
      className="sticky top-0 z-40"
      style={{ background: '#111920', borderBottom: '1px solid #1e3040' }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center gap-4 h-14">
          <div className="min-w-0">
            <FleetProWordmark className="block text-[10px] uppercase tracking-widest leading-none font-semibold" />
            <p className="font-condensed font-bold text-white text-lg leading-tight truncate">
              {fleetName}
            </p>
          </div>

          <nav className="flex items-center gap-1 flex-1 overflow-x-auto hide-scrollbar">
            {items.map(item => {
              const active = isActive(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="px-3 min-h-[44px] flex items-center rounded-lg text-sm font-medium whitespace-nowrap transition-colors"
                  style={
                    active
                      ? { background: `${NWI_ORANGE}20`, color: NWI_ORANGE }
                      : { color: 'rgba(255,255,255,0.5)' }
                  }
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <span
            className="hidden sm:inline text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}
          >
            {ROLE_LABELS[role]}
          </span>
        </div>
      </div>
    </header>
  )
}
