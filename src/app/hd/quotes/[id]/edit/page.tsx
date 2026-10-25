import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { isQuoteEditable, quoteLockReason } from '@/lib/hd/quote-edit'
import QuoteForm from '../../QuoteForm'

export const metadata = { title: 'Edit Quote — NWI HD Suite' }

// Same split as /hd/invoices/[id]/edit: a server page that loads the row and hands it
// to the form. The form is the NEW-quote form, seeded - not a second one.
export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) redirect('/hd/signup')

  const { data: q } = await supabase
    .from('hd_quotes')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!q) notFound()

  // Locked quotes say WHY, on the page a tech lands on from an old link.
  if (!isQuoteEditable(q.status)) {
    return (
      <div style={{ background: '#F4F5F7', minHeight: '100dvh', padding: '24px 20px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto', background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: 24 }}>
          <p className="font-condensed font-bold text-xl" style={{ color: '#1A1A1A' }}>
            {String(q.quote_number ?? 'Quote')} is locked
          </p>
          <p className="text-sm mt-2" style={{ color: 'var(--paper-muted)' }}>{quoteLockReason(q.status)}</p>
          <Link href={`/hd/quotes/${id}`} className="inline-block mt-4 text-sm font-semibold" style={{ color: '#2969B0' }}>
            ← Back to the quote
          </Link>
        </div>
      </div>
    )
  }

  return <QuoteForm initial={q as Record<string, unknown>} />
}
