// POST /api/legal/accept   record this account's acceptance of the Terms and Privacy Policy
// GET  /api/legal/accept   what this account has accepted, for the re-acceptance prompt
//
// The IP and User-Agent are taken from the REQUEST, never from the body. A client that
// reports its own IP is reporting whatever it likes, and the whole point of these columns
// is to be evidence.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  LEGAL_VERSION, LEGAL_SELECT, acceptanceFrom, isMissingLegalColumn, clientIpFrom,
} from '@/lib/legal'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('profiles')
    .select(LEGAL_SELECT)
    .eq('id', user.id)
    .single()

  // Migration 147 not applied yet: say so plainly rather than reporting "needs to
  // accept", which would show a prompt whose button can only fail.
  if (error && isMissingLegalColumn(error)) {
    return NextResponse.json({
      version: LEGAL_VERSION,
      acceptance: { acceptedAt: null, version: null, current: false, unavailable: true },
    })
  }
  if (error) {
    console.error('[legal/accept GET]', error)
    return NextResponse.json({ error: 'Could not read acceptance' }, { status: 500 })
  }

  return NextResponse.json({
    version: LEGAL_VERSION,
    acceptance: acceptanceFrom(data as Record<string, unknown>),
  })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // The body carries only the explicit affirmative. Everything evidential comes from the
  // request itself.
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { /* an empty body is a missing acceptance */ }

  if (body.accepted !== true) {
    return NextResponse.json(
      { error: 'You must accept the Terms of Service and Privacy Policy to continue.' },
      { status: 422 },
    )
  }

  // A client may state which version it was shown. If it disagrees with what we publish,
  // refuse: recording LEGAL_VERSION against a page that said something else would
  // manufacture evidence of an agreement that did not happen.
  const shown = typeof body.version === 'string' ? body.version : null
  if (shown && shown !== LEGAL_VERSION) {
    return NextResponse.json(
      {
        error: 'The terms have changed since this page loaded. Please reload and read the current version.',
        version: LEGAL_VERSION,
      },
      { status: 409 },
    )
  }

  const now = new Date().toISOString()
  const row = {
    terms_accepted_at:     now,
    terms_version:         LEGAL_VERSION,
    privacy_accepted_at:   now,
    acceptance_ip:         clientIpFrom(request.headers),
    acceptance_user_agent: request.headers.get('user-agent'),
  }

  const { error } = await supabase
    .from('profiles')
    .update(row)
    .eq('id', user.id)

  if (error && isMissingLegalColumn(error)) {
    // Cannot record it, and must not pretend otherwise. 503 rather than 500: this is a
    // temporary state that ends when migration 147 is applied, and the caller can tell
    // the user something true.
    console.warn('[legal/accept] migration 147 is not applied yet - acceptance NOT recorded')
    return NextResponse.json(
      {
        error: 'Acceptance cannot be recorded yet. Please try again shortly.',
        reason: 'migration_147_pending',
      },
      { status: 503 },
    )
  }
  if (error) {
    console.error('[legal/accept POST]', error)
    return NextResponse.json({ error: 'Could not record acceptance' }, { status: 500 })
  }

  return NextResponse.json({ accepted: true, version: LEGAL_VERSION, at: now })
}
