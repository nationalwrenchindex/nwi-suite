// The Stripe side of a trial's history check - one place for LD and HD checkouts.
// Moved unchanged out of /api/stripe/checkout so /api/hd/checkout applies the same
// once-per-customer rule (src/lib/ld-trial.ts decides; these only gather the facts).

import { stripe } from '@/lib/stripe'

// Subscriptions of ANY status (cancelled included) across these Stripe customers.
// null when Stripe cannot be read - the trial rules treat that as "has history".
export async function countStripeSubscriptions(customerIds: string[]): Promise<number | null> {
  try {
    let n = 0
    for (const customer of customerIds) {
      const subs = await stripe.subscriptions.list({ customer, status: 'all', limit: 1 })
      n += subs.data.length
    }
    return n
  } catch (err) {
    console.error('[trial-history] subscription history lookup failed:', err)
    return null
  }
}

// Other Stripe customers with the same email: catches cancel-then-sign-up-again on a
// new NWI account with the same address. A different email cannot be caught here.
export async function countSameEmailSubscriptions(email: string | null, exclude: string | undefined): Promise<number | null> {
  if (!email) return 0
  try {
    const customers = await stripe.customers.list({ email, limit: 20 })
    return countStripeSubscriptions(customers.data.map(c => c.id).filter(id => id !== exclude))
  } catch (err) {
    console.error('[trial-history] same-email lookup failed:', err)
    return null
  }
}
