import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEquipmentCategories } from '@/lib/hd/equipment-categories'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { LABOR_CARD_COLUMNS, type LaborCard } from '@/lib/hd/labor-cards'
import LaborCardManager from '@/components/hd/LaborCardManager'

export const metadata = { title: 'Labor Cards — NWI HD Suite' }
export const dynamic = 'force-dynamic'

// The shop's own labor operations, written by hand (migration 166). Standalone: nothing
// here reads into a quote, work order or invoice. The cards live in the same labor
// library the quote modal's "Save to my labor library" writes, so its entries show up
// here and can be corrected.
export default async function LaborCardsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const [categories, cards] = await Promise.all([
    getEquipmentCategories(supabase, user.id),
    fetchAllRows<LaborCard>((from, to) =>
      supabase
        .from('hd_repair_items')
        .select(LABOR_CARD_COLUMNS)
        .eq('user_id', user.id)
        .eq('active', true)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: LaborCard[] | null; error: null }>)
      .catch(e => {
        console.error('[hd/labor-cards] page read failed', e instanceof Error ? e.message : e)
        return null
      }),
  ])

  return (
    <main className="flex-1 p-4 sm:p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">LABOR CARDS</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--hd-text-faint)' }}>
          Your own labor operations, with field time and shop time kept separate. Type one, press Enter,
          and the form clears for the next.
        </p>
      </div>
      {cards == null ? (
        <p role="alert" className="text-sm px-4 py-2.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--hd-negative)', border: '1px solid rgba(239,68,68,0.3)' }}>
          Your labor cards could not be loaded. Reload the page; if it keeps happening, migration 166 or 167 may not be applied.
        </p>
      ) : (
        <LaborCardManager initialCards={cards} categories={categories.map(c => ({ id: c.id, name: c.name }))} />
      )}
    </main>
  )
}
