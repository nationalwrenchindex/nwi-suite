// /fleet-manager - the fleet's units, one folder each: number, make, model, serial,
// year and the latest hours or miles. In unit-number order.
//
// NO PM due, PM alerts or anything predictive (Brock, Nov 24): those are Fleet Pro,
// which the fleet pays for. lib/hd/pm-due stays - the Intel Hub uses it - but nothing
// in the fleet view calls it.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveFleetManager } from '@/lib/fleet-view/access'
import { listFleetUnits, type SafeUnit } from '@/lib/fleet-view/unit-history'
import { Card, Header, fmtHours, fmtMiles, MUTED, INK } from '@/components/fleet-manager/ui'
import SignOut from '@/components/fleet-manager/SignOut'

export const dynamic = 'force-dynamic'

const byNumber = (a: SafeUnit, b: SafeUnit) =>
  String(a.unit_number ?? '').localeCompare(String(b.unit_number ?? ''), 'en-US', { numeric: true })

export default async function FleetManagerHome() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/fleet-manager/login')
  const access = await resolveFleetManager(user)
  if (!access) redirect('/fleet-manager/no-access')

  const units = (await listFleetUnits(createServiceClient(), access)).sort(byNumber)

  return (
    <main>
      <div className="flex items-start justify-between gap-3">
        <Header title={access.fleetName || 'Your fleet'}
          sub={`${units.length} unit${units.length === 1 ? '' : 's'}`} />
        <SignOut />
      </div>
      {units.length === 0 ? (
        <Card><p className="text-sm" style={{ color: MUTED }}>No units are on this fleet yet.</p></Card>
      ) : (
        <ul className="space-y-3" data-testid="fm-unit-list">
          {units.map(u => {
            const reading = [fmtHours(u.latest_hours), fmtMiles(u.latest_miles)].filter(Boolean).join(' / ')
            return (
              <li key={u.id}>
                <Link href={`/fleet-manager/units/${u.id}`} className="block" data-testid="fm-unit-row" data-unit-id={u.id}>
                  <Card>
                    <div className="min-w-0">
                        <p className="text-lg font-bold leading-tight" style={{ color: INK }}>{u.unit_number ?? 'No unit number'}</p>
                        <p className="text-sm" style={{ color: MUTED }}>
                          {[u.year, u.manufacturer, u.model].filter(Boolean).join(' ') || 'Make and model not recorded'}
                        </p>
                        {u.serial_number && <p className="text-xs mt-0.5 break-all" style={{ color: MUTED }}>Serial {u.serial_number}</p>}
                    </div>
                    <p className="mt-2 text-sm" data-testid="fm-unit-reading" style={{ color: INK }}>{reading || 'No reading recorded'}</p>
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
