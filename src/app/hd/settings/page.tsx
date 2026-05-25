import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import HDSettingsForm from '@/components/hd/HDSettingsForm'
import ExportData from '@/components/hd/ExportData'

export const metadata = { title: 'Settings — NWI HD Suite' }

export default async function HDSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, business_name, phone, hd_labor_rate, hd_tech_name, hd_epa_cert_number, hd_company_logo_url')
    .eq('id', user.id)
    .single()

  const p = profile as {
    full_name?: string | null
    email?: string | null
    business_name?: string | null
    phone?: string | null
    hd_labor_rate?: number | null
    hd_tech_name?: string | null
    hd_epa_cert_number?: string | null
    hd_company_logo_url?: string | null
  } | null

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
            { label: 'Name',     value: p?.full_name     ?? '—' },
            { label: 'Email',    value: p?.email         ?? user.email ?? '—' },
            { label: 'Business', value: p?.business_name ?? '—' },
            { label: 'Phone',    value: p?.phone         ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between py-3 border-b text-sm" style={{ borderColor: '#1e3040' }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</span>
              <span className="text-white">{value}</span>
            </div>
          ))}
        </div>

        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-1">FIELD SETTINGS</p>
          <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Labor rate, technician name, EPA 608 certification, and company logo for printed documents.
          </p>
          <HDSettingsForm
            initialLaborRate={p?.hd_labor_rate?.toString() ?? null}
            initialTechName={p?.hd_tech_name ?? null}
            initialEpaCert={p?.hd_epa_cert_number ?? null}
            initialLogoUrl={p?.hd_company_logo_url ?? null}
          />
        </div>

        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-1">DATA EXPORT</p>
          <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Download all your fleet data as CSV files in a ZIP archive.
          </p>
          <ExportData />
        </div>

        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-1">DATA IMPORT</p>
          <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Import from your current invoice app, Fullbay, or any CSV with AI column mapping.
          </p>
          <Link
            href="/hd/import"
            className="inline-block px-5 py-2.5 rounded-lg text-sm font-semibold"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)', border: '1px solid #1e3040' }}
          >
            Open Import Wizard →
          </Link>
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
