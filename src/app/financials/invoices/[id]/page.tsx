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
  source_quote:quotes!invoices_source_quote_id_fkey(id, quote_number, line_items, jobs, labor_hours, labor_rate, parts_subtotal, parts_markup_percent, labor_subtotal, tax_percent, tax_amount, grand_total)
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
    .select('full_name, business_name, average_mpg, fuel_type, business_type')
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
  const p        = profile as { business_name?: string; full_name?: string; average_mpg?: number | null; fuel_type?: string | null; business_type?: string | null }
  const bizName  = p.business_name ?? ''
  const techName = p.full_name     ?? bizName
  const averageMpg = p.average_mpg ?? null
  const fuelType   = p.fuel_type   ?? 'gasoline'
  const businessType = p.business_type ?? undefined

  // in_progress → editable editor
  if (inv.invoice_status === 'in_progress') {
    return (
      <div className="min-h-dvh bg-dark flex flex-col">
        <AppNav businessName={bizName} businessType={businessType} />
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
        <AppNav businessName={bizName} businessType={businessType} />
        <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-6">
          <FinalizedInvoiceClient invoice={inv} bizName={bizName} techName={techName} averageMpg={averageMpg} fuelType={fuelType} />
        </main>
      </div>
    )
  }

  // void or unknown → fall back to list
  redirect('/financials?tab=invoices')
}
