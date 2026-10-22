// /financials?tab=quotes&quote=<id> opens that quote's panel. It must open it ONCE.
//
// The Quotes tab used to re-select the linked quote whenever nothing was selected, and
// "nothing selected" is exactly what closing the panel produces - so the X reopened the
// quote instantly and the only way off it was "Reopen in QuickWrench". Every quote made
// with New Quote lands on that link (b34f7f39), so every one of them was a trap after
// sending; a live trial subscriber hit it on Oct 22.
//
// A deep link is consumed by opening it. Closing the panel also drops ?quote= from the
// URL, so a refresh or Back lands on the list rather than springing the panel again.

export interface DeepLinkQuote { id: string }

/**
 * The quote the deep link should open now, or null. `consumedId` is the id this page
 * has already opened from the link - once it is set for that id, never again.
 */
export function deepLinkTarget<Q extends DeepLinkQuote>(
  initialQuoteId: string | undefined | null,
  quotes: Q[],
  consumedId: string | null,
): Q | null {
  if (!initialQuoteId || consumedId === initialQuoteId) return null
  return quotes.find(q => q.id === initialQuoteId) ?? null
}

/** The same URL with the `quote` parameter removed and every other one kept. */
export function urlWithoutQuote(href: string): string {
  const url = new URL(href)
  url.searchParams.delete('quote')
  return url.pathname + (url.search || '') + url.hash
}
