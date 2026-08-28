// Shared authentication for Vercel Cron routes.
//
// Vercel sends `Authorization: Bearer <CRON_SECRET>` on every scheduled invocation
// when CRON_SECRET is present in the project environment. The `x-cron-secret` header
// is also accepted because the routes predating this helper documented that form and
// it is what the manual curl examples in their comments use.
//
// ── WHY THIS FAILS CLOSED ────────────────────────────────────────────────────
// The inline pattern this replaces reads:
//
//   const expected = process.env.CRON_SECRET
//   if (expected && incoming !== expected) return 403
//
// The `expected &&` means an environment with no CRON_SECRET set skips the check
// entirely and serves every caller. That is backwards: a missing secret is exactly
// the state where the route is least protected and most needs to refuse. Here an
// unset secret rejects everything, which fails loudly in the Vercel cron log instead
// of silently exposing a service-role write path to the open internet.

import { NextResponse } from 'next/server'
import crypto from 'node:crypto'

/**
 * Returns a 403 response when the request is not an authenticated cron invocation,
 * or null when it is. Callers do `const denied = authorizeCron(request); if (denied)
 * return denied` before touching any data.
 */
export function authorizeCron(request: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('[cron] CRON_SECRET is not set — refusing all scheduled requests.')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const incoming =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace(/^Bearer /, '')

  if (!incoming || !constantTimeEquals(incoming, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return null
}

/**
 * Constant-time comparison. Both sides are hashed to a fixed 32 bytes first because
 * `timingSafeEqual` throws on a length mismatch, and an early length check would leak
 * the secret's length through control flow.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest()
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest()
  return crypto.timingSafeEqual(ha, hb)
}
