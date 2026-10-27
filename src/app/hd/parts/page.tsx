import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PartsLookup from './PartsLookup'

export const metadata = { title: 'Parts Lookup — NWI HD Suite' }

// The catalog seed is founder-only (see /api/hd/parts/seed).
const FOUNDER_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

export default async function PartsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')
  return <PartsLookup canSeed={user.id === FOUNDER_ID} />
}
