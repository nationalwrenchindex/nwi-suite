/**
 * National Wrench Index — Stripe product/price setup
 *
 * Run once to create your Stripe products and monthly prices.
 * Outputs the env vars to add to .env.local.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-setup.mjs
 *
 * Or if STRIPE_SECRET_KEY is already in your shell env:
 *   node scripts/stripe-setup.mjs
 */

import Stripe from 'stripe'

const key = process.env.STRIPE_SECRET_KEY
if (!key) {
  console.error('Error: STRIPE_SECRET_KEY is not set.')
  console.error('Run: STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-setup.mjs')
  process.exit(1)
}

const stripe = new Stripe(key)

const PLANS = [
  { lookupKey: 'nwi_starter_monthly',    name: 'NWI Starter',    tier: 'STARTER',    cents: 1900 },
  { lookupKey: 'nwi_pro_monthly',        name: 'NWI Pro',        tier: 'PRO',        cents: 3400 },
  { lookupKey: 'nwi_full_suite_monthly', name: 'NWI Full Suite', tier: 'FULL_SUITE', cents: 4900 },
]

console.log('\nSetting up Stripe products and prices…\n')

const envLines = []

for (const plan of PLANS) {
  // Try to find an existing price with this lookup key
  const existing = await stripe.prices.list({ lookup_keys: [plan.lookupKey], limit: 1 })

  let price
  if (existing.data.length > 0) {
    price = existing.data[0]
    console.log(`✓ Found existing price for ${plan.name}: ${price.id}`)
  } else {
    // Create product
    const product = await stripe.products.create({
      name:     plan.name,
      metadata: { nwi_tier: plan.lookupKey },
    })

    // Create price
    price = await stripe.prices.create({
      product:    product.id,
      lookup_key: plan.lookupKey,
      currency:   'usd',
      unit_amount: plan.cents,
      recurring:  { interval: 'month' },
      metadata:   { nwi_tier: plan.lookupKey },
    })

    console.log(`✓ Created ${plan.name}: ${price.id}`)
  }

  envLines.push(`STRIPE_PRICE_${plan.tier}=${price.id}`)
}

console.log('\n─────────────────────────────────────────')
console.log('Add these lines to your .env.local:\n')
envLines.forEach(l => console.log(l))
console.log('\n─────────────────────────────────────────')
console.log('\nNext: set up your Stripe webhook at:')
console.log('  https://dashboard.stripe.com/webhooks')
console.log('\nWebhook URL: https://your-domain.com/api/webhooks/stripe')
console.log('\nEvents to subscribe:')
console.log('  • checkout.session.completed')
console.log('  • customer.subscription.updated')
console.log('  • customer.subscription.deleted')
console.log('  • invoice.payment_succeeded')
console.log('  • invoice.payment_failed')
console.log('\nThen add the signing secret as:')
console.log('  STRIPE_WEBHOOK_SECRET=whsec_...\n')
