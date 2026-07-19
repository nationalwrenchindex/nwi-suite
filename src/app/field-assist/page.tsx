import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkFieldAssistAccess } from '@/lib/landscaping/access'
import AppNav from '@/components/layout/AppNav'
import FieldAssistClient from '@/components/field-assist/FieldAssistClient'

export const metadata = { title: 'Field Assist' }

export default async function FieldAssistPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, business_name, business_type, default_labor_rate, default_tax_percent')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  if (!(await checkFieldAssistAccess(user.id))) redirect('/billing')

  const p = profile as {
    business_name?: string
    business_type?: string
    default_labor_rate?: number | null
    default_tax_percent?: number | null
  }

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav businessName={p.business_name} businessType={p.business_type} />
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-orange/15 border border-orange/30 flex items-center justify-center">
              <svg className="w-4 h-4 text-orange" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
                <path d="M2 21c0-3 1.85-5.36 5.08-6" />
              </svg>
            </div>
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
              Field Assist
            </h1>
          </div>
          <p className="text-white/40 text-sm">
            AI plant &amp; lawn diagnosis and quick estimates — built for the field.
          </p>
        </div>
        <FieldAssistClient laborRate={p.default_labor_rate ?? 60} />
      </main>
    </div>
  )
}
