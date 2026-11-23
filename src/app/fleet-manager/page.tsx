// /fleet-manager - the fleet's units: number, make, model, serial, year, the latest
// hours or miles, and what PM is due. Units needing a PM come first.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveFleetManager } from '@/lib/fleet-view/access'
import { listFleetUnits, type SafeUnit } from '@/lib/fleet-view/unit-history'
import { Card, Header, PmBadge, fmtHours, fmtMiles, pmDetail, MUTED, INK } from '@/components/fleet-manager/ui'
import SignOut from '@/components/fleet-manager/SignOut'

export const dynamic = 'force-dynamic'

const RANK: Record<string, number> = { overdue: 0, due_soon: 1 }
const byPm = (a: SafeUnit, b: SafeUnit) =>
  (RANK[a.pm_due.status ?? ''] ?? 2) - (RANK[b.pm_due.status ?? ''] ?? 2) ||
  String(a.unit_number ?? '').localeCompare(String(b.unit_number ?? ''), 'en-US', { numeric: true })

export default async function FleetManagerHome() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/fleet-manager/login')
  const access = await resolveFleetManager(user)
  if (!access) redirect('/fleet-manager/no-access')

  const units = (await listFleetUnits(createServiceClient(), access)).sort(byPm)
  const due = units.filter(u => u.pm_due.status).length

  return (
    <main>
      <div className="flex items-start justify-between gap-3">
        <Header title={access.fleetName || 'Your fleet'}
          sub={`${units.length} unit${units.length === 1 ? '' : 's'}${due ? ` - ${due} need${due === 1 ? 's' : ''} a PM` : ''}`} />
        <SignOut />
      </div>
      {units.length === 0 ? (
        <Card><p className="text-sm" style={{ color: MUTED }}>No units are on this fleet yet.</p></Card>
      ) : (
        <ul className="space-y-3" data-testid="fm-unit-list">
          {units.map(u => {
            const reading = [fmtHours(u.latest_hours), fmtMiles(u.latest_miles)].filter(Boolean).join(' / ')
            const detail = pmDetail(u.pm_due)
            return (
              <li key={u.id}>
                <Link href={`/fleet-manager/units/${u.id}`} className="block" data-testid="fm-unit-row" data-unit-id={u.id}>
                  <Card>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-lg font-bold leading-tight" style={{ color: INK }}>{u.unit_number ?? 'No unit number'}</p>
                        <p className="text-sm" style={{ color: MUTED }}>
                          {[u.year, u.manufacturer, u.model].filter(Boolean).join(' ') || 'Make and model not recorded'}
                        </p>
                        {u.serial_number && <p className="text-xs mt-0.5 break-all" style={{ color: MUTED }}>Serial {u.serial_number}</p>}
                      </div>
                      <PmBadge due={u.pm_due} />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" style={{ color: INK }}>
                      <span data-testid="fm-unit-reading">{reading || 'No reading recorded'}</span>
                      {detail && <span style={{ color: MUTED }}>{detail}</span>}
                    </div>
                  </Card>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
