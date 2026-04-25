import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import BookingClient from '@/components/booking/BookingClient'

type PageProps = { params: Promise<{ techSlug: string }> }

export const dynamic = 'force-dynamic'

export default async function BookingPage({ params }: PageProps) {
  const { techSlug } = await params
  const supabase = createServiceClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, business_name, full_name, profession_type, service_area_description, working_hours, offer_mpi_on_booking')
    .eq('slug', techSlug)
    .single()

  if (!profile) notFound()

  return (
    <div className="min-h-dvh bg-dark">
      <BookingClient
        techSlug={techSlug}
        profile={{
          business_name:            profile.business_name   ?? null,
          full_name:                profile.full_name       ?? null,
          profession_type:          profile.profession_type ?? null,
          service_area_description: (profile.service_area_description as string | null) ?? null,
          working_hours:            (profile.working_hours  as Record<string, { enabled: boolean; open: string; close: string }> | null) ?? null,
        }}
        offerMpi={!!(profile as Record<string, unknown>).offer_mpi_on_booking}
      />
    </div>
  )
}
