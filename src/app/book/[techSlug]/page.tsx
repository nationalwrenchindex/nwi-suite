import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import BookingClient from '@/components/booking/BookingClient'
import { getServicesByBusinessType } from '@/lib/scheduler'

type PageProps = {
  params:       Promise<{ techSlug: string }>
  searchParams: Promise<{ step?: string }>
}

export const dynamic = 'force-dynamic'

export default async function BookingPage({ params, searchParams }: PageProps) {
  const { techSlug } = await params
  const { step: stepParam } = await searchParams
  const parsed      = parseInt(stepParam ?? '1')
  const supabase    = createServiceClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, business_name, full_name, profession_type, service_area_description, working_hours, offer_mpi_on_booking, business_type')
    .eq('slug', techSlug)
    .single()

  if (!profile) notFound()

  const p            = profile as Record<string, unknown>
  const businessType = (p.business_type as string) ?? 'mechanic'
  const isDetailer   = businessType === 'detailer'

  // For detailers, try to fetch their custom offered services; fall back to defaults
  let services: string[]
  if (isDetailer) {
    const { data: pricingRows } = await supabase
      .from('detailer_service_pricing')
      .select('service_name')
      .eq('profile_id', profile.id)
      .eq('is_offered', true)

    if (pricingRows && pricingRows.length > 0) {
      // Preserve DETAILER_SERVICES order, keep only offered ones
      const offeredSet = new Set(pricingRows.map((r: { service_name: string }) => r.service_name))
      const allServices = [...getServicesByBusinessType('detailer')]
      services = allServices.filter(s => offeredSet.has(s))
    } else {
      services = [...getServicesByBusinessType('detailer')]
    }
  } else {
    services = [...getServicesByBusinessType('mechanic')]
  }

  // Detailer flow has 5 steps (adds vehicle category); mechanic has 4
  const maxSteps    = isDetailer ? 5 : 4
  const initialStep = parsed >= 1 && parsed <= maxSteps ? parsed : 1

  return (
    <div className="min-h-dvh bg-dark">
      <BookingClient
        techSlug={techSlug}
        businessType={businessType}
        profile={{
          business_name:            profile.business_name   ?? null,
          full_name:                profile.full_name       ?? null,
          profession_type:          profile.profession_type ?? null,
          service_area_description: (profile.service_area_description as string | null) ?? null,
          working_hours:            (profile.working_hours  as Record<string, { enabled: boolean; open: string; close: string }> | null) ?? null,
        }}
        services={services}
        offerMpi={!!(p.offer_mpi_on_booking)}
        initialStep={initialStep}
      />
    </div>
  )
}
