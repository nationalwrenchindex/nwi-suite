import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'

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

  const { data: accounts } = await supabase
    .from('hd_fleet_accounts')
    .select('*')
    .eq('user_id', user.id)
    .order('fleet_name')

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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {!accounts || accounts.length === 0 ? (
          <div className="col-span-full py-16 text-center rounded-xl" style={{ background: '#111920', border: '1px solid #1e3040' }}>
            <p className="text-sm mb-1" style={{ color: 'rgba(255,255,255,0.3)' }}>No fleet accounts yet</p>
            <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.2)' }}>Add commercial fleet customers to organize your service accounts</p>
            <Link href="?new=1" className="text-xs px-4 py-2 rounded-lg font-semibold" style={{ background: HD_ORANGE, color: '#fff' }}>
              + Add First Account
            </Link>
          </div>
        ) : (
          (accounts as {
            id: string; fleet_name: string; contact_name: string | null
            contact_phone: string | null; contact_email: string | null; address: string | null
          }[]).map(a => (
            <div key={a.id} className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
              <p className="font-condensed font-bold text-white text-lg tracking-wide">{a.fleet_name}</p>
              {a.contact_name  && <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>{a.contact_name}</p>}
              {a.contact_phone && <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>{a.contact_phone}</p>}
              {a.contact_email && <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>{a.contact_email}</p>}
              {a.address       && <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.3)' }}>📍 {a.address}</p>}
            </div>
          ))
        )}
      </div>
    </main>
  )
}
