import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import { BRANDING_SELECT, resolveBranding, type BrandingSource } from '@/lib/branding'
import DOTInspectionDetail from './DOTInspectionDetail'

export const metadata = { title: 'DOT Inspection Record — NWI HD Suite' }

export default async function DOTInspectionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDStarterAccess(user.id)
  if (!hasAccess) redirect('/hd/upgrade')

  const { id } = await params

  const { data: inspection, error } = await supabase
    .from('hd_dot_inspections')
    .select(`
      id, inspection_id, inspection_date, inspector_name, inspector_cert_number,
      odometer_hours, location, carrier_address, license_plate,
      inspection_data, violations, overall_result,
      signature_data, locked, locked_at, created_at,
      unit:hd_units(unit_number, manufacturer, model, serial_number),
      fleet_account:hd_fleet_accounts(fleet_name)
    `)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !inspection) notFound()

  // Same profile, same owner scope as the inspection. Resolved here rather than
  // read straight off hd_company_logo_url so an uploaded business_logo_url wins
  // while a pasted HD settings URL still works.
  const { data: profile } = await supabase
    .from('profiles')
    .select(BRANDING_SELECT)
    .eq('id', user.id)
    .single()

  const branding = resolveBranding(profile as BrandingSource | null)

  return (
    <main className="flex-1 p-6">
      <DOTInspectionDetail
        inspection={inspection as unknown as Parameters<typeof DOTInspectionDetail>[0]['inspection']}
        branding={branding}
      />
    </main>
  )
}
