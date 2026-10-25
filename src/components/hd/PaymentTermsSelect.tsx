'use client'

// The HD payment terms picker: the shared list (PAYMENT_TERMS - Due on receipt, Net 3,
// Net 7, Net 15, Net 30) for the quote and invoice forms, which each had their own
// net15 / net30 / net45 list.
//
// A STORED VALUE IS NEVER REWRITTEN BY OPENING IT. The select shows a stored "net30"
// as Net 30 (normalised on read) while the form keeps the stored spelling, so saving
// without touching the field writes nothing new. Only an actual pick stores the
// canonical code. A stored value the list does not offer (net45, or a sentence the
// shop typed) stays selectable as itself rather than silently changing.

import { normalisePaymentTerms, PAYMENT_TERMS, termDays, termsDisplay } from '@/lib/hd/payment-terms'

function optionLabel(code: string): string {
  const days = termDays(code)
  return days === 0 ? termsDisplay(code) : `${termsDisplay(code)} (due in ${days} days)`
}

export default function PaymentTermsSelect({ value, onChange, style }: {
  value: string
  onChange: (v: string) => void
  style?: React.CSSProperties
}) {
  const canon = normalisePaymentTerms(value)
  const offered = PAYMENT_TERMS as readonly string[]
  const extra = value && !(canon && offered.includes(canon)) ? value : null
  const selected = extra ?? canon ?? ''
  return (
    <select style={style} name="payment_terms" value={selected}
      onChange={e => { if (e.target.value !== selected) onChange(e.target.value) }}>
      {!value && <option value="">No terms</option>}
      {extra && <option value={extra}>{normalisePaymentTerms(extra) ? optionLabel(extra) : termsDisplay(extra)}</option>}
      {PAYMENT_TERMS.map(t => <option key={t} value={t}>{optionLabel(t)}</option>)}
    </select>
  )
}
