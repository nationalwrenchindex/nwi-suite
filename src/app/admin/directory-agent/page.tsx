import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import AppNav from '@/components/layout/AppNav'
import DirectoryAgentControls from '@/components/admin/DirectoryAgentControls'
import HdDirectoryAgentControls from '@/components/admin/HdDirectoryAgentControls'
import { ADMIN_EMAIL, FOUNDER_ID, formatPhone } from '@/lib/directory-agent/config'
import { HD_CATEGORY_LABEL, type HdServiceCategory } from '@/lib/hd-directory-agent/config'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Directory Agent — NWI Admin' }

type Tab = 'ld' | 'hd'

const TABLES: Record<Tab, string> = {
  ld: 'directory_prospects',
  hd: 'hd_directory_prospects',
}

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
  follow_up_sent_at:  string | null
  bd_listing_created: boolean | null
  bd_listing_url:     string | null
  // HD only — directory_prospects has no such column, so LD rows render a dash.
  service_category?:  string | null
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
    no:             'bg-yellow-500/15 text-yellow-400',
    optout:         'bg-red-500/15 text-red-400',
  }
  const cls = styles[status] ?? 'bg-white/10 text-white/40'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  )
}

/**
 * Row tint, most-decisive state first.
 *
 * Opted out and listed are terminal, so they win over any outreach history. The
 * gray/yellow split is specifically "how far did we chase this one before the
 * silence" — both require no response, which is why responded_at is checked
 * before them: a prospect mid-conversation (awaiting_email, or yes with a
 * failed listing) is neither silent nor finished, and colouring it gray would
 * read as untouched.
 */
function rowTone(p: Prospect): string {
  if (p.status === 'optout')   return 'bg-red-500/[0.07] border-l-2 border-l-red-500/50'
  if (p.bd_listing_created)    return 'bg-green-500/[0.07] border-l-2 border-l-green-500/50'
  if (p.responded_at)          return 'border-l-2 border-l-transparent'
  if (p.follow_up_sent_at)     return 'bg-yellow-500/[0.07] border-l-2 border-l-yellow-500/50'
  if (p.contacted_at)          return 'bg-white/[0.04] border-l-2 border-l-white/25'
  return 'border-l-2 border-l-transparent'
}

const th = 'px-4 py-3 text-left text-xs font-semibold text-white/40 uppercase tracking-wider whitespace-nowrap'
const td = 'px-4 py-3 text-sm text-white/80 whitespace-nowrap'

function ProspectTable({ prospects, tab }: { prospects: Prospect[]; tab: Tab }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-dark-border">
      <table className="w-full">
        <thead className="bg-dark-lighter">
          <tr>
            <th className={th}>Business</th>
            <th className={th}>Phone</th>
            <th className={th}>Location</th>
            <th className={th}>Category</th>
            <th className={th}>Rating</th>
            <th className={th}>First Text</th>
            <th className={th}>Follow-Up</th>
            <th className={th}>Status</th>
            <th className={th}>Listed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-dark-border/50">
          {prospects.map(p => (
            <tr key={p.id} className={`hover:bg-dark-lighter/40 transition-colors ${rowTone(p)}`}>
              <td className={td}>{p.business_name ?? '—'}</td>
              <td className={`${td} text-white/60`}>{formatPhone(p.phone)}</td>
              <td className={`${td} text-white/60`}>
                {p.city ? `${p.city}, ${p.state ?? ''}`.replace(/,\s*$/, '') : '—'}
              </td>
              <td className={td}>
                {p.service_category
                  ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange/15 text-orange-light">
                      {HD_CATEGORY_LABEL[p.service_category as HdServiceCategory] ?? p.service_category}
                    </span>
                  )
                  : <span className="text-white/25">—</span>}
              </td>
              <td className={td}>
                {typeof p.rating === 'number'
                  ? <span className="text-orange-light">{p.rating.toFixed(1)}★</span>
                  : <span className="text-white/25">—</span>}
              </td>
              <td className={`${td} text-white/60`}>{fmtDate(p.contacted_at)}</td>
              <td className={`${td} text-white/60`}>{fmtDate(p.follow_up_sent_at)}</td>
              <td className={td}><StatusBadge status={p.status} /></td>
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
                No {tab.toUpperCase()} prospects yet — run a city search above
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function Legend() {
  const swatch = 'inline-block w-3 h-3 rounded-sm mr-1.5 align-middle'
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-white/40 mt-3">
      <span><i className={`${swatch} bg-white/25`} />Contacted, no response</span>
      <span><i className={`${swatch} bg-yellow-500/60`} />Follow-up sent, no response</span>
      <span><i className={`${swatch} bg-green-500/60`} />Listed</span>
      <span><i className={`${swatch} bg-red-500/60`} />Opted out</span>
    </div>
  )
}

export default async function DirectoryAgentAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; category?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || (user.id !== FOUNDER_ID && user.email?.toLowerCase() !== ADMIN_EMAIL)) {
    return notFound()
  }

  const params = await searchParams
  const tab: Tab = params.tab === 'hd' ? 'hd' : 'ld'
  const table = TABLES[tab]

  const svc = createServiceClient()

  // Only the active tab's rows are fetched; the inactive tab needs just its
  // total for the badge, which is a head-only count.
  const columns =
    'id, business_name, phone, city, state, rating, status, contacted_at, responded_at, ' +
    'follow_up_sent_at, bd_listing_created, bd_listing_url' +
    (tab === 'hd' ? ', service_category' : '')

  let listQuery = svc.from(table).select(columns).order('created_at', { ascending: false }).limit(100)
  // The HD controls' category filter writes ?category=, and it only applies to
  // the HD table — LD has no such column.
  if (tab === 'hd' && params.category) listQuery = listQuery.eq('service_category', params.category)

  const [
    { count: totalProspects },
    { count: contactedCount },
    { count: yesCount },
    { count: listingsCreated },
    { count: optOutCount },
    { count: followUpCount },
    { data: prospectsRaw },
    { count: ldTotal },
    { count: hdTotal },
  ] = await Promise.all([
    svc.from(table).select('*', { count: 'exact', head: true }),
    svc.from(table).select('*', { count: 'exact', head: true }).not('contacted_at', 'is', null),
    // Scoped to prospects we actually texted. HD's 352 bulk-imported truck
    // stops carry status='yes' without ever being contacted, and counting them
    // as replies rendered a 352% conversion rate.
    svc.from(table).select('*', { count: 'exact', head: true })
      .eq('status', 'yes').not('contacted_at', 'is', null),
    svc.from(table).select('*', { count: 'exact', head: true }).eq('bd_listing_created', true),
    svc.from(table).select('*', { count: 'exact', head: true }).eq('status', 'optout'),
    svc.from(table).select('*', { count: 'exact', head: true }).not('follow_up_sent_at', 'is', null),
    listQuery,
    svc.from(TABLES.ld).select('*', { count: 'exact', head: true }),
    svc.from(TABLES.hd).select('*', { count: 'exact', head: true }),
  ])

  const prospects = (prospectsRaw ?? []) as unknown as Prospect[]
  const contacted = contactedCount ?? 0
  const yes       = yesCount ?? 0
  // Conversion is YES over *contacted*, not over total found — prospects we
  // haven't texted yet were never given the chance to convert.
  const conversionRate = contacted > 0 ? (yes / contacted) * 100 : 0

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'ld', label: 'Light Duty', count: ldTotal ?? 0 },
    { key: 'hd', label: 'Heavy Duty', count: hdTotal ?? 0 },
  ]

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

        {/* ── Tabs ──────────────────────────────────────────────────────────── */}
        <div className="flex gap-1 border-b border-dark-border mb-6">
          {tabs.map(t => {
            const active = t.key === tab
            return (
              <Link
                key={t.key}
                href={`/admin/directory-agent?tab=${t.key}`}
                className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
                  active
                    ? 'border-orange text-white'
                    : 'border-transparent text-white/40 hover:text-white/70'
                }`}
              >
                {t.label}
                <span className={`ml-2 tabular-nums ${active ? 'text-orange' : 'text-white/25'}`}>
                  {t.count}
                </span>
              </Link>
            )
          })}
        </div>

        {/* ── Stats (scoped to the active tab) ──────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
          <StatCard label="Prospects Found" value={totalProspects ?? 0} />
          <StatCard label="SMS Sent" value={contacted} color={contacted > 0 ? 'text-blue-400' : 'text-white'} />
          <StatCard
            label="Follow-Ups Sent"
            value={followUpCount ?? 0}
            color={(followUpCount ?? 0) > 0 ? 'text-yellow-400' : 'text-white'}
          />
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

        {/* ── Manual controls, per directory ────────────────────────────────── */}
        <section className="mb-10">
          {tab === 'ld'
            ? <DirectoryAgentControls />
            : (
              <Suspense fallback={null}>
                <HdDirectoryAgentControls category={params.category ?? null} />
              </Suspense>
            )}
        </section>

        {/* ── Prospects ─────────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-white font-semibold text-lg mb-3">
            {tab === 'ld' ? 'Light Duty' : 'Heavy Duty'} Prospects ({prospects.length})
            {(totalProspects ?? 0) > prospects.length && (
              <span className="text-white/30 text-sm font-normal"> · showing latest 100 of {totalProspects}</span>
            )}
            {tab === 'hd' && params.category && (
              <span className="text-white/30 text-sm font-normal">
                {' '}· filtered to {HD_CATEGORY_LABEL[params.category as HdServiceCategory] ?? params.category}
                {' '}
                <Link href="/admin/directory-agent?tab=hd" className="text-orange hover:underline">clear</Link>
              </span>
            )}
          </h2>

          <ProspectTable prospects={prospects} tab={tab} />
          <Legend />

          <p className="text-white/25 text-xs mt-2">
            {tab === 'ld' && 'Light duty prospects have no service category — that field exists only on the HD table. '}
            A yellow &ldquo;No&rdquo; under Listed against a <em>yes</em> status means they consented but the
            Brilliant Directories call failed — retry with <code>npm run retry-listings</code>.
          </p>

          {tab === 'hd' && (
            <p className="text-white/25 text-xs mt-2">
              <Link href="/admin/hd-directory-agent" className="text-orange hover:underline">
                HD category breakdown →
              </Link>
            </p>
          )}
        </section>

      </main>
    </div>
  )
}
