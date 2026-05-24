import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import HDLaborRateForm from '@/components/hd/HDLaborRateForm'

export const metadata = { title: 'Settings — NWI HD Suite' }

export default async function HDSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, business_name, phone, hd_labor_rate')
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
            { label: 'Name',     value: profile?.full_name     ?? '—' },
            { label: 'Email',    value: profile?.email         ?? user.email ?? '—' },
            { label: 'Business', value: profile?.business_name ?? '—' },
            { label: 'Phone',    value: profile?.phone         ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between py-3 border-b text-sm" style={{ borderColor: '#1e3040' }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</span>
              <span className="text-white">{value}</span>
            </div>
          ))}
        </div>

        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-1">LABOR RATES</p>
          <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.5)' }}>Configure your shop labor rate for work order calculations.</p>
          <HDLaborRateForm initialRate={profile?.hd_labor_rate?.toString() ?? null} />
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
