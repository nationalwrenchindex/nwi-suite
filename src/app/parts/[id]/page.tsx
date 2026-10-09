import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import PartDetail from '@/components/parts/PartDetail'

export const metadata = { title: 'Part - National Wrench Index Suite' }

// SCREEN 2: part detail.
export default async function PartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, business_type, work_orders_enabled')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav
        workOrdersEnabled={profile.work_orders_enabled ?? false}
        businessName={profile.business_name}
        businessType={(profile as Record<string, unknown>).business_type as string | undefined}
      />
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6">
        <Link href="/parts/catalog" className="text-white/40 hover:text-white text-sm">&larr; All parts</Link>
        <div className="mt-4">
          <PartDetail partId={id} />
        </div>
      </main>
    </div>
  )
}
