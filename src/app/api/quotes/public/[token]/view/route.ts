// POST /api/quotes/public/[token]/view
// Called on public page mount. Increments view_count, sets viewed_at on first view.
// Also handles expiry: if quote_expires_at < now and status='sent', marks it 'expired'.
// No auth required.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'Invalid token.' }, { status: 400 })
  }

  const serviceClient = createServiceClient()

  const { data: quote, error } = await serviceClient
    .from('quotes')
    .select('id, status, view_count, viewed_at, quote_expires_at')
    .eq('public_token', token)
    .single()

  if (error || !quote) {
    return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })
  }

  const now   = new Date()
  const patch: Record<string, unknown> = {
    view_count: (quote.view_count ?? 0) + 1,
  }

  if (!quote.viewed_at) {
    patch.viewed_at = now.toISOString()
  }

  // Auto-expire if the link has aged past quote_expires_at and not already resolved
  if (
    quote.status === 'sent' &&
    quote.quote_expires_at &&
    new Date(quote.quote_expires_at) < now
  ) {
    patch.status = 'expired'
  }

  const { data: updated, error: updateErr } = await serviceClient
    .from('quotes')
    .update(patch)
    .eq('id', quote.id)
    .select('status, view_count, viewed_at')
    .single()

  if (updateErr) {
    console.error('[public/view] update failed:', updateErr)
    // Non-fatal — return current state
    return NextResponse.json({ status: quote.status, view_count: quote.view_count })
  }

  return NextResponse.json({
    status:     updated?.status     ?? quote.status,
    view_count: updated?.view_count ?? quote.view_count,
  })
}
