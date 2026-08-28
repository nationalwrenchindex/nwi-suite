// Public, no-login HD invoice payment page.
//
// The visitor is the customer who received a text — they have no account and never
// will. Auth is the token in the URL and nothing else, so this page must not call
// getUser(), checkHDAccess(), or anything that assumes a session.
//
// !! ROUTE PLACEMENT !!
// This lives under src/app/hd/, which is gated twice over for signed-in users:
//   1. src/middleware.ts redirects any anonymous visitor to /hd/login for every
//      path starting with '/hd/' that is not an auth route. That bounces the
//      customer before this page ever runs.
//   2. src/app/hd/layout.tsx redirects a signed-in user without an HD subscription
//      to /hd/signup.
// Neither file is owned by this change and neither can be escaped from a nested
// layout — a child layout does not replace its parent. Both need an explicit
// bypass for the '/hd/invoices/pay' prefix. See the handoff notes.
//
// Reads go through the service-role client filtered by the exact token. There is
// no anon RLS policy on hd_invoices (migration 116 explains why not).

import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import { getInvoiceByToken } from '@/lib/hd/invoice-token'
import PublicInvoicePay from '@/components/hd/PublicInvoicePay'

export const dynamic = 'force-dynamic'

export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  const { token } = await params
  const result = await getInvoiceByToken(createServiceClient(), token)

  if (!result) return { title: 'Invoice' }

  // White label: the tab title carries the shop's name, never NWI's.
  const biz = result.branding.business_name
  return {
    title: `${result.invoice.invoice_number}${biz ? ` — ${biz}` : ''}`,
    // A capability URL must never end up in a search index or in a referrer chain.
    robots: { index: false, follow: false },
  }
}

// Rendered inline rather than via notFound(). Two reasons: the nearest not-found
// boundary is NWI-branded, which breaks the white label for a customer who has no
// idea what NWI is; and rendering it here guarantees a token that never existed and
// a token whose invoice was deleted produce byte-identical output, so the page
// cannot be used to probe which invoices are real.
function InvoiceUnavailable() {
  return (
    <div
      style={{ background: '#F4F5F7', minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div
        className="text-center px-6 py-10"
        style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, maxWidth: 420, width: '100%' }}
      >
        <p className="font-bold text-lg" style={{ color: '#1A1A1A' }}>Invoice not available</p>
        <p className="text-sm mt-2 leading-relaxed" style={{ color: '#6B7280' }}>
          This link is no longer valid. Please contact the company that sent it to you
          for an up-to-date copy of your invoice.
        </p>
      </div>
    </div>
  )
}

export default async function PublicHDInvoicePayPage(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const result = await getInvoiceByToken(createServiceClient(), token)

  if (!result) return <InvoiceUnavailable />

  return <PublicInvoicePay invoice={result.invoice} branding={result.branding} />
}
