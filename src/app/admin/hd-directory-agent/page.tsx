import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import AppNav from '@/components/layout/AppNav'
import HdDirectoryAgentControls from '@/components/admin/HdDirectoryAgentControls'
import { ADMIN_EMAIL, FOUNDER_ID, formatPhone } from '@/lib/directory-agent/config'
import {
  HD_CATEGORY_LABEL,
  HD_SERVICE_CATEGORIES,
  type HdServiceCategory,
} from '@/lib/hd-directory-agent/config'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'HD Directory Agent — NWI Admin' }

type Prospect = {
  id:                 string
  business_name:      string | null
  phone:              string
  city:               string | null
  state:              string | null
  rating:             number | null
  service_category:   string | null
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
    pending:   'bg-white/10 text-white/50',
    contacted: 'bg-blue-500/15 text-blue-400',
    yes:       'bg-green-500/15 text-green-400',
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

function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return <span className="text-white/25">—</span>
  const label = HD_CATEGORY_LABEL[category as HdServiceCategory] ?? category
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange/15 text-orange-light">
      {label}
    </span>
  )
}

export default async function HdDirectoryAgentAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || (user.id !== FOUNDER_ID && user.email?.toLowerCase() !== ADMIN_EMAIL)) {
    return notFound()
  }

  const params  = await searchParams
  const raw     = params.category
  // Only accept a category the table's CHECK constraint allows.
  const category = raw && (HD_SERVICE_CATEGORIES as readonly string[]).includes(raw) ? raw : null

  const svc = createServiceClient()
  const TABLE = 'hd_directory_prospects'

  let listQuery = svc
    .from(TABLE)
    .select('id, business_name, phone, city, state, rating, service_category, status, contacted_at, responded_at, bd_listing_created, bd_listing_url')
    .order('created_at', { ascending: false })
    .limit(100)
  if (category) listQuery = listQuery.eq('service_category', category)

  // Counts come from head-only queries so the stat cards stay accurate across
  // the whole table while the listing below is capped at 100 rows. The category
  // breakdown is one head count per category — exact, and immune to the 1000-row
  // default that a select-and-tally would silently hit.
  const [
    { count: totalProspects },
    { count: contactedCount },
    { count: yesCount },
    { count: listingsCreated },
    { count: optOutCount },
    { data: prospectsRaw },
    categoryCounts,
  ] = await Promise.all([
    svc.from(TABLE).select('*', { count: 'exact', head: true }),
    svc.from(TABLE).select('*', { count: 'exact', head: true }).not('contacted_at', 'is', null),
    svc.from(TABLE).select('*', { count: 'exact', head: true }).eq('status', 'yes'),
    svc.from(TABLE).select('*', { count: 'exact', head: true }).eq('bd_listing_created', true),
    svc.from(TABLE).select('*', { count: 'exact', head: true }).eq('status', 'optout'),
    listQuery,
    Promise.all(
      HD_SERVICE_CATEGORIES.map(async c => {
        const { count } = await svc
          .from(TABLE)
          .select('*', { count: 'exact', head: true })
          .eq('service_category', c)
        return { category: c, count: count ?? 0 }
      }),
    ),
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
            HD DIRECTORY AGENT
          </h1>
          <p className="text-white/40 text-sm">
            Google Places discovery across 15 truck corridors → category-specific permission SMS →
            automatic nwihd.com listing on YES
          </p>
        </div>

        {/* ── Stats ─────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <StatCard label="HD Prospects" value={totalProspects ?? 0} />
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

        {/* ── Category breakdown ────────────────────────────────────────────── */}
        <section className="mb-10">
          <h2 className="text-white font-semibold text-lg mb-3">By Service Category</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {categoryCounts.map(({ category: c, count }) => (
              <Link
                key={c}
                href={`/admin/hd-directory-agent?category=${c}`}
                className={`bg-dark-card border rounded-xl px-3 py-3 transition-colors hover:border-orange/40 ${
                  category === c ? 'border-orange/60' : 'border-dark-border'
                }`}
              >
                <p className="text-white/40 text-xs uppercase tracking-widest mb-1">
                  {HD_CATEGORY_LABEL[c]}
                </p>
                <p className={`text-xl font-bold tabular-nums ${count > 0 ? 'text-white' : 'text-white/25'}`}>
                  {count}
                </p>
              </Link>
            ))}
          </div>
        </section>

        {/* ── Manual controls ───────────────────────────────────────────────── */}
        <section className="mb-10">
          <Suspense fallback={null}>
            <HdDirectoryAgentControls category={category} />
          </Suspense>
        </section>

        {/* ── Prospects table ───────────────────────────────────────────────── */}
        <section>
          <h2 className="text-white font-semibold text-lg mb-3">
            Recent Prospects ({prospects.length})
            {category && (
              <span className="text-white/30 text-sm font-normal">
                {' '}· filtered to {HD_CATEGORY_LABEL[category as HdServiceCategory]}
                {' '}
                <Link href="/admin/hd-directory-agent" className="text-orange hover:underline">clear</Link>
              </span>
            )}
          </h2>
          <div className="overflow-x-auto rounded-xl border border-dark-border">
            <table className="w-full">
              <thead className="bg-dark-lighter">
                <tr>
                  <th className={th}>Business</th>
                  <th className={th}>Category</th>
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
                    <td className={td}><CategoryBadge category={p.service_category} /></td>
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
                    <td colSpan={9} className="px-4 py-8 text-center text-white/30 text-sm">
                      No HD prospects yet — run a city search above
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-white/25 text-xs mt-2">
            A yellow &ldquo;No&rdquo; against a <em>yes</em> status means the provider consented but the
            Brilliant Directories call failed — retry the listing manually.
          </p>
        </section>

      </main>
    </div>
  )
}
