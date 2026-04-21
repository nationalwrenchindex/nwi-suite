import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import InvoiceInProgressClient from './InvoiceInProgressClient'
import type { Invoice } from '@/types/financials'

export const metadata = { title: 'Invoice in Progress — National Wrench Index Suite™' }

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
    .select(`
      *,
      customer:customers(id, first_name, last_name, phone, email),
      vehicle:vehicles(id, year, make, model, vin),
      source_quote:quotes(id, quote_number, line_items, labor_hours, labor_rate, parts_subtotal, parts_markup_percent, labor_subtotal, tax_percent, tax_amount, grand_total)
    `)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !invoice) notFound()

  // Only render the in-progress editor for in_progress invoices
  if (invoice.invoice_status !== 'in_progress') {
    redirect('/financials?tab=invoices')
  }

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav businessName={profile.business_name} />
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <InvoiceInProgressClient invoice={invoice as unknown as Invoice} />
      </main>
    </div>
  )
}
