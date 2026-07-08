// One-time charge for a parts delivery, billed to the customer's default card on
// file (off-session). Uses the shared Stripe singleton. This is the first
// one-time / PaymentIntent charge in the codebase — all other Stripe usage is
// subscription-mode.

import { stripe } from '@/lib/stripe'

export async function chargeDeliveryFee(params: {
  stripeCustomerId: string
  amountCents:      number
  description:      string
  metadata:         Record<string, string>
}): Promise<{ paymentIntentId: string; chargeId: string }> {
  try {
    const intent = await stripe.paymentIntents.create({
      amount:      params.amountCents,
      currency:    'usd',
      customer:    params.stripeCustomerId,
      description: params.description,
      metadata:    params.metadata,
      // Charge the customer's default payment method immediately, no UI.
      confirm:      true,
      off_session:  true,
    })

    if (intent.status !== 'succeeded') {
      throw new Error(`Payment not completed (status: ${intent.status})`)
    }

    const chargeId = typeof intent.latest_charge === 'string'
      ? intent.latest_charge
      : intent.latest_charge?.id ?? ''

    return { paymentIntentId: intent.id, chargeId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Stripe charge failed'
    throw new Error(msg)
  }
}
