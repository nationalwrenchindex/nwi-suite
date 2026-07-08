// Platform fee on top of the Roadie delivery fee.
// 15% of the Roadie fee, minimum $2.50. The Stripe processing-fee buffer is
// already baked into the 15% markup.

export function calculateDeliveryFee(roadieFeeCents: number): {
  roadieFeeCents:  number
  platformFeeCents: number
  totalCents:      number
  breakdown:       string
} {
  const platformFeeCents = Math.max(250, Math.round(roadieFeeCents * 0.15))
  const totalCents       = roadieFeeCents + platformFeeCents
  const usd = (cents: number) => (cents / 100).toFixed(2)
  const breakdown = `Delivery: $${usd(roadieFeeCents)} + Platform fee: $${usd(platformFeeCents)} = $${usd(totalCents)}`
  return { roadieFeeCents, platformFeeCents, totalCents, breakdown }
}
