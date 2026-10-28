import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { onReeferSurface } from '@/lib/reefer-surface'
import PartsHome, { type PartsTab } from './PartsHome'

export const metadata = { title: 'Parts — NWI HD Suite' }
export const dynamic = 'force-dynamic'

// The catalog seed is founder-only (see /api/hd/parts/seed).
const FOUNDER_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

// /reefer/parts re-exports this page. On the reefer surface the counter is scoped to
// reefer parts - a filter on the catalog's data, not a different screen.
export default async function PartsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const reefer = await onReeferSurface()
  const { tab } = await searchParams
  const initialTab: PartsTab = tab === 'inventory' || tab === 'lookup' ? tab : 'counter'

  return (
    <PartsHome
      initialTab={initialTab}
      scope={reefer ? 'reefer' : 'all'}
      canSeed={user.id === FOUNDER_ID}
      surface={reefer ? 'NWI Reefer' : 'HD Suite'}
    />
  )
}
