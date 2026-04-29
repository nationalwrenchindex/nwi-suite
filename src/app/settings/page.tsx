import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import SettingsClient from '@/components/settings/SettingsClient'
import { hasQuickWrenchAccess } from '@/lib/subscription'
import type { PricingRow } from '@/components/detailer/DetailerPricingEditor'

export const metadata = { title: 'Settings — National Wrench Index Suite™' }

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, hasQW, { data: pricingRows }] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, business_name, slug, share_sms_template, share_email_subject, share_email_body, default_payment_instructions, average_mpg, fuel_type, offer_mpi_on_booking, default_labor_rate, default_parts_markup_percent, default_tax_percent, business_type')
      .eq('id', user.id)
      .single(),
    hasQuickWrenchAccess(user.id),
    supabase
      .from('detailer_service_pricing')
      .select('service_name, vehicle_category, base_price, estimated_hours, is_offered')
      .eq('profile_id', user.id),
  ])

  if (!profile?.business_name) redirect('/onboarding')

  const p = profile as {
    full_name?: string
    business_name?: string
    slug?: string
    share_sms_template?: string
    share_email_subject?: string
    share_email_body?: string
    default_payment_instructions?: string
    average_mpg?: number | null
    fuel_type?: string | null
    offer_mpi_on_booking?: boolean | null
    default_labor_rate?: number | null
    default_parts_markup_percent?: number | null
    default_tax_percent?: number | null
    business_type?: string | null
  }

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav businessName={p.business_name ?? ''} businessType={p.business_type ?? undefined} />
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Account</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">SETTINGS</h1>
        </div>

        <SettingsClient
          slug={p.slug ?? null}
          businessName={p.business_name ?? ''}
          techName={p.full_name ?? ''}
          businessType={p.business_type ?? 'mechanic'}
          initialTemplates={{
            share_sms_template:  p.share_sms_template  ?? undefined,
            share_email_subject: p.share_email_subject ?? undefined,
            share_email_body:    p.share_email_body    ?? undefined,
          }}
          defaultPaymentInstructions={p.default_payment_instructions ?? ''}
          initialAverageMpg={p.average_mpg ?? null}
          initialFuelType={p.fuel_type ?? 'gasoline'}
          hasQwAccess={hasQW}
          initialOfferMpi={p.offer_mpi_on_booking ?? false}
          initialLaborRate={p.default_labor_rate ?? 125}
          initialMarkupPct={p.default_parts_markup_percent ?? 20}
          initialTaxPct={p.default_tax_percent ?? 8.5}
          initialPricingRows={(pricingRows ?? []) as PricingRow[]}
        />
      </main>
    </div>
  )
}
