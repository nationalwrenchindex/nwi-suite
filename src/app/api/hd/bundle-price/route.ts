// GET /api/hd/bundle-price — the live monthly price of the HD Elite + LD bundle.
//
// The other HD plan cards hardcode their dollar amounts, which quietly drift the
// moment a price changes in Stripe. The bundle reads its amount from the same
// price the checkout session charges, so the card and the invoice cannot disagree.

import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { HD_ELITE_BUNDLE_PRICE_ID } from '@/lib/hd-plans'

export const revalidate = 3600

export async function GET() {
  try {
    const price = await stripe.prices.retrieve(HD_ELITE_BUNDLE_PRICE_ID)
    if (!price.unit_amount) {
      return NextResponse.json({ amount: null, error: 'Price has no unit_amount' }, { status: 200 })
    }
    return NextResponse.json({
      amount:   price.unit_amount / 100,
      currency: price.currency,
      interval: price.recurring?.interval ?? 'month',
    })
  } catch (err) {
    // Non-fatal: the card renders without a price rather than blocking signup.
    console.error('[hd/bundle-price]', err)
    return NextResponse.json({ amount: null }, { status: 200 })
  }
}
