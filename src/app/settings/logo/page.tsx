import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import LogoUploadClient from '@/components/settings/LogoUploadClient'

export const metadata = { title: 'Business Logo' }

export default async function LogoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, business_type, business_logo_url')
    .eq('id', user.id)
    .single()

  if (profile != null && !profile.business_name?.trim()) redirect('/onboarding')

  const p = profile as { business_name: string; business_type?: string | null; business_logo_url?: string | null }

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav businessName={p.business_name} businessType={p.business_type ?? undefined} />
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Settings</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">BUSINESS LOGO</h1>
          <p className="text-white/40 text-sm mt-1">Shown on your booking page and customer invoices.</p>
        </div>
        <LogoUploadClient initialLogoUrl={p.business_logo_url ?? null} />
      </main>
    </div>
  )
}
