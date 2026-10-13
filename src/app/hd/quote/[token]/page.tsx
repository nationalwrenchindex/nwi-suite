// Public customer-facing HD quote page. NO AUTH.
//
// Mirrors LD's app/quote/[token]/page.tsx: fetched server-side with the service client
// because an unauthenticated visitor has no RLS identity, interactive parts in a client
// component.
//
// IMPORTANT - this route must render BARE. The /hd layout redirects anyone without an
// HD subscription to /hd/signup, which would bounce the customer. The layout already
// has that carve-out for /hd/invoices/pay; this page needs the same one, added in
// src/app/hd/layout.tsx.

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/service'
import { HD_QUOTE_PUBLIC_SELECT } from '@/lib/hd/quote-approval'
import HDQuoteApprovalClient, { type PublicHDQuote } from './HDQuoteApprovalClient'

export const dynamic = 'force-dynamic'

/** The shop's own name, so the customer sees who is quoting them. */
async function businessNameFor(userId: string | null): Promise<string> {
  if (!userId) return 'your service provider'
  const sc = createServiceClient()
  const { data } = await sc.from('profiles').select('business_name, full_name').eq('id', userId).single()
  return (data?.business_name as string | null)
    ?? (data?.full_name as string | null)
    ?? 'your service provider'
}

export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  const { token } = await params
  const sc = createServiceClient()
  const { data } = await sc
    .from('hd_quotes')
    .select('quote_number, user_id')
    .eq('public_token', token)
    .maybeSingle()

  const number = (data?.quote_number as string | null) ?? 'Quote'
  const business = await businessNameFor((data?.user_id as string | null) ?? null)
  return {
    title: `${number} - ${business}`,
    // noindex: a quote link is private to whoever was sent it.
    robots: { index: false, follow: false },
  }
}

export default async function HDPublicQuotePage(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!token || token.length < 16) notFound()

  const sc = createServiceClient()
  const { data, error } = await sc
    .from('hd_quotes')
    .select(`${HD_QUOTE_PUBLIC_SELECT}, user_id`)
    .eq('public_token', token)
    .maybeSingle()

  // Migration 153 is applied by hand and the code deploys separately. In that window
  // public_token does not exist; 404 is the honest answer rather than a 500.
  if (error) {
    if (/public_token|schema cache|does not exist/i.test(error.message)) {
      console.error('[hd/quote/[token]] public_token missing - run migration 153')
      notFound()
    }
    console.error('[hd/quote/[token]]', error)
    notFound()
  }
  if (!data) notFound()

  const quote = data as unknown as PublicHDQuote & { user_id: string }
  const business = await businessNameFor(quote.user_id)

  return (
    <div className="min-h-dvh" style={{ background: 'var(--hd-bg)' }}>
      <HDQuoteApprovalClient quote={quote} businessName={business} />
      <footer className="pb-10 text-center">
        <p className="text-xs" style={{ color: 'rgba(var(--hd-ink-rgb), 0.3)' }}>
          {business}
        </p>
      </footer>
    </div>
  )
}
