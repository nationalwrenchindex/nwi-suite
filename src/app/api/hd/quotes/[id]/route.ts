import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'

import { mintQuoteToken } from '@/lib/hd/quote-approval'

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
  const { public_token: _ignoredToken, ...update } = body
  void _ignoredToken

  const { data, error } = await supabase
    .from('hd_quotes')
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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
