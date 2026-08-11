import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import AppNav from '@/components/layout/AppNav'
import DirectoryAgentControls from '@/components/admin/DirectoryAgentControls'
import { ADMIN_EMAIL, FOUNDER_ID, formatPhone } from '@/lib/directory-agent/config'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Directory Agent — NWI Admin' }

type Prospect = {
  id:                 string
  business_name:      string | null
  phone:              string
  city:               string | null
  state:              string | null
  rating:             number | null
  status:             string
  contacted_at:       string | null
  responded_at:       string | null
  bd_listing_created: boolean | null
  bd_listing_url:     string | null
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function StatCard({
  label,
  value,
  color = 'text-white',
}: {
  label: string
  value: string | number
  color?: string
}) {
  return (
    <div className="bg-dark-card border border-dark-border rounded-xl px-4 py-5">
      <p className="text-white/40 text-xs uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending:        'bg-white/10 text-white/50',
    contacted:      'bg-blue-500/15 text-blue-400',
    awaiting_email: 'bg-orange/20 text-orange-light',
    yes:            'bg-green-500/15 text-green-400',
    no:        'bg-yellow-500/15 text-yellow-400',
    optout:    'bg-red-500/15 text-red-400',
  }
  const cls = styles[status] ?? 'bg-white/10 text-white/40'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  )
}

export default async function DirectoryAgentAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || (user.id !== FOUNDER_ID && user.email?.toLowerCase() !== ADMIN_EMAIL)) {
    return notFound()
  }

  const svc = createServiceClient()

  // Counts come from head-only queries so the stat cards stay accurate across
  // the whole table while the listing below is capped at 100 rows.
  const [
    { count: totalProspects },
    { count: contactedCount },
    { count: yesCount },
    { count: listingsCreated },
    { count: optOutCount },
    { data: prospectsRaw },
  ] = await Promise.all([
    svc.from('directory_prospects').select('*', { count: 'exact', head: true }),
    svc.from('directory_prospects').select('*', { count: 'exact', head: true }).not('contacted_at', 'is', null),
    svc.from('directory_prospects').select('*', { count: 'exact', head: true }).eq('status', 'yes'),
    svc.from('directory_prospects').select('*', { count: 'exact', head: true }).eq('bd_listing_created', true),
    svc.from('directory_prospects').select('*', { count: 'exact', head: true }).eq('status', 'optout'),
    svc
      .from('directory_prospects')
      .select('id, business_name, phone, city, state, rating, status, contacted_at, responded_at, bd_listing_created, bd_listing_url')
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const prospects = (prospectsRaw ?? []) as Prospect[]
  const contacted = contactedCount ?? 0
  const yes       = yesCount ?? 0
  // Conversion is YES over *contacted*, not over total found — prospects we
  // haven't texted yet were never given the chance to convert.
  const conversionRate = contacted > 0 ? (yes / contacted) * 100 : 0

  const th = 'px-4 py-3 text-left text-xs font-semibold text-white/40 uppercase tracking-wider whitespace-nowrap'
  const td = 'px-4 py-3 text-sm text-white/80 whitespace-nowrap'

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav businessName="NWI Admin" businessType={undefined} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">

        <div className="mb-6">
          <Link href="/admin" className="text-orange text-sm hover:underline">← Admin Dashboard</Link>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide mt-2">
            DIRECTORY AGENT
          </h1>
          <p className="text-white/40 text-sm">
            Google Places discovery → permission SMS → automatic Brilliant Directories listing on YES
          </p>
        </div>

        {/* ── Stats ─────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <StatCard label="Prospects Found" value={totalProspects ?? 0} />
          <StatCard label="SMS Sent" value={contacted} color={contacted > 0 ? 'text-blue-400' : 'text-white'} />
          <StatCard label="YES Replies" value={yes} color={yes > 0 ? 'text-green-400' : 'text-white'} />
          <StatCard
            label="Listings Created"
            value={listingsCreated ?? 0}
            color={(listingsCreated ?? 0) > 0 ? 'text-green-400' : 'text-white'}
          />
          <StatCard
            label="Opted Out"
            value={optOutCount ?? 0}
            color={(optOutCount ?? 0) > 0 ? 'text-red-400' : 'text-white'}
          />
          <StatCard
            label="Conversion Rate"
            value={`${conversionRate.toFixed(1)}%`}
            color={conversionRate > 0 ? 'text-orange' : 'text-white'}
          />
        </div>

        {/* ── Manual controls ───────────────────────────────────────────────── */}
        <section className="mb-10">
          <DirectoryAgentControls />
        </section>

        {/* ── Prospects table ───────────────────────────────────────────────── */}
        <section>
          <h2 className="text-white font-semibold text-lg mb-3">
            Recent Prospects ({prospects.length})
            {(totalProspects ?? 0) > prospects.length && (
              <span className="text-white/30 text-sm font-normal"> · showing latest 100 of {totalProspects}</span>
            )}
          </h2>
          <div className="overflow-x-auto rounded-xl border border-dark-border">
            <table className="w-full">
              <thead className="bg-dark-lighter">
                <tr>
                  <th className={th}>Business</th>
                  <th className={th}>Phone</th>
                  <th className={th}>Location</th>
                  <th className={th}>Rating</th>
                  <th className={th}>Status</th>
                  <th className={th}>Contacted</th>
                  <th className={th}>Responded</th>
                  <th className={th}>Listing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-border/50">
                {prospects.map(p => (
                  <tr key={p.id} className="hover:bg-dark-lighter/40 transition-colors">
                    <td className={td}>{p.business_name ?? '—'}</td>
                    <td className={`${td} text-white/60`}>{formatPhone(p.phone)}</td>
                    <td className={`${td} text-white/60`}>
                      {p.city ? `${p.city}, ${p.state ?? ''}`.replace(/,\s*$/, '') : '—'}
                    </td>
                    <td className={td}>
                      {typeof p.rating === 'number'
                        ? <span className="text-orange-light">{p.rating.toFixed(1)}★</span>
                        : <span className="text-white/25">—</span>}
                    </td>
                    <td className={td}><StatusBadge status={p.status} /></td>
                    <td className={`${td} text-white/60`}>{fmtDate(p.contacted_at)}</td>
                    <td className={`${td} text-white/60`}>{fmtDate(p.responded_at)}</td>
                    <td className={td}>
                      {p.bd_listing_created
                        ? (p.bd_listing_url
                            ? <a href={p.bd_listing_url} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:underline">Yes ↗</a>
                            : <span className="text-green-400">Yes</span>)
                        : <span className={p.status === 'yes' ? 'text-yellow-400' : 'text-white/25'}>No</span>}
                    </td>
                  </tr>
                ))}
                {prospects.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-white/30 text-sm">
                      No prospects yet — run a city search above
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-white/25 text-xs mt-2">
            A yellow &ldquo;No&rdquo; against a <em>yes</em> status means the mechanic consented but the
            Brilliant Directories call failed — retry the listing manually.
          </p>
        </section>

      </main>
    </div>
  )
}
