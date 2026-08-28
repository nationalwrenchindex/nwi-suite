// POST /api/hd/invoices/[id]/token
// Mint (or return) the public payment-link token for one of the caller's own HD invoices.
// Idempotent: repeated calls return the same token and URL.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { mintInvoiceToken, publicInvoiceUrl } from '@/lib/hd/invoice-token'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // The service client is what writes the token, so ownership is enforced inside
    // mintInvoiceToken by scoping every statement to user_id — not by RLS, which
    // the service role bypasses. A non-owner gets 'Invoice not found', which is
    // also the honest answer: they have no invoice by that id.
    const svc   = createServiceClient()
    const token = await mintInvoiceToken(svc, id, user.id)

    return NextResponse.json({ token, url: publicInvoiceUrl(token) })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to mint token'
    // 'Invoice not found' covers both a bad id and someone else's id; it must not
    // be distinguishable from the outside.
    const status  = message === 'Invoice not found' ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
