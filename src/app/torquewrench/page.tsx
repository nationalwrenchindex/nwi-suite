import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { hasTorqueWrenchAccess } from '@/lib/subscription'
import AppNav from '@/components/layout/AppNav'

export const metadata = { title: 'TorqueWrench' }

function statusBadge(status: string, reviewLeft: boolean) {
  if (reviewLeft)         return { label: 'Review Left',  cls: 'text-success border-success/30 bg-success/10' }
  if (status === 'sent')  return { label: 'Sent',         cls: 'text-blue-light border-blue/30 bg-blue/10' }
  if (status === 'pending') return { label: 'Pending',    cls: 'text-white/30 border-white/10 bg-white/5' }
  return { label: status.charAt(0).toUpperCase() + status.slice(1), cls: 'text-white/30 border-white/10 bg-white/5' }
}

export default async function TorqueWrenchPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, business_type, foreman_addon_active, torquewrench_addon_active')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  const torquewrenchActive = await hasTorqueWrenchAccess(user.id)
  if (!torquewrenchActive) redirect('/settings/torquewrench')

  const [
    { data: twSettings },
    { count: totalRequested },
    { count: totalLeft },
    { data: ratings },
    { data: recentActivity },
  ] = await Promise.all([
    supabase.from('torquewrench_settings').select('*').eq('user_id', user.id).single(),
    supabase.from('torquewrench_reviews').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    supabase.from('torquewrench_reviews').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('review_left', true),
    supabase.from('torquewrench_reviews').select('rating').eq('user_id', user.id).not('rating', 'is', null),
    supabase.from('torquewrench_reviews').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(10),
  ])

  const isOn = twSettings?.is_enabled ?? false

  const avgRating = ratings && ratings.length > 0
    ? (ratings.reduce((sum, r) => sum + (r.rating ?? 0), 0) / ratings.length).toFixed(1)
    : null

  const responseRate = (totalRequested ?? 0) > 0
    ? Math.round(((totalLeft ?? 0) / (totalRequested ?? 1)) * 100)
    : null

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav
        businessName={profile.business_name}
        businessType={profile.business_type ?? undefined}
        foremanActive={profile.foreman_addon_active ?? false}
        torquewrenchActive={true}
      />
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-orange/15 border border-orange/30 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-orange" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </div>
              <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">TorqueWrench</h1>
            </div>
            <p className="text-white/40 text-sm">Automatic Google review collection</p>
          </div>

          {/* Status indicator */}
          <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border ${
            isOn
              ? 'border-success/30 bg-success/5'
              : 'border-dark-border bg-dark-lighter'
          }`}>
            <span className="relative flex items-center">
              <span className={`w-2.5 h-2.5 rounded-full ${isOn ? 'bg-success' : 'bg-white/20'}`} />
              {isOn && (
                <span className="absolute inset-0 rounded-full bg-success animate-ping opacity-60" />
              )}
            </span>
            <span className={`text-sm font-medium ${isOn ? 'text-success' : 'text-white/30'}`}>
              {isOn ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>

        {/* ── Stats row ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            {
              label: 'Reviews requested',
              value: String(totalRequested ?? 0),
              accent: 'orange',
              icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
              ),
            },
            {
              label: 'Reviews left',
              value: String(totalLeft ?? 0),
              accent: 'success',
              icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              ),
            },
            {
              label: 'Avg rating',
              value: avgRating ? `${avgRating} ★` : '—',
              accent: 'blue',
              icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              ),
            },
            {
              label: 'Response rate',
              value: responseRate !== null ? `${responseRate}%` : '—',
              accent: 'muted',
              icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              ),
            },
          ].map(card => {
            const accentMap: Record<string, string> = {
              orange:  'text-orange  border-orange/20',
              success: 'text-success border-success/20',
              blue:    'text-blue-light border-blue/20',
              muted:   'text-white/40 border-white/10',
            }
            const cls = accentMap[card.accent] ?? accentMap.muted
            return (
              <div key={card.label} className={`nwi-card border ${cls.split(' ')[1]}`}>
                <div className={`mb-2 ${cls.split(' ')[0]}`}>{card.icon}</div>
                <p className={`font-condensed font-bold text-2xl ${cls.split(' ')[0]}`}>{card.value}</p>
                <p className="text-white/40 text-xs mt-0.5">{card.label}</p>
              </div>
            )
          })}
        </div>

        {/* ── Google Place ID prompt (if not configured) ── */}
        {!twSettings?.google_place_id && (
          <div className="nwi-card border-orange/20 bg-orange/5 mb-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-white/80 text-sm font-medium">Google Place ID not set</p>
                <p className="text-white/40 text-xs mt-0.5">Add your Place ID in Settings to start collecting reviews.</p>
              </div>
              <Link
                href="/settings/torquewrench"
                className="px-5 py-2.5 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm rounded-xl transition-colors active:scale-95 min-h-[44px] flex items-center whitespace-nowrap"
              >
                Configure
              </Link>
            </div>
          </div>
        )}

        {/* ── Recent activity ── */}
        <div className="nwi-card mb-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="text-white/40 text-xs uppercase tracking-widest">Recent Activity</p>
            {(recentActivity?.length ?? 0) > 0 && (
              <span className="text-white/30 text-xs">{recentActivity!.length} request{recentActivity!.length !== 1 ? 's' : ''}</span>
            )}
          </div>

          {!recentActivity || recentActivity.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="w-12 h-12 rounded-full bg-dark-lighter border border-dark-border flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-white/20" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </div>
              <p className="text-white/50 text-sm font-medium">No review requests yet</p>
              <p className="text-white/25 text-xs mt-1 max-w-xs">
                Once TorqueWrench is live and jobs close, every review request appears here with full status tracking.
              </p>
            </div>
          ) : (
            <div className="space-y-0">
              {recentActivity.map((rev, i) => {
                const badge = statusBadge(
                  (rev as Record<string, unknown>).status as string ?? 'pending',
                  (rev as Record<string, unknown>).review_left as boolean ?? false,
                )
                return (
                  <div
                    key={(rev as Record<string, unknown>).id as string}
                    className={`py-3 flex items-start gap-3 ${i < recentActivity.length - 1 ? 'border-b border-dark-border' : ''}`}
                  >
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                      (rev as Record<string, unknown>).review_left ? 'bg-success' : 'bg-white/20'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-white/80 text-sm font-medium truncate">
                        {(rev as Record<string, unknown>).customer_name as string ?? 'Unknown customer'}
                      </p>
                      <p className="text-white/30 text-xs">
                        {(rev as Record<string, unknown>).customer_phone as string ?? '—'}
                        {(rev as Record<string, unknown>).service_type ? ` · ${(rev as Record<string, unknown>).service_type as string}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className={`text-[10px] font-semibold border px-2 py-0.5 rounded-full whitespace-nowrap ${badge.cls}`}>
                        {badge.label}
                      </span>
                      {(rev as Record<string, unknown>).rating !== null && (rev as Record<string, unknown>).rating !== undefined && (
                        <span className="text-[10px] text-white/25">
                          {(rev as Record<string, unknown>).rating as number} ★
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Enable CTA (shown only when off) ── */}
        {!isOn && (
          <div className="nwi-card border-orange/20 bg-orange/5 mb-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-white/80 text-sm font-medium">TorqueWrench is currently OFF</p>
                <p className="text-white/40 text-xs mt-0.5">Enable it in Settings to start collecting reviews.</p>
              </div>
              <Link
                href="/settings/torquewrench"
                className="px-5 py-2.5 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm rounded-xl transition-colors active:scale-95 min-h-[44px] flex items-center whitespace-nowrap"
              >
                Enable Now
              </Link>
            </div>
          </div>
        )}

        {/* ── Configure link ── */}
        <div className="flex justify-start">
          <Link
            href="/settings/torquewrench"
            className="flex items-center gap-2 px-5 py-3 rounded-xl border border-dark-border hover:border-orange/40 hover:bg-orange/5 text-white/50 hover:text-orange text-sm font-medium transition-colors min-h-[48px]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            Configure TorqueWrench
          </Link>
        </div>

      </main>
    </div>
  )
}
