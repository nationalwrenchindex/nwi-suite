// The terms block at the bottom of an HD customer document (public quote, pay page):
// warranty, the customer-supplied parts clause, how to pay. Rows come from what the
// document RECORDED (hdTermsBlockRows). No rows renders nothing at all - never an
// empty heading. The PDF prints the same rows as HTML (api/hd/invoices/[id]/pdf).

import type { TermsRow } from '@/lib/document-terms'

export default function DocumentTermsBlock({ rows, text, muted, border }: {
  rows: TermsRow[]
  /** Colours of the surface it sits on - theme tokens or paper tokens. */
  text: string
  muted: string
  border: string
}) {
  if (rows.length === 0) return null
  return (
    <section data-testid="terms-block" className="mt-5 pt-4" style={{ borderTop: `1px solid ${border}` }}>
      <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: muted }}>Terms</h3>
      <dl className="space-y-3">
        {rows.map(r => (
          <div key={r.key}>
            <dt className="text-xs font-semibold" style={{ color: muted }}>{r.label}</dt>
            {r.text && <dd className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: text }}>{r.text}</dd>}
            {r.link && (
              <dd className="text-sm mt-0.5">
                <a href={r.link} rel="noopener noreferrer" target="_blank" className="underline break-all" style={{ color: text }}>{r.link}</a>
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  )
}
