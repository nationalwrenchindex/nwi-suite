import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Settings — NWI HD Suite' }

const HD_ORANGE = '#E85D24'

export default async function HDSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, business_name, phone')
    .eq('id', user.id)
    .single()

  return (
    <main className="flex-1 p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite</p>
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">SETTINGS</h1>
      </div>

      <div className="max-w-xl space-y-6">
        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-4">ACCOUNT</p>
          {[
            { label: 'Name', value: profile?.full_name ?? '—' },
            { label: 'Email', value: profile?.email ?? user.email ?? '—' },
            { label: 'Business', value: profile?.business_name ?? '—' },
            { label: 'Phone', value: profile?.phone ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between py-3 border-b text-sm" style={{ borderColor: '#1e3040' }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</span>
              <span className="text-white">{value}</span>
            </div>
          ))}
        </div>

        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-4">LABOR RATES</p>
          <p className="text-sm mb-3" style={{ color: 'rgba(255,255,255,0.5)' }}>Configure your shop labor rate for work order calculations.</p>
          <div className="flex gap-3">
            <input
              type="number"
              placeholder="e.g. 125"
              className="flex-1 px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
              style={{ background: '#162030', border: '1px solid #1e3040' }}
            />
            <span className="flex items-center text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>/hr</span>
            <button className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: HD_ORANGE }}>Save</button>
          </div>
        </div>

        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-2">BILLING</p>
          <p className="text-sm mb-3" style={{ color: 'rgba(255,255,255,0.5)' }}>Manage your HD Suite subscription.</p>
          <a href="/billing" className="inline-block px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
            style={{ color: 'rgba(255,255,255,0.6)', borderColor: '#1e3040' }}>
            Manage Subscription →
          </a>
        </div>
      </div>
    </main>
  )
}
