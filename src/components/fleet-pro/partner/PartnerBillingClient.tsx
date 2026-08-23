'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PartnerBillingSummary, PartnerSubscriptionRow } from '@/types/fleet-pro-partner'
import { FleetProWordmark, NWI_ORANGE } from '../brand'

const CARD   = '#111920'
const THEAD  = '#162030'
const BORDER = '#1e3040'
const AMBER  = '#F59E0B'

const MUTED  = 'rgba(255,255,255,0.4)'
const FAINT  = 'rgba(255,255,255,0.25)'

// Cents in, dollars out. The API speaks cents (Stripe's unit); nothing on this page
// does arithmetic on the result, so the conversion happens once, here.
const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)

const LIVE_STATUSES = ['active', 'trialing', 'past_due']

// past_due is amber rather than red on purpose: Stripe is still retrying and the
// customer's portal is still open, so it is a "fix your card" not a "you are cut off".
const STATUS_COLORS: Record<string, string> = {
  active:   '#22C55E',
  trialing: '#22C55E',
  past_due: AMBER,
  canceled: 'rgba(255,255,255,0.4)',
  inactive: 'rgba(255,255,255,0.4)',
}

const STATUS_LABELS: Record<string, string> = {
  active:   'Active',
  trialing: 'Trialing',
  past_due: 'Past due',
  canceled: 'Canceled',
  inactive: 'Inactive',
}

function statusColor(status: string | null): string {
  return STATUS_COLORS[status ?? ''] ?? 'rgba(255,255,255,0.4)'
}

function statusLabel(status: string | null): string {
  return STATUS_LABELS[status ?? ''] ?? 'Not subscribed'
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The soonest renewal still in the future, across every live subscription. */
function nextRenewal(rows: PartnerSubscriptionRow[]): string | null {
  const now = Date.now()
  const upcoming = rows
    .filter(r => LIVE_STATUSES.includes(r.status ?? '') && r.current_period_end)
    .map(r => new Date(r.current_period_end as string).getTime())
    .filter(t => Number.isFinite(t) && t >= now)
    .sort((a, b) => a - b)
  return upcoming.length > 0 ? new Date(upcoming[0]).toISOString() : null
}

// ─── Pills ────────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string | null }) {
  const color = statusColor(status)
  return (
    <span
      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap"
      style={{ background: `${color}20`, color }}
    >
      {statusLabel(status)}
    </span>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PartnerBillingClient() {
  const [summary, setSummary] = useState<PartnerBillingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  // Which fleet's subscribe button is mid-redirect. Keyed by id so nine buttons do
  // not all spin when one is clicked.
  const [starting, setStarting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/fleet-pro/partner/billing')
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Could not load billing.')
      setSummary(json.summary as PartnerBillingSummary)
    } catch (err) {
      setSummary(null)
      setError(err instanceof Error ? err.message : 'Could not load billing.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function startSubscription(fleetAccountId: string) {
    setStarting(fleetAccountId)
    setError(null)
    try {
      const res = await fetch('/api/fleet-pro/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        // source tells the route to send Stripe back here rather than to the HD
        // fleet-account page the mechanic-side button uses.
        body:    JSON.stringify({ fleet_account_id: fleetAccountId, source: 'partner' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.url) throw new Error(json?.error || 'Could not start checkout.')
      window.location.href = json.url as string
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout.')
      setStarting(null)
    }
  }

  const rows       = summary?.subscriptions ?? []
  const configured = summary?.price_configured === true
  const renewal    = nextRenewal(rows)

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <FleetProWordmark className="block text-xs uppercase tracking-widest mb-1 font-semibold" />
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">BILLING</h1>
        <p className="text-sm mt-1" style={{ color: MUTED }}>
          One subscription per fleet account you resell, billed to your card.
        </p>
      </div>

      {/* The price genuinely does not exist in Stripe yet, so this is stated plainly
          rather than hidden behind a disabled button that would only 503. */}
      {summary && !configured && (
        <div
          className="rounded-xl p-4 flex items-start gap-3"
          style={{ background: `${AMBER}20`, border: `1px solid ${AMBER}` }}
        >
          <span className="text-lg leading-none mt-0.5" aria-hidden>⚠</span>
          <div>
            <p className="text-sm font-semibold" style={{ color: AMBER }}>
              Fleet Pro billing is not configured yet
            </p>
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
              The $299/mo Fleet Pro price must be created in Stripe and its price id set as
              <span className="font-mono"> STRIPE_PRICE_FLEET_PRO</span>. Until then no fleet can be
              subscribed and the totals below show what you would be billed, not what you are.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl p-4" style={{ background: CARD, border: '1px solid #7f1d1d' }}>
          <p className="text-sm" style={{ color: '#F87171' }}>{error}</p>
        </div>
      )}

      {loading && (
        <div className="rounded-xl p-8 text-center" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <p className="text-sm" style={{ color: MUTED }}>Loading billing…</p>
        </div>
      )}

      {summary && !loading && (
        <>
          {/* ── Summary tiles ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl p-4" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
              <p className="text-xs uppercase tracking-wider mb-1" style={{ color: MUTED }}>
                Active Subscriptions
              </p>
              <p className="font-condensed font-bold text-xl tabular-nums text-white">
                {summary.active_count} of {rows.length}
              </p>
            </div>

            <div className="rounded-xl p-4" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
              <p className="text-xs uppercase tracking-wider mb-1" style={{ color: MUTED }}>
                Monthly Total
              </p>
              <p className="font-condensed font-bold text-xl tabular-nums" style={{ color: NWI_ORANGE }}>
                {money(summary.monthly_total_cents)}
              </p>
            </div>

            <div className="rounded-xl p-4" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
              <p className="text-xs uppercase tracking-wider mb-1" style={{ color: MUTED }}>
                Next Renewal
              </p>
              <p className="font-condensed font-bold text-xl text-white" suppressHydrationWarning>
                {fmtDate(renewal)}
              </p>
            </div>
          </div>

          {/* ── Per-fleet subscriptions ── */}
          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]" style={{ background: CARD }}>
                <thead style={{ background: THEAD }}>
                  <tr>
                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: MUTED }}>
                      Fleet
                    </th>
                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: MUTED }}>
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: MUTED }}>
                      Subscription
                    </th>
                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: MUTED }}>
                      Renews
                    </th>
                    <th className="px-4 py-3 text-right text-xs uppercase tracking-wider" style={{ color: MUTED }}>
                      $/mo
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm" style={{ color: MUTED }}>
                        No fleet accounts yet. Add one to start reselling Fleet Pro.
                      </td>
                    </tr>
                  )}

                  {rows.map(row => {
                    const live = LIVE_STATUSES.includes(row.status ?? '')
                    return (
                      <tr key={row.fleet_account_id} style={{ borderTop: `1px solid ${BORDER}` }}>
                        <td className="px-4 py-3 text-sm text-white">{row.fleet_name}</td>

                        <td className="px-4 py-3">
                          <StatusPill status={row.status} />
                        </td>

                        <td
                          className="px-4 py-3 text-xs font-mono whitespace-nowrap"
                          style={{ color: row.stripe_subscription_id ? 'rgba(255,255,255,0.6)' : FAINT }}
                        >
                          {row.stripe_subscription_id ?? '—'}
                        </td>

                        <td
                          className="px-4 py-3 text-sm whitespace-nowrap"
                          style={{ color: live ? 'rgba(255,255,255,0.85)' : FAINT }}
                          suppressHydrationWarning
                        >
                          {live ? fmtDate(row.current_period_end) : '—'}
                        </td>

                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {live ? (
                            <span className="text-sm tabular-nums text-white">{money(row.monthly_cents)}</span>
                          ) : (
                            <button
                              onClick={() => startSubscription(row.fleet_account_id)}
                              disabled={!configured || starting !== null}
                              title={configured
                                ? `Subscribe ${row.fleet_name} at ${money(row.monthly_cents)}/mo`
                                : 'Fleet Pro billing is not configured yet'}
                              className="px-3 py-2 rounded-lg text-xs font-semibold text-white whitespace-nowrap"
                              style={{
                                background: NWI_ORANGE,
                                opacity:    !configured || starting !== null ? 0.4 : 1,
                                cursor:     !configured ? 'not-allowed' : undefined,
                              }}
                            >
                              {starting === row.fleet_account_id ? 'Starting…' : 'Start subscription'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>

                <tfoot style={{ background: THEAD }}>
                  <tr>
                    <td className="px-4 py-3 text-xs uppercase tracking-wider" style={{ color: MUTED }}>
                      Monthly Total
                    </td>
                    <td colSpan={3} className="px-4 py-3 text-xs" style={{ color: FAINT }}>
                      {summary.active_count} billed {summary.active_count === 1 ? 'fleet' : 'fleets'}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-bold tabular-nums" style={{ color: NWI_ORANGE }}>
                      {money(summary.monthly_total_cents)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <p className="text-xs" style={{ color: FAINT }}>
            Fleets marked past due keep their portal open while Stripe retries the payment, and are
            still counted in the total.
            {summary.stripe_customer_id
              ? ' All of your fleet subscriptions bill to one Stripe customer, so a single card covers every account.'
              : ' Your first subscription creates the Stripe customer that every later fleet will bill to.'}
          </p>
        </>
      )}
    </div>
  )
}
