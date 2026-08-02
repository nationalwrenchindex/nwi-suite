// Shared payment-terms helpers for HD quotes/invoices + the late-fee cron.
// payment_terms is stored as 'net15' | 'net30' | 'net45'. Legacy hd_invoices rows
// may carry the old free-text default ('Due on receipt') — those fall back to 30 days
// for date math and render their raw label.

export function termDays(terms: string | null | undefined): number {
  switch ((terms ?? '').toLowerCase()) {
    case 'net15': return 15
    case 'net45': return 45
    case 'net30': return 30
    default:      return 30
  }
}

// Human label. Net terms → "Net 30"; anything else renders verbatim (or a sane default).
export function termsDisplay(terms: string | null | undefined): string {
  const t = (terms ?? '').toLowerCase()
  if (t === 'net15' || t === 'net30' || t === 'net45') return `Net ${termDays(t)}`
  return (terms && terms.trim()) || 'Due on receipt'
}

// Due date = sent date + N days, returned as a YYYY-MM-DD string (DATE column).
export function computeDueDate(sentAtISO: string, terms: string | null | undefined): string {
  const d = new Date(sentAtISO)
  d.setDate(d.getDate() + termDays(terms))
  return d.toISOString().slice(0, 10)
}

// Format a YYYY-MM-DD date-only string without timezone drift.
export function formatDueDate(d: string | null | undefined): string {
  if (!d) return '—'
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
