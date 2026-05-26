import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PartsLookup from './PartsLookup'

export const metadata = { title: 'Parts Lookup — NWI HD Suite' }

export default async function PartsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')
  return <PartsLookup />
}
