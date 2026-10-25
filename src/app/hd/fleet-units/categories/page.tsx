import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getEquipmentCategories } from '@/lib/hd/equipment-categories'
import EquipmentCategoryManager from '@/components/hd/EquipmentCategoryManager'

export const metadata = { title: 'Equipment Categories — NWI HD Suite' }

// The shop's own equipment categories (spec section 2): rename, reorder, deactivate,
// reactivate, add. Seeded with the nine defaults on first access, same helper as the
// units list. Never hardcoded - Kurt's aerial classes, Brock's reefers and a mower shop
// all start from the same defaults and make them their own here.
export default async function EquipmentCategoriesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const categories = await getEquipmentCategories(supabase, user.id, { includeInactive: true })

  // Units per category, so a shop can see what it is about to deactivate. Exact/head
  // counts - no rows come back, so the 1,000-row cap does not apply.
  const counts = await Promise.all([
    ...categories.map(c =>
      supabase.from('hd_units').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).eq('category_id', c.id),
    ),
    supabase.from('hd_units').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).is('category_id', null),
  ])
  const unitCounts: Record<string, number> = {}
  categories.forEach((c, i) => { unitCounts[c.id] = counts[i].count ?? 0 })
  const uncategorized = counts[categories.length].count ?? 0

  return (
    <main className="flex-1 p-4 sm:p-6 max-w-3xl">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--hd-text-faint)' }}>
          <Link href="/hd/fleet-units" className="underline">Fleet Units</Link>
        </p>
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">EQUIPMENT CATEGORIES</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--hd-text-faint)' }}>
          The kinds of equipment your shop works on. Rename them to match your own words, put them in the
          order you want, or deactivate the ones you never use. A deactivated category is hidden from the
          pickers; units already in it keep it.
        </p>
      </div>

      <EquipmentCategoryManager
        initialCategories={categories}
        unitCounts={unitCounts}
        uncategorizedCount={uncategorized}
      />
    </main>
  )
}
