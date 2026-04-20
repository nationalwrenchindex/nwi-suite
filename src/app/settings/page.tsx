import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import SettingsClient from '@/components/settings/SettingsClient'

export const metadata = { title: 'Settings — National Wrench Index Suite\u2122' }

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, business_name, slug, share_sms_template, share_email_subject, share_email_body')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav businessName={profile.business_name} />
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Account</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">SETTINGS</h1>
        </div>

        <SettingsClient
          slug={profile.slug ?? null}
          businessName={profile.business_name ?? ''}
          techName={profile.full_name ?? ''}
          initialTemplates={{
            share_sms_template:  profile.share_sms_template  ?? undefined,
            share_email_subject: profile.share_email_subject ?? undefined,
            share_email_body:    profile.share_email_body    ?? undefined,
          }}
        />
      </main>
    </div>
  )
}
