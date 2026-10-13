// GET /api/hd/quotes/public/[token]   the quote behind a customer approval link
//
// NO AUTH. Possession of the token is the authorization to read, the same model LD's
// public quote route uses. Served with the service client because an unauthenticated
// visitor has no RLS identity.
//
// Reads an explicit column list (HD_QUOTE_PUBLIC_SELECT) rather than '*': this
// response goes to the customer's browser, and internal_notes, user_id and the shop's
// own bookkeeping must not travel with it. A '*' would ship whatever the next
// migration adds without anyone deciding to.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { HD_QUOTE_PUBLIC_SELECT } from '@/lib/hd/quote-approval'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!token || token.length < 16) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('hd_quotes')
    .select(HD_QUOTE_PUBLIC_SELECT)
    .eq('public_token', token)
    .maybeSingle()

  // Migration 153 applied by hand, code deployed separately: in that window
  // public_token does not exist and this would 500. A 404 is the honest answer to
  // "is there a quote at this link" when the column is not there yet.
  if (error) {
    const missing = /public_token|schema cache|does not exist/i.test(error.message)
    if (missing) {
      console.error('[hd/quotes/public] public_token missing - run migration 153')
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    console.error('[hd/quotes/public]', error)
    return NextResponse.json({ error: 'Could not load this quote' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ quote: data })
}
