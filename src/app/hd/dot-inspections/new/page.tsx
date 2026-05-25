import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import DOTInspectionForm from './DOTInspectionForm'

export const metadata = { title: 'New DOT Inspection — NWI HD Suite' }

export default async function NewDOTInspectionPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDStarterAccess(user.id)
  if (!hasAccess) redirect('/hd/upgrade')

  const params = await searchParams
  const initialUnitId = typeof params.unit === 'string' ? params.unit : null

  const [
    { data: units },
    { data: fleetAccounts },
    { data: profile },
  ] = await Promise.all([
    supabase
      .from('hd_units')
      .select('id, unit_number, manufacturer, model, serial_number, fleet_account_id, year, total_hours')
      .eq('user_id', user.id)
      .order('unit_number'),
    supabase
      .from('hd_fleet_accounts')
      .select('id, fleet_name')
      .eq('user_id', user.id)
      .order('fleet_name'),
    supabase
      .from('profiles')
      .select('hd_tech_name, hd_epa_cert_number, business_name, full_name, hd_company_logo_url')
      .eq('id', user.id)
      .single(),
  ])

  const p = profile as {
    hd_tech_name?: string | null
    hd_epa_cert_number?: string | null
    business_name?: string | null
    full_name?: string | null
    hd_company_logo_url?: string | null
  } | null

  return (
    <main className="flex-1 min-h-screen" style={{ background: '#0a0f14' }}>
      <DOTInspectionForm
        units={(units ?? []) as Array<{
          id: string
          unit_number: string
          manufacturer: string
          model: string
          serial_number: string | null
          fleet_account_id: string | null
          year: number | null
          total_hours: number | null
        }>}
        fleetAccounts={(fleetAccounts ?? []) as Array<{ id: string; fleet_name: string }>}
        profile={{
          hd_tech_name:        p?.hd_tech_name        ?? null,
          hd_epa_cert_number:  p?.hd_epa_cert_number  ?? null,
          business_name:       p?.business_name        ?? null,
          full_name:           p?.full_name            ?? null,
          hd_company_logo_url: p?.hd_company_logo_url ?? null,
        }}
        initialUnitId={initialUnitId}
      />
    </main>
  )
}
