import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import InventoryClient from '@/components/inventory/InventoryClient'

export const metadata = { title: 'Inventory — National Wrench Index Suite™' }

export default async function InventoryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, business_type')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')
  if (profile.business_type !== 'detailer') redirect('/dashboard')

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav businessName={profile.business_name} businessType={profile.business_type} />
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Stock</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">INVENTORY</h1>
        </div>
        <InventoryClient />
      </main>
    </div>
  )
}
