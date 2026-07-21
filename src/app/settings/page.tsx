import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import SettingsClient from '@/components/settings/SettingsClient'
import ThemeToggle from '@/components/layout/ThemeToggle'
import { hasQuickWrenchAccess } from '@/lib/subscription'
import type { PricingRow } from '@/components/detailer/DetailerPricingEditor'
import Link from 'next/link'

export const metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  async function signOut() {
    'use server'
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/login')
  }

  const [{ data: profile }, hasQW, { data: pricingRows }, { data: adjPresets }] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, business_name, slug, share_sms_template, share_email_subject, share_email_body, default_payment_instructions, average_mpg, fuel_type, offer_mpi_on_booking, default_labor_rate, default_parts_markup_percent, default_tax_percent, business_type, bill_consumables_separately, phone, sms_booking_notifications_enabled, business_logo_url')
      .eq('id', user.id)
      .single(),
    hasQuickWrenchAccess(user.id),
    supabase
      .from('detailer_service_pricing')
      .select('service_name, vehicle_category, base_price, estimated_hours, is_offered')
      .eq('profile_id', user.id),
    supabase
      .from('detailer_adjustment_presets')
      .select('id, user_id, name, price_cents, sort_order, created_at')
      .eq('user_id', user.id)
      .order('sort_order', { ascending: true }),
  ])

  // Redirect to onboarding ONLY when setup is genuinely incomplete.
  // Never redirect on a DB query error (profile === null) — that is a different failure mode.
  if (profile != null && (!profile.business_name?.trim() || !profile.slug?.trim() || !profile.business_type)) {
    redirect('/onboarding')
  }

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
    bill_consumables_separately?:        boolean | null
    phone?:                              string | null
    sms_booking_notifications_enabled?:  boolean | null
    business_logo_url?:                  string | null
  }

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav businessName={p.business_name ?? ''} businessType={p.business_type ?? undefined} />
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Account</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">SETTINGS</h1>
        </div>

        {/* Business Logo card */}
        <Link
          href="/settings/logo"
          className="flex items-center gap-4 rounded-xl border border-[#333] bg-[#222] px-5 py-4 mb-6 hover:border-white/20 transition-colors"
        >
          <div className="w-12 h-12 rounded-xl overflow-hidden border border-dark-border bg-dark-card flex-shrink-0 flex items-center justify-center">
            {p.business_logo_url ? (
              <img
                src={p.business_logo_url}
                alt="Business logo"
                className="w-full h-full object-contain p-1"
              />
            ) : (
              <svg className="w-5 h-5 text-white/30" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white text-sm">Business Logo</p>
            <p className="text-white/40 text-xs mt-0.5">
              {p.business_logo_url
                ? 'Logo uploaded — appears on booking page and invoices'
                : 'No logo yet — add one to brand your booking page and invoices'}
            </p>
          </div>
          <svg className="w-4 h-4 text-white/30 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
          </svg>
        </Link>

        {/* Display */}
        <div className="rounded-xl border border-[#333] bg-[#222] px-5 py-4 mb-6">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-3">Display</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-white text-sm">Color Theme</p>
              <p className="text-white/40 text-xs mt-0.5">Switch between dark and light mode</p>
            </div>
            <ThemeToggle />
          </div>
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
          initialBillConsumables={p.bill_consumables_separately ?? false}
          initialPhone={p.phone ?? null}
          initialSmsBookingNotif={p.sms_booking_notifications_enabled ?? true}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          initialAdjustmentPresets={(adjPresets ?? []) as any[]}
        />

        {/* Sign out */}
        <div className="rounded-xl border border-[#333] bg-[#222] px-5 py-4 mt-6">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-3">Session</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-white text-sm">Sign out</p>
              <p className="text-white/40 text-xs mt-0.5">Sign out of your NWI account on this device</p>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="text-xs font-medium text-danger hover:text-danger/70 border border-danger/30 hover:border-danger/50 rounded-lg px-4 py-2 transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}
