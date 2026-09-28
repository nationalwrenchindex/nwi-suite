// ─── Page metadata for customer-facing routes ─────────────────────────────────
// The root layout sets a title template of '%s | National Wrench Index™'. That is
// right for the application -- "Dashboard | National Wrench Index™" is what a
// subscriber expects -- and wrong for every page a CUSTOMER opens, where it appended
// NWI's name to the subscriber's own document. The white-label promise does not
// survive a browser tab that says who really built the thing.
//
// `title.absolute` is the documented way out: it replaces the parent template
// instead of feeding into it. Every public route uses one of these two helpers, so
// the opt-out is not something a new page can forget by accident.

import type { Metadata } from 'next'

/** Trailing whitespace and empty strings both mean "no name on file". */
function clean(name: string | null | undefined): string | null {
  const n = typeof name === 'string' ? name.trim() : ''
  return n.length > 0 ? n : null
}

/**
 * A document reached by a capability URL -- a quote, an invoice, a work order
 * approval. The title carries the SUBSCRIBER's business, never NWI's.
 *
 * Always noindex: the token in the URL is the only credential protecting it, so it
 * must not reach a search index, and `follow: false` keeps it out of referrer
 * chains on the way out too. Previously only the HD payment page did this.
 */
export function publicDocumentMetadata(
  label:        string,
  businessName?: string | null,
): Metadata {
  const biz = clean(businessName)
  return {
    title:  { absolute: biz ? `${label} — ${biz}` : label },
    robots: { index: false, follow: false },
  }
}

/**
 * A public page the subscriber WANTS found -- the booking page. Same escape from
 * the NWI title template, but deliberately indexable: telling search engines to
 * ignore a shop's booking page would work against the subscriber.
 */
export function publicPageMetadata(
  label:        string,
  businessName?: string | null,
): Metadata {
  const biz = clean(businessName)
  return { title: { absolute: biz ? `${label} — ${biz}` : label } }
}
