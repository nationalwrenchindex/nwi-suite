import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import EquipmentInspectionDetail from './EquipmentInspectionDetail'
import { EQUIPMENT_FORMS, isEquipmentType } from '@/lib/hd/equipment/forms'
import { BRANDING_SELECT, resolveBranding, type BrandingSource } from '@/lib/branding'
import type { EquipmentInspectionRecord } from '@/types/equipment'

export const metadata = { title: 'Equipment Inspection — NWI HD Suite' }

export default async function EquipmentInspectionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  // Scoped to the owner: a signed inspection is a legal record and must not be
  // readable across accounts by guessing an id.
  const { data, error } = await supabase
    .from('hd_equipment_inspections')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error || !data) return notFound()

  const record = data as unknown as EquipmentInspectionRecord
  if (!isEquipmentType(record.equipment_type)) return notFound()
  const def = EQUIPMENT_FORMS[record.equipment_type]

  // Branding is resolved server-side so the print stylesheet sees the logo in the
  // initial HTML — a client-side fetch would leave it out of the first paint the
  // browser hands to the PDF renderer.
  const { data: profile } = await supabase
    .from('profiles')
    .select(BRANDING_SELECT)
    .eq('id', user.id)
    .single()

  const branding = resolveBranding(profile as BrandingSource | null)

  return (
    <EquipmentInspectionDetail
      record={record}
      def={def}
      branding={branding}
    />
  )
}
