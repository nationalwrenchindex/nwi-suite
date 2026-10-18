import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'

import { mintQuoteToken } from '@/lib/hd/quote-approval'
import { EDITABLE_QUOTE_STATUSES, isQuoteEditable, quoteEditUpdate, quoteLockReason } from '@/lib/hd/quote-edit'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const { data, error } = await supabase
    .from('hd_quotes')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ quote: data })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // THE PUBLIC TOKEN IS NEVER WRITTEN BY THIS ROUTE.
  //
  // This used to set `public_token: body.public_token ?? generateQuoteToken()` on every
  // PUT carrying status 'sent' - so any save of a sent quote that did not echo the token
  // back minted a NEW one and killed the link the customer already held, while the
  // comment above it claimed the opposite. The token is stripped from the body, and a
  // quote marked sent gets one through mintQuoteToken, which only fills an empty token
  // (compare-and-set) and never replaces a live one.
  //
  // THE TOKEN IS NOT EVEN IN THE ALLOW-LIST. quoteEditUpdate copies only the columns
  // the quote form sends (src/lib/hd/quote-edit.ts); public_token, quote_number,
  // user_id and the approval record cannot arrive through here at all.
  //
  // ONLY A DRAFT OR SENT QUOTE IS EDITED. An approved quote is what the customer agreed
  // to. The status is checked on the UPDATE itself (.in), not read first and trusted,
  // so a customer approving between the read and the write cannot be overwritten.
  const { data: current } = await supabase
    .from('hd_quotes')
    .select('status')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isQuoteEditable(current.status)) {
    return NextResponse.json({ error: quoteLockReason(current.status), reason: 'locked' }, { status: 409 })
  }

  // Draft may become sent; sent stays sent. Nothing else is reachable from here -
  // approval and decline belong to the customer's link and the verbal-approval path.
  const status = current.status === 'sent' || body.status === 'sent' ? 'sent' : 'draft'
  const update: Record<string, unknown> = {
    ...quoteEditUpdate(body), status, updated_at: new Date().toISOString(),
  }

  const write = (row: Record<string, unknown>) => supabase
    .from('hd_quotes')
    .update(row)
    .eq('id', id)
    .eq('user_id', user.id)
    .in('status', EDITABLE_QUOTE_STATUSES as unknown as string[])
    .select()
    .maybeSingle()

  let { data, error } = await write(update)
  // Migration 160 (tech_name) is applied by hand; the edit saves without the tech.
  if (error && /tech_name/i.test(error.message)) {
    console.error('[hd/quotes PUT] tech_name missing - run migration 160', error.message)
    const { tech_name: _t, ...withoutTech } = update
    void _t
    ;({ data, error } = await write(withoutTech))
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) {
    // The status changed between the check and the write - the customer approved it.
    return NextResponse.json({ error: quoteLockReason('approved'), reason: 'locked' }, { status: 409 })
  }

  let quote = data as Record<string, unknown>
  if (quote?.status === 'sent' && !quote.public_token) {
    try {
      quote = { ...quote, public_token: await mintQuoteToken(id, user.id) }
    } catch (err) {
      // The edit is saved; only the link is missing, and Send issues it.
      console.error('[hd/quotes PUT] could not issue public_token:', err instanceof Error ? err.message : String(err))
    }
  }
  return NextResponse.json({ quote })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const { error } = await supabase
    .from('hd_quotes')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
