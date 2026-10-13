// What is already in Stripe, and does a 100%-off coupon produce 'active' or 'trialing'?
//
// READ ONLY. Every call is a list or retrieve. NOTHING IS CREATED - no coupon, no
// promotion code, no subscription, no checkout session.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const KEY = process.env.STRIPE_SECRET_KEY

async function stripe(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  })
  const json = await res.json() as Record<string, unknown>
  if (!res.ok) {
    const e = json.error as { message?: string; type?: string } | undefined
    throw new Error(`Stripe ${res.status}: ${e?.message ?? JSON.stringify(json).slice(0, 160)}`)
  }
  return json
}

const money = (cents: unknown, cur = 'usd') =>
  cents == null ? '-' : `${cur.toUpperCase()} ${(Number(cents) / 100).toFixed(2)}`

async function main() {
  console.log('\nSTRIPE PROMO AUDIT  (read only - nothing is created)')
  console.log('='.repeat(100))

  if (!KEY) { console.log('  STRIPE_SECRET_KEY is not set. Stopping.'); process.exitCode = 1; return }
  console.log(`  key mode: ${KEY.startsWith('sk_live') ? 'LIVE' : KEY.startsWith('sk_test') ? 'TEST' : 'unknown'}`)

  // ── coupons ──────────────────────────────────────────────────────────────
  const coupons = (await stripe('coupons?limit=100')).data as Array<Record<string, unknown>>
  console.log(`\n  COUPONS (${coupons.length})`)
  if (!coupons.length) console.log('    none')
  for (const c of coupons) {
    const amount = c.percent_off ? `${c.percent_off}% off` : `${money(c.amount_off, String(c.currency ?? 'usd'))} off`
    console.log(`    ${String(c.id).padEnd(24)} ${amount.padEnd(14)} duration=${c.duration}${c.duration === 'repeating' ? ` (${c.duration_in_months} months)` : ''}`)
    console.log(`      valid=${c.valid}  times_redeemed=${c.times_redeemed}  max_redemptions=${c.max_redemptions ?? 'unlimited'}  name=${c.name ?? '-'}`)
    if (c.applies_to) console.log(`      applies_to: ${JSON.stringify(c.applies_to)}`)
  }

  // ── promotion codes ──────────────────────────────────────────────────────
  // NOTE ON THE SHAPE: this account is on a Stripe API version where a promotion code
  // links to its coupon as promotion: { coupon: "<id>", type: "coupon" } - there is no
  // top-level `coupon` field, and expand[]=data.coupon does nothing. Reading p.coupon
  // returned undefined for all four codes, which looked like missing data and was
  // actually the wrong field name.
  const promos = (await stripe('promotion_codes?limit=100')).data as Array<Record<string, unknown>>
  const couponById = new Map(coupons.map(c => [String(c.id), c]))
  console.log(`\n  PROMOTION CODES (${promos.length})`)
  if (!promos.length) console.log('    none')
  for (const p of promos) {
    const promotion = p.promotion as { coupon?: string; type?: string } | undefined
    const coupon = promotion?.coupon ? couponById.get(String(promotion.coupon)) : undefined
    const amount = coupon?.percent_off ? `${coupon.percent_off}% off` : `${money(coupon?.amount_off, String(coupon?.currency ?? 'usd'))} off`
    console.log(`    ${String(p.code).padEnd(20)} -> coupon ${String(coupon?.id).padEnd(22)} ${amount.padEnd(12)} duration=${coupon?.duration}${coupon?.duration === "repeating" ? ` (${coupon.duration_in_months} months)` : ""}  maxRedemptions=${coupon?.max_redemptions ?? "unlimited"}`)
    console.log(`      active=${p.active}  times_redeemed=${p.times_redeemed}  max_redemptions=${p.max_redemptions ?? 'unlimited'}  expires=${p.expires_at ? new Date(Number(p.expires_at) * 1000).toISOString().slice(0, 10) : 'never'}`)
    if (p.restrictions) console.log(`      restrictions: ${JSON.stringify(p.restrictions)}`)
  }

  // ── is any price carrying a trial? ───────────────────────────────────────
  // The whole premise is that nothing is trialing. Verified rather than assumed.
  const prices = (await stripe('prices?limit=100&active=true&expand[]=data.product')).data as Array<Record<string, unknown>>
  const withTrial = prices.filter(p => {
    const r = p.recurring as Record<string, unknown> | null
    return r && r.trial_period_days != null
  })
  console.log(`\n  ACTIVE PRICES (${prices.length}), of which carry trial_period_days: ${withTrial.length}`)
  for (const p of withTrial) {
    console.log(`    TRIAL ON PRICE: ${p.id}  ${JSON.stringify(p.recurring)}`)
  }
  if (!withTrial.length) console.log('    none - no price sets a trial, so nothing becomes trialing from a price')

  // ── what status do real subscriptions actually have? ─────────────────────
  const subs = (await stripe('subscriptions?limit=100&status=all&expand[]=data.discounts')).data as Array<Record<string, unknown>>
  const byStatus = new Map<string, number>()
  subs.forEach(s => byStatus.set(String(s.status), (byStatus.get(String(s.status)) ?? 0) + 1))
  console.log(`\n  SUBSCRIPTIONS (${subs.length})`)
  for (const [st, n] of [...byStatus].sort((a, b) => b[1] - a[1])) console.log(`    ${st.padEnd(20)} ${n}`)

  const trialing = subs.filter(s => s.status === 'trialing')
  console.log(`\n  trialing right now: ${trialing.length}`)
  trialing.forEach(s => console.log(`    ${s.id}  trial_end=${s.trial_end ? new Date(Number(s.trial_end) * 1000).toISOString() : '-'}`))

  // THE KEY EVIDENCE: a subscription that already carries a discount, and its status.
  const discounted = subs.filter(s => {
    const d = s.discounts as unknown[] | null
    return Array.isArray(d) && d.length > 0
  })
  console.log(`\n  SUBSCRIPTIONS CARRYING A DISCOUNT (${discounted.length})`)
  if (!discounted.length) {
    console.log('    none - so there is no live example in this account to read a status off.')
  }
  for (const s of discounted) {
    const ds = s.discounts as Array<Record<string, unknown>>
    for (const d of ds) {
      const c = d.coupon as Record<string, unknown> | undefined
      const amount = c?.percent_off ? `${c.percent_off}% off` : `${money(c?.amount_off)} off`
      console.log(`    ${String(s.id).padEnd(30)} status=${String(s.status).padEnd(10)} ${amount} duration=${c?.duration}`)
      console.log(`      trial_end=${s.trial_end ?? 'null'}  <- null means NOT a trial`)
    }
  }

  console.log('\n  NOTHING WAS CREATED OR MODIFIED.')
  console.log(`\n${'='.repeat(100)}\n`)
}

main().catch(e => { console.error(`\n  ${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 1 })
