import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getFleetProMembership } from '@/lib/fleet-pro/access'
import { getPartner, partnerOwnsAccount } from '@/lib/fleet-pro/partner-access'
import QrStickerClient from '@/components/fleet-pro/QrStickerClient'

export const metadata = { title: 'QR Sticker — NWI Fleet Pro' }
export const dynamic = 'force-dynamic'

// The sticker is printed once and then lives on a truck for years, so the URL it
// encodes must be the public production origin — never a preview or localhost
// deployment. NEXT_PUBLIC_APP_URL is that origin; the literal is only a last resort
// for a build with no env configured.
const PUBLIC_ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tools.nationalwrenchindex.com'

export default async function QrStickerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?redirect=/fleet-pro/units/${id}/qr-sticker`)

  const svc = createServiceClient()
  const { data: unit } = await svc
    .from('hd_units')
    .select('id, unit_number, manufacturer, model, serial_number, fleet_account_id')
    .eq('id', id)
    .maybeSingle()

  if (!unit) notFound()

  // Two doors, same as the unit detail API: a member of this unit's fleet, or the
  // partner who resells it. Checked against the unit's OWN fleet_account_id rather
  // than anything from the URL.
  const fleetId    = unit.fleet_account_id as string | null
  const membership = await getFleetProMembership(user.id)
  let allowed = !!membership && !!fleetId && membership.fleet_account_id === fleetId

  if (!allowed && fleetId) {
    const partner = await getPartner(user.id)
    allowed = !!partner && (await partnerOwnsAccount(partner.id, fleetId))
  }

  // 404 rather than 403 — a stranger should not learn the unit exists.
  if (!allowed) notFound()

  return (
    <main className="flex-1 p-4 sm:p-6">
      <QrStickerClient
        unit={{
          unit_id:       unit.id as string,
          unit_number:   (unit.unit_number as string | null) ?? '',
          manufacturer:  (unit.manufacturer as string | null) ?? null,
          model:         (unit.model as string | null) ?? null,
          serial_number: (unit.serial_number as string | null) ?? null,
        }}
        inspectUrl={`${PUBLIC_ORIGIN.replace(/\/+$/, '')}/inspect/${unit.id}`}
      />
    </main>
  )
}
