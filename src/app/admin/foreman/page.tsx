import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import AppNav from '@/components/layout/AppNav'
import { FOREMAN_SUBSCRIBER_CAP } from '@/lib/foreman/config'
import { getCurrentForemanSubscriberCount } from '@/lib/foreman/cap'

const FOUNDER_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Foreman Admin — LawnPlatform' }

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function fmtPhone(phone: string | null): string {
  if (!phone) return '—'
  const d = phone.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`
  if (d.length === 10)                        return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return phone
}

type ForemanSubscriber = {
  id:          string
  full_name:   string | null
  email:       string | null
  created_at:  string
  foreman_settings: {
    phone_number:   string | null
    is_enabled:     boolean | null
    business_name:  string | null
    updated_at:     string | null
  } | null
}

type WaitlistEntry = {
  id:            string
  email:         string
  mechanic_name: string | null
  business_name: string | null
  phone:         string | null
  notes:         string | null
  notified:      boolean
  created_at:    string
}

export default async function AdminForemanPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== FOUNDER_ID) return notFound()

  const svc = createServiceClient()

  // Idempotent backfill: founders activated before the automation flow never
  // got a foreman_settings row created for them. Without this, a LEFT JOIN
  // would show them correctly but they'd have no settings row to configure.
  await svc
    .from('foreman_settings')
    .upsert({ user_id: FOUNDER_ID }, { onConflict: 'user_id', ignoreDuplicates: true })

  const [
    foremanCount,
    { data: subscribers },
    { data: waitlist },
  ] = await Promise.all([
    getCurrentForemanSubscriberCount(),
    svc
      .from('profiles')
      .select('id, full_name, email, created_at, foreman_settings!left(phone_number, is_enabled, business_name, updated_at)')
      .eq('foreman_addon_active', true)
      .order('created_at', { ascending: false }),
    svc
      .from('foreman_waitlist')
      .select('*')
      .order('created_at', { ascending: true }),
  ])

  const subs = (subscribers ?? []) as unknown as ForemanSubscriber[]
  const wl   = (waitlist ?? []) as WaitlistEntry[]

  const th = 'px-4 py-3 text-left text-xs font-semibold text-white/40 uppercase tracking-wider whitespace-nowrap'
  const td = 'px-4 py-3 text-sm text-white/80 whitespace-nowrap'

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav businessName="NWI Admin" businessType={undefined} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">

        <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <a href="/admin" className="text-white/30 text-xs hover:text-white transition-colors">Admin</a>
              <span className="text-white/20 text-xs">/</span>
              <p className="text-orange text-xs uppercase tracking-widest font-medium">Foreman</p>
            </div>
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">FOREMAN SUBSCRIBERS</h1>
          </div>
          <div className="bg-dark-card border border-orange/20 rounded-xl px-5 py-3 text-center">
            <p className="font-condensed font-bold text-2xl text-orange">
              {foremanCount} <span className="text-white/30 text-base font-normal">/ {FOREMAN_SUBSCRIBER_CAP}</span>
            </p>
            <p className="text-white/40 text-xs">slots filled</p>
          </div>
        </div>

        {/* ── Subscribers table ──────────────────────────────────────────────── */}
        <section className="mb-10">
          <h2 className="text-white font-semibold text-lg mb-3">Active Subscribers ({foremanCount})</h2>
          <div className="overflow-x-auto rounded-xl border border-dark-border">
            <table className="w-full">
              <thead className="bg-dark-lighter">
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Email</th>
                  <th className={th}>Business</th>
                  <th className={th}>Foreman Number</th>
                  <th className={th}>Status</th>
                  <th className={th}>Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-border/50">
                {subs.map(s => {
                  const fs      = s.foreman_settings
                  const enabled = fs?.is_enabled ?? false
                  return (
                    <tr key={s.id} className="hover:bg-dark-lighter/40 transition-colors">
                      <td className={td}>{s.full_name ?? '—'}</td>
                      <td className={`${td} text-white/60`}>{s.email ?? '—'}</td>
                      <td className={td}>
                        {fs?.business_name
                          ? fs.business_name
                          : <span className="text-white/25 italic">Not yet configured</span>}
                      </td>
                      <td className={td}>
                        {fs?.phone_number
                          ? <span className="font-mono text-orange text-xs">{fmtPhone(fs.phone_number)}</span>
                          : <span className="text-white/25 italic">Not yet configured</span>}
                      </td>
                      <td className={td}>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          enabled
                            ? 'bg-green-500/15 text-green-400'
                            : 'bg-white/5 text-white/30'
                        }`}>
                          {enabled ? 'On' : 'Off'}
                        </span>
                      </td>
                      <td className={`${td} text-white/60`}>{fmtDate(s.created_at)}</td>
                    </tr>
                  )
                })}
                {subs.length === 0 && foremanCount === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-white/30 text-sm">
                      No Foreman subscribers yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Waitlist table ──────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-white font-semibold text-lg mb-3">Waitlist ({wl.length})</h2>
          <div className="overflow-x-auto rounded-xl border border-dark-border">
            <table className="w-full">
              <thead className="bg-dark-lighter">
                <tr>
                  <th className={th}>#</th>
                  <th className={th}>Email</th>
                  <th className={th}>Name</th>
                  <th className={th}>Business</th>
                  <th className={th}>Phone</th>
                  <th className={th}>Notes</th>
                  <th className={th}>Notified</th>
                  <th className={th}>Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-border/50">
                {wl.map((entry, i) => (
                  <tr key={entry.id} className="hover:bg-dark-lighter/40 transition-colors">
                    <td className={`${td} text-white/30`}>{i + 1}</td>
                    <td className={`${td} text-white/80`}>{entry.email}</td>
                    <td className={td}>{entry.mechanic_name ?? '—'}</td>
                    <td className={td}>{entry.business_name ?? '—'}</td>
                    <td className={`${td} text-white/60`}>{entry.phone ?? '—'}</td>
                    <td className={`${td} text-white/50 max-w-xs truncate`}>{entry.notes ?? '—'}</td>
                    <td className={td}>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        entry.notified
                          ? 'bg-green-500/15 text-green-400'
                          : 'bg-white/5 text-white/30'
                      }`}>
                        {entry.notified ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className={`${td} text-white/60`}>{fmtDate(entry.created_at)}</td>
                  </tr>
                ))}
                {wl.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-white/30 text-sm">
                      Waitlist is empty
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

      </main>
    </div>
  )
}
