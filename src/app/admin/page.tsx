import { notFound } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import AppNav from '@/components/layout/AppNav'
import CompAccountForm from '@/components/admin/CompAccountForm'
import CachedDiagnosticsManager, { type CachedEntry } from '@/components/admin/CachedDiagnosticsManager'
import Link from 'next/link'
import { PLANS, TIER_MODULES } from '@/lib/stripe-plans'
import type { PlanTier } from '@/lib/stripe-plans'
import { FOREMAN_SUBSCRIBER_CAP } from '@/lib/foreman/config'

const FOUNDER_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

export const metadata = { title: 'Admin — LawnPlatform' }

const TIER_PRICE = Object.fromEntries(PLANS.map(p => [p.tier, p.price]))
const TIER_LABEL: Record<string, string> = {
  starter:            'Starter ($19)',
  pro:                'Pro ($34)',
  full_suite:         'Full Suite ($49)',
  full_suite_plus:    'Full Suite Plus ($99)',
  elite:              'Elite ($159)',
  foreman_standalone: 'Foreman Standalone ($59)',
  quickwrench:        'QuickWrench ($69)',
}

type Profile = {
  id: string
  full_name: string | null
  email: string | null
  business_type: string | null
  created_at: string
}

type Subscription = {
  user_id: string
  tier: PlanTier | null
  status: string | null
  stripe_subscription_id: string | null
  current_period_end: string | null
  is_comped: boolean
  vertical: string | null
}

const getAdminData = unstable_cache(
  async (): Promise<{
    profiles:          Profile[]
    subscriptions:     Subscription[]
    foremanCount:      number
    waitlistCount:     number
  }> => {
    const svc = createServiceClient()
    const [
      { data: profiles },
      { data: subscriptions },
      { count: foremanCount },
      { count: waitlistCount },
    ] = await Promise.all([
      svc
        .from('profiles')
        .select('id, full_name, email, business_type, created_at')
        .order('created_at', { ascending: false }),
      svc
        .from('subscriptions')
        .select('user_id, tier, status, stripe_subscription_id, current_period_end, is_comped, vertical'),
      svc
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('foreman_addon_active', true),
      svc
        .from('foreman_waitlist')
        .select('*', { count: 'exact', head: true }),
    ])
    return {
      profiles:      (profiles ?? []) as Profile[],
      subscriptions: (subscriptions ?? []) as Subscription[],
      foremanCount:  foremanCount ?? 0,
      waitlistCount: waitlistCount ?? 0,
    }
  },
  ['admin-dashboard'],
  { revalidate: 30 },
)

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day:   'numeric',
    year:  'numeric',
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

type AccountType = 'Detailer' | 'Detailer + QW' | 'Mechanic' | 'Mechanic + QW' | 'QuickWrench' | null

function getAccountType(businessType: string | null, tier: PlanTier | null): AccountType {
  const hasQW = tier ? (TIER_MODULES[tier]?.includes('quickwrench') ?? false) : false
  if (businessType === 'detailer') return hasQW ? 'Detailer + QW' : 'Detailer'
  if (businessType === 'mechanic') return hasQW ? 'Mechanic + QW' : 'Mechanic'
  return null
}

function TypeBadge({ accountType }: { accountType: AccountType }) {
  if (!accountType) return <span className="text-white/25">—</span>
  const styles: Record<string, string> = {
    'Detailer':      'bg-blue-500/15 text-blue-400',
    'Detailer + QW': 'bg-purple-500/15 text-purple-400',
    'Mechanic':      'bg-orange/20 text-orange-light',
    'Mechanic + QW': 'bg-purple-500/15 text-purple-400',
    'QuickWrench':   'bg-green-500/15 text-green-400',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[accountType]}`}>
      {accountType}
    </span>
  )
}

function StatusBadge({ status }: { status: string | null }) {
  const styles: Record<string, string> = {
    active:   'bg-green-500/15 text-green-400',
    trialing: 'bg-blue-500/15 text-blue-400',
    canceled: 'bg-red-500/15 text-red-400',
    past_due: 'bg-yellow-500/15 text-yellow-400',
  }
  const cls = (status && styles[status]) || 'bg-white/10 text-white/40'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status ?? 'no sub'}
    </span>
  )
}

function VerticalBadge({ vertical }: { vertical: string | null }) {
  if (!vertical || vertical === 'light_duty') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-white/10 text-white/40">LD</span>
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/15 text-blue-400">HD</span>
}

export default async function AdminPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || user.id !== FOUNDER_ID) return notFound()

  const { profiles, subscriptions, foremanCount, waitlistCount } = await getAdminData()

  // Cached diagnostics — fetched fresh (not cached) so corrections/deletes show
  // immediately. Founder gate above already protects this read.
  const { data: cachedRaw } = await createServiceClient()
    .from('hd_cached_diagnostics')
    .select('id, cache_key, manufacturer, alarm_code, unit_model, engine_brand, engine_model, spn, fmi, result_html, source, search_count, created_at, last_accessed, needs_review, reviewed_at, reviewed_by, citations, expires_at')
    .order('search_count', { ascending: false })
    .limit(500)
  const cachedEntries = (cachedRaw ?? []) as CachedEntry[]

  const subMap = new Map(subscriptions.map(s => [s.user_id, s]))

  const nonFounderProfiles = profiles.filter(p => p.id !== FOUNDER_ID)

  const activePaying = subscriptions.filter(
    s => s.status === 'active' && s.stripe_subscription_id,
  ).length

  const trialing = subscriptions.filter(s => s.status === 'trialing').length

  const mrr = subscriptions
    .filter(s => s.status === 'active' && s.stripe_subscription_id)
    .reduce((sum, s) => sum + (s.tier ? (TIER_PRICE[s.tier] ?? 0) : 0), 0)

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const abandonedCarts = nonFounderProfiles.filter(p => {
    if (p.created_at > oneHourAgo) return false
    const sub = subMap.get(p.id)
    if (!sub) return true
    return !['active', 'trialing'].includes(sub.status ?? '')
  })

  const th = 'px-4 py-3 text-left text-xs font-semibold text-white/40 uppercase tracking-wider whitespace-nowrap'
  const td = 'px-4 py-3 text-sm text-white/80 whitespace-nowrap'

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav businessName="NWI Admin" businessType={undefined} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">

        <div className="mb-6">
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
            ADMIN DASHBOARD
          </h1>
          <p className="text-white/40 text-sm">Founder view · refreshes every 30s</p>
        </div>

        {/* ── Stats ─────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
          <StatCard label="Total Signups" value={nonFounderProfiles.length} />
          <StatCard
            label="Active Paying"
            value={activePaying}
            color={activePaying > 0 ? 'text-green-400' : 'text-white'}
          />
          <StatCard
            label="Trialing"
            value={trialing}
            color={trialing > 0 ? 'text-blue-400' : 'text-white'}
          />
          <StatCard
            label="MRR"
            value={`$${(mrr / 100).toFixed(0)}`}
            color={mrr > 0 ? 'text-green-400' : 'text-white'}
          />
          <StatCard
            label="Abandoned Carts"
            value={abandonedCarts.length}
            color={abandonedCarts.length > 0 ? 'text-yellow-400' : 'text-white'}
          />
        </div>

        {/* ── Foreman add-on stats ────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-10">
          <div className="bg-dark-card border border-orange/20 rounded-xl px-4 py-5">
            <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Foreman Slots</p>
            <p className="text-2xl font-bold tabular-nums text-orange">
              {foremanCount} <span className="text-white/30 text-base font-normal">/ {FOREMAN_SUBSCRIBER_CAP}</span>
            </p>
            <div className="mt-2 h-1.5 bg-dark-border rounded-full overflow-hidden">
              <div
                className="h-full bg-orange rounded-full transition-all"
                style={{ width: `${Math.min((foremanCount / FOREMAN_SUBSCRIBER_CAP) * 100, 100)}%` }}
              />
            </div>
            <p className="text-white/25 text-xs mt-1">{FOREMAN_SUBSCRIBER_CAP - foremanCount} slots remaining</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl px-4 py-5">
            <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Foreman Waitlist</p>
            <p className={`text-2xl font-bold tabular-nums ${waitlistCount > 0 ? 'text-yellow-400' : 'text-white'}`}>
              {waitlistCount}
            </p>
            <p className="text-white/25 text-xs mt-1">Waiting for a slot</p>
          </div>
          <div className="bg-dark-card border border-dark-border rounded-xl px-4 py-5">
            <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Foreman MRR</p>
            <p className={`text-2xl font-bold tabular-nums ${foremanCount > 0 ? 'text-green-400' : 'text-white'}`}>
              ${((foremanCount * 5900) / 100).toFixed(0)}
            </p>
            <Link href="/admin/foreman" className="text-orange text-xs hover:underline mt-1 block">
              View details →
            </Link>
          </div>
        </div>

        {/* ── Signups table ─────────────────────────────────────────────────── */}
        <section className="mb-10">
          <h2 className="text-white font-semibold text-lg mb-3">
            All Signups ({nonFounderProfiles.length})
          </h2>
          <div className="overflow-x-auto rounded-xl border border-dark-border">
            <table className="w-full">
              <thead className="bg-dark-lighter">
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Email</th>
                  <th className={th}>Plan</th>
                  <th className={th}>Vertical</th>
                  <th className={th}>Type</th>
                  <th className={th}>Status</th>
                  <th className={th}>Trial End</th>
                  <th className={th}>MRR</th>
                  <th className={th}>Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-border/50">
                {nonFounderProfiles.map(p => {
                  const sub = subMap.get(p.id)
                  const tierLabel = sub?.tier ? (TIER_LABEL[sub.tier] ?? sub.tier) : '—'
                  const mrrCents =
                    sub?.status === 'active' && sub.stripe_subscription_id && sub.tier
                      ? (TIER_PRICE[sub.tier] ?? 0)
                      : 0
                  return (
                    <tr key={p.id} className="hover:bg-dark-lighter/40 transition-colors">
                      <td className={td}>{p.full_name ?? '—'}</td>
                      <td className={`${td} text-white/60`}>{p.email ?? '—'}</td>
                      <td className={td}>{tierLabel}</td>
                      <td className={td}>
                        <VerticalBadge vertical={sub?.vertical ?? null} />
                      </td>
                      <td className={td}>
                        <TypeBadge accountType={getAccountType(p.business_type, sub?.tier ?? null)} />
                      </td>
                      <td className={td}>
                        <StatusBadge status={sub?.status ?? null} />
                        {sub?.is_comped && (
                          <span className="ml-1.5 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange/20 text-orange-light">
                            COMPED
                          </span>
                        )}
                      </td>
                      <td className={`${td} text-white/60`}>
                        {sub?.current_period_end ? fmtDate(sub.current_period_end) : '—'}
                      </td>
                      <td className={td}>
                        {mrrCents > 0 ? (
                          <span className="text-green-400 font-medium">
                            ${(mrrCents / 100).toFixed(0)}/mo
                          </span>
                        ) : (
                          <span className="text-white/25">—</span>
                        )}
                      </td>
                      <td className={`${td} text-white/60`}>{daysSince(p.created_at)}d</td>
                    </tr>
                  )
                })}
                {nonFounderProfiles.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-white/30 text-sm">
                      No signups yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Grant comp account ────────────────────────────────────────────── */}
        <section className="mb-10">
          <CompAccountForm />
        </section>

        {/* ── Cached diagnostics review/correct ──────────────────────────────── */}
        <CachedDiagnosticsManager entries={cachedEntries} />

        {/* ── Abandoned carts table ─────────────────────────────────────────── */}
        <section>
          <h2 className="text-white font-semibold text-lg mb-3">
            Abandoned Carts ({abandonedCarts.length})
          </h2>
          <div className="overflow-x-auto rounded-xl border border-dark-border">
            <table className="w-full">
              <thead className="bg-dark-lighter">
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Email</th>
                  <th className={th}>Plan Attempted</th>
                  <th className={th}>Type</th>
                  <th className={th}>Signed Up</th>
                  <th className={th}>Days Since</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-border/50">
                {abandonedCarts.map(p => {
                  const sub = subMap.get(p.id)
                  return (
                    <tr key={p.id} className="hover:bg-dark-lighter/40 transition-colors">
                      <td className={td}>{p.full_name ?? '—'}</td>
                      <td className={`${td} text-white/60`}>{p.email ?? '—'}</td>
                      <td className={td}>
                        {sub?.tier ? (TIER_LABEL[sub.tier] ?? sub.tier) : '—'}
                      </td>
                      <td className={td}>
                        <TypeBadge accountType={getAccountType(p.business_type, sub?.tier ?? null)} />
                      </td>
                      <td className={`${td} text-white/60`}>{fmtDate(p.created_at)}</td>
                      <td className={`${td} text-yellow-400/80`}>{daysSince(p.created_at)}d</td>
                    </tr>
                  )
                })}
                {abandonedCarts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-white/30 text-sm">
                      No abandoned carts
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
