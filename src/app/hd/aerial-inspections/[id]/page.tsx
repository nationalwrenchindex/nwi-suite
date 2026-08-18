import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AerialInspectionDetail from './AerialInspectionDetail'
import { AERIAL_FORMS } from '@/lib/hd/aerial/forms'
import type { AerialInspectionRecord, AerialInspectionType } from '@/types/aerial'

export const metadata = { title: 'Aerial Inspection — NWI HD Suite' }

export default async function AerialInspectionPage({
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
    .from('hd_aerial_inspections')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error || !data) return notFound()

  const record = data as unknown as AerialInspectionRecord
  const def    = AERIAL_FORMS[record.inspection_type as AerialInspectionType]
  if (!def) return notFound()

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, phone')
    .eq('id', user.id)
    .single()

  const p = profile as { business_name?: string; phone?: string } | null

  return (
    <AerialInspectionDetail
      record={record}
      def={def}
      businessName={p?.business_name ?? ''}
      businessPhone={p?.phone ?? ''}
    />
  )
}
