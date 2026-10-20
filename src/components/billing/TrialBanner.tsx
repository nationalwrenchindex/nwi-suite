// The billing page's free-trial notice: that the subscription is on trial, the day it
// ends, and what it will then bill. The wording comes from trialNotice() in
// src/lib/ld-trial.ts; this only lays it out. No hooks, so it renders in a test.

import { trialNotice } from '@/lib/ld-trial'

export interface TrialBilling {
  /** Stripe's next charge for this subscription, in cents. null = could not be read. */
  amountCents: number | null
  currency:    string | null
  /** The trial's end per Stripe. null = fall back to current_period_end. */
  trialEnd:    string | null
}

export default function TrialBanner({
  status,
  currentPeriodEnd,
  trialBilling,
  planName,
  planPriceCents,
  onCancel,
}: {
  status:           string
  currentPeriodEnd: string | null
  trialBilling:     TrialBilling | null
  planName:         string | null
  planPriceCents:   number | null
  onCancel:         () => void
}) {
  const notice = trialNotice({
    status,
    trialEnd:    trialBilling?.trialEnd ?? currentPeriodEnd,
    amountCents: trialBilling?.amountCents ?? null,
    currency:    trialBilling?.currency ?? null,
    planName,
    planPriceCents,
  })
  if (!notice) return null
  return (
    <div
      data-testid="trial-banner"
      className="bg-blue/10 border border-blue/30 rounded-xl px-4 py-3 flex items-start gap-3"
      suppressHydrationWarning
    >
      <div className="flex-1">
        <p className="text-blue-light font-medium text-sm">{notice.title}</p>
        <p className="text-blue-light/70 text-xs mt-0.5">{notice.detail}</p>
        <p className="text-blue-light/50 text-xs mt-1">
          Trial ends: <span data-testid="trial-end">{notice.endDate}</span>
          {notice.amount && <> · First charge: <span data-testid="trial-amount">{notice.amount}</span></>}
        </p>
      </div>
      <button
        onClick={onCancel}
        className="text-blue-light/40 hover:text-blue-light text-xs underline whitespace-nowrap mt-0.5"
      >
        Cancel trial
      </button>
    </div>
  )
}
