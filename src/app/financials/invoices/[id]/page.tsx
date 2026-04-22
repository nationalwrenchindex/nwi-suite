import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import InvoiceInProgressClient from './InvoiceInProgressClient'
import FinalizedInvoiceClient from './FinalizedInvoiceClient'
import type { Invoice } from '@/types/financials'

export const metadata = { title: 'Invoice — National Wrench Index Suite™' }

const INVOICE_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, vin),
  source_quote:quotes!invoices_source_quote_id_fkey(id, quote_number, line_items, labor_hours, labor_rate, parts_subtotal, parts_markup_percent, labor_subtotal, tax_percent, tax_amount, grand_total)
`

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, business_name, labor_rate')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select(INVOICE_SELECT)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !invoice) notFound()

  const inv = invoice as unknown as Invoice
  const bizName  = (profile as { business_name?: string }).business_name ?? ''
  const techName = (profile as { full_name?: string }).full_name         ?? bizName

  // in_progress → editable editor
  if (inv.invoice_status === 'in_progress') {
    return (
      <div className="min-h-dvh bg-dark flex flex-col">
        <AppNav businessName={bizName} />
        <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-6">
          <InvoiceInProgressClient invoice={inv} />
        </main>
      </div>
    )
  }

  // awaiting_payment or paid → read-only finalized view
  if (inv.invoice_status === 'awaiting_payment' || inv.invoice_status === 'paid') {
    return (
      <div className="min-h-dvh bg-dark flex flex-col">
        <AppNav businessName={bizName} />
        <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-6">
          <FinalizedInvoiceClient invoice={inv} bizName={bizName} techName={techName} />
        </main>
      </div>
    )
  }

  // void or unknown → fall back to list
  redirect('/financials?tab=invoices')
}
