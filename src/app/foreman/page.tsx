import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { hasForemanAccess } from '@/lib/subscription'
import AppNav from '@/components/layout/AppNav'
import ForemanProvisionButton from '@/components/foreman/ForemanProvisionButton'

export const metadata = { title: 'Foreman' }

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

export default async function ForemanPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, business_type, foreman_addon_active')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  const foremanActive = profile?.foreman_addon_active ?? false
  if (!foremanActive) redirect('/settings/foreman')

  const hasAccess = await hasForemanAccess(user.id)
  if (!hasAccess) redirect('/settings/foreman')

  // Fetch foreman settings and call stats in parallel
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const [
    { data: foremanSettings },
    { data: callsThisMonth,   count: totalCallsThisMonth },
    { data: bookedThisMonth,  count: totalBookedThisMonth },
    { data: recentCalls },
  ] = await Promise.all([
    supabase.from('foreman_settings').select('*').eq('user_id', user.id).single(),
    supabase.from('foreman_calls').select('call_duration_seconds', { count: 'exact' })
      .eq('user_id', user.id)
      .gte('created_at', monthStart.toISOString()),
    supabase.from('foreman_calls').select('id', { count: 'exact' })
      .eq('user_id', user.id)
      .eq('appointment_booked', true)
      .gte('created_at', monthStart.toISOString()),
    supabase.from('foreman_calls').select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const isOn   = foremanSettings?.is_enabled ?? false
  const reason = foremanSettings?.foreman_activated_reason as string | null ?? null
  const reasonLabel: Record<string, string> = {
    on_job:      'On Job',
    after_hours: 'After Hours',
    manual:      'Manual',
  }
  const activeLabel = reason && reasonLabel[reason] ? reasonLabel[reason] : isOn ? 'Active' : 'Standby'

  const totalSeconds = (callsThisMonth ?? []).reduce(
    (sum, c) => sum + (c.call_duration_seconds ?? 0), 0,
  )
  const avgSeconds = totalCallsThisMonth
    ? Math.round(totalSeconds / totalCallsThisMonth)
    : null

  // Most common booked service from recent calls
  const serviceCounts = (recentCalls ?? []).reduce<Record<string, number>>((acc, c) => {
    const s = (c as Record<string, unknown>).service_type as string | null
    if (s) acc[s] = (acc[s] ?? 0) + 1
    return acc
  }, {})
  const mostCommonService = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav
        businessName={profile.business_name}
        businessType={profile.business_type ?? undefined}
        foremanActive={true}
      />
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-orange/15 border border-orange/30 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-orange" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
              </div>
              <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">Foreman</h1>
            </div>
            <p className="text-white/40 text-sm">Your AI virtual receptionist</p>
          </div>

          {/* Status indicator */}
          <div className={`flex flex-col items-end gap-1 px-4 py-2 rounded-xl border ${
            isOn
              ? 'border-success/30 bg-success/5'
              : 'border-dark-border bg-dark-lighter'
          }`}>
            <div className="flex items-center gap-2">
              <span className="relative flex items-center">
                <span className={`w-2.5 h-2.5 rounded-full ${isOn ? 'bg-success' : 'bg-white/20'}`} />
                {isOn && (
                  <span className="absolute inset-0 rounded-full bg-success animate-ping opacity-60" />
                )}
              </span>
              <span className={`text-sm font-semibold ${isOn ? 'text-success' : 'text-white/30'}`}>
                {isOn ? 'ACTIVE' : 'STANDBY'}
              </span>
            </div>
            {isOn && reason && (
              <span className="text-[10px] text-success/60 font-medium uppercase tracking-wider">
                {activeLabel}
              </span>
            )}
          </div>
        </div>

        {/* ── Stats row ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            {
              label: 'Calls this month',
              value: String(totalCallsThisMonth ?? 0),
              accent: 'orange',
              icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
              ),
            },
            {
              label: 'Jobs booked',
              value: String(totalBookedThisMonth ?? 0),
              accent: 'success',
              icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              ),
            },
            {
              label: 'Avg call duration',
              value: formatDuration(avgSeconds),
              accent: 'blue',
              icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              ),
            },
            {
              label: 'Most common service',
              value: mostCommonService ?? '—',
              accent: 'muted',
              icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                </svg>
              ),
            },
          ].map(card => {
            const accentMap: Record<string, string> = {
              orange: 'text-orange  border-orange/20',
              success: 'text-success border-success/20',
              blue:   'text-blue-light border-blue/20',
              muted:  'text-white/40 border-white/10',
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

        {/* ── Phone number card ── */}
        <div className="nwi-card border-orange/20 mb-6">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-3">Foreman Phone Number</p>
          {foremanSettings?.phone_number ? (
            <>
              <p className="font-condensed font-bold text-4xl text-orange tracking-widest mb-3">
                {foremanSettings.phone_number}
              </p>
              <p className="text-white/40 text-sm">
                Forward your business calls here. Foreman answers when you can&apos;t.
              </p>
            </>
          ) : (
            <ForemanProvisionButton />
          )}
        </div>

        {/* ── Recent calls ── */}
        <div className="nwi-card mb-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="text-white/40 text-xs uppercase tracking-widest">Recent Activity</p>
            {(recentCalls?.length ?? 0) > 0 && (
              <span className="text-white/30 text-xs">{recentCalls!.length} call{recentCalls!.length !== 1 ? 's' : ''}</span>
            )}
          </div>

          {!recentCalls || recentCalls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="w-12 h-12 rounded-full bg-dark-lighter border border-dark-border flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-white/20" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
              </div>
              <p className="text-white/50 text-sm font-medium">No calls yet</p>
              <p className="text-white/25 text-xs mt-1 max-w-xs">
                Once your Foreman number is live, every call appears here with a full summary and transcript.
              </p>
            </div>
          ) : (
            <div className="space-y-0">
              {recentCalls.map((call, i) => (
                <div
                  key={call.id}
                  className={`py-3 flex items-start gap-3 ${i < recentCalls.length - 1 ? 'border-b border-dark-border' : ''}`}
                >
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${call.appointment_booked ? 'bg-success' : 'bg-white/20'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-white/80 text-sm font-medium truncate">{call.caller_name ?? 'Unknown caller'}</p>
                    <p className="text-white/30 text-xs">{call.caller_phone ?? '—'} · {formatDuration(call.call_duration_seconds)}</p>
                    {call.call_summary && (
                      <p className="text-white/50 text-xs mt-0.5 line-clamp-2">{call.call_summary}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {call.appointment_booked ? (
                      <span className="text-[10px] font-semibold text-success border border-success/30 bg-success/10 px-2 py-0.5 rounded-full whitespace-nowrap">
                        Booked
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold text-white/30 border border-white/10 bg-white/5 px-2 py-0.5 rounded-full whitespace-nowrap">
                        No booking
                      </span>
                    )}
                    {typeof (call as Record<string, unknown>).service_type === 'string' && (
                      <span className="text-[10px] text-white/25 whitespace-nowrap">
                        {String((call as Record<string, unknown>).service_type)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Enable Foreman CTA (shown only when off) ── */}
        {!isOn && (
          <div className="nwi-card border-orange/20 bg-orange/5 mb-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-white/80 text-sm font-medium">Foreman is currently OFF</p>
                <p className="text-white/40 text-xs mt-0.5">Enable it in Settings to start answering calls.</p>
              </div>
              <Link
                href="/settings/foreman"
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
            href="/settings/foreman"
            className="flex items-center gap-2 px-5 py-3 rounded-xl border border-dark-border hover:border-orange/40 hover:bg-orange/5 text-white/50 hover:text-orange text-sm font-medium transition-colors min-h-[48px]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            Configure Foreman
          </Link>
        </div>

      </main>
    </div>
  )
}
