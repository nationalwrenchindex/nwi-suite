// ─── Routes a customer sees, not a subscriber ─────────────────────────────────
// These pages are reached from a link in a text or an email, by someone who does
// not have an account and never will. Two rules follow from that:
//
//   1. Nothing that belongs to the application may appear on them -- no install
//      banner, no app chrome, no prompt to sign in.
//   2. On a white-label account the page belongs to the SUBSCRIBER's business.
//      NWI's own name and branding must not be on it.
//
// This list is the single definition of which routes those are, so a new public
// page is added in one place rather than being missed by one check out of five.

/**
 * Matched as whole path segments: an entry matches the path itself or anything
 * beneath it. `/work-order` therefore matches `/work-order/abc123` but NOT
 * `/work-orders`, which is the tech's own list and is not public.
 */
const PUBLIC_ROUTES = [
  '/work-order',              // customer approving segments on a work order
  '/quote',                   // customer approving a quote
  '/invoice',                 // customer viewing/paying an invoice
  '/book',                    // public booking page
  '/hd/invoices/pay',         // HD customer paying an invoice
  '/inspect',                 // driver pre-trip inspection, reached by QR sticker
  '/fleet-pro/accept-invite', // invited user, arrives before they have a session
  '/offline',                 // service-worker fallback; can be shown to anyone
] as const

export function isPublicRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  // Trailing slashes are stripped so '/quote/' and '/quote' behave the same.
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return PUBLIC_ROUTES.some(r => path === r || path.startsWith(`${r}/`))
}
