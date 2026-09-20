import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import { FLEET_ACCOUNT_LIST_SELECT, FLEET_ACCOUNT_PAGE_SIZE, type FleetAccountListRow } from '@/app/api/hd/fleet-accounts/list'
import FleetAccountList from './FleetAccountList'

export const metadata = { title: 'Fleet Accounts — NWI HD Suite' }

const HD_ORANGE = '#E85D24'

export default async function FleetAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasStarterAccess = await checkHDStarterAccess(user.id)
  if (!hasStarterAccess) redirect('/hd/upgrade')

  const params   = await searchParams
  const showForm = params.new === '1'

  // Paged: PostgREST silently caps any response at 1,000 rows, so loading every
  // account at once would quietly hide the rest. The header total comes from its
  // own exact/head count and reports the real number regardless of how many rows
  // this first page carries.
  const [{ data: accounts }, { count: accountCount }] = await Promise.all([
    supabase
      .from('hd_fleet_accounts')
      .select(FLEET_ACCOUNT_LIST_SELECT)
      .eq('user_id', user.id)
      // Must match the API's ordering exactly, or the offsets the client sends
      // would page through a different sequence than this first page came from.
      .order('fleet_name')
      .order('id')
      .range(0, FLEET_ACCOUNT_PAGE_SIZE - 1),
    supabase
      .from('hd_fleet_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
  ])

  const rows  = (accounts ?? []) as FleetAccountListRow[]
  const total = accountCount ?? rows.length

  async function addAccount(formData: FormData) {
    'use server'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const fleetName = (formData.get('fleet_name') as string ?? '').trim()
    if (!fleetName) return

    await supabase.from('hd_fleet_accounts').insert({
      user_id:       user.id,
      fleet_name:    fleetName,
      contact_name:  (formData.get('contact_name') as string ?? '').trim() || null,
      contact_phone: (formData.get('contact_phone') as string ?? '').trim() || null,
      contact_email: (formData.get('contact_email') as string ?? '').trim() || null,
      address:       (formData.get('address') as string ?? '').trim() || null,
    })
    redirect('/hd/fleet-accounts')
  }

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">FLEET ACCOUNTS</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {total.toLocaleString()} account{total !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          href="?new=1"
          className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white"
          style={{ background: HD_ORANGE }}
        >
          + Add Fleet Account
        </Link>
      </div>

      {/* Inline create form */}
      {showForm && (
        <form action={addAccount} className="rounded-xl p-6 mb-6 space-y-4" style={{ background: '#111920', border: `1px solid ${HD_ORANGE}50` }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide">ADD FLEET ACCOUNT</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Fleet / Company Name *</label>
              <input name="fleet_name" required placeholder="e.g. Smith Refrigerated Transport" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={{ background: '#162030', border: '1px solid #1e3040' }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Contact Name</label>
              <input name="contact_name" placeholder="e.g. John Smith" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={{ background: '#162030', border: '1px solid #1e3040' }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Contact Phone</label>
              <input name="contact_phone" type="tel" placeholder="(555) 000-0000" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={{ background: '#162030', border: '1px solid #1e3040' }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Contact Email</label>
              <input name="contact_email" type="email" placeholder="john@example.com" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={{ background: '#162030', border: '1px solid #1e3040' }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Address</label>
              <input name="address" placeholder="123 Main St, City, ST" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={{ background: '#162030', border: '1px solid #1e3040' }} />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: HD_ORANGE }}>
              Save Account
            </button>
            <Link href="/hd/fleet-accounts" className="px-4 py-2.5 rounded-lg text-sm border" style={{ color: 'rgba(255,255,255,0.5)', borderColor: '#1e3040' }}>
              Cancel
            </Link>
          </div>
        </form>
      )}

      {/* key: a server re-render (a newly added account, say) does not remount a
          client component on its own, so without it the grid would keep the stale
          rows it had already accumulated. */}
      <FleetAccountList key={total} initialRows={rows} total={total} />
    </main>
  )
}
