import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Fleet Accounts — NWI HD Suite' }

const HD_ORANGE = '#E85D24'

export default async function FleetAccountsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const { data: accounts } = await supabase
    .from('hd_fleet_accounts')
    .select('*')
    .eq('user_id', user.id)
    .order('fleet_name')

  return (
    <main className="flex-1 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">FLEET ACCOUNTS</h1>
        </div>
        <button className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: HD_ORANGE }}>
          + Add Fleet Account
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {!accounts || accounts.length === 0 ? (
          <div className="col-span-full py-16 text-center rounded-xl" style={{ background: '#111920', border: '1px solid #1e3040' }}>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>No fleet accounts yet</p>
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.2)' }}>Add commercial fleet customers to organize your service accounts</p>
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
