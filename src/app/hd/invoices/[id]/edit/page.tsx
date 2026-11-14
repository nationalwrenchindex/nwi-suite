import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess, reeferStandaloneCan } from '@/lib/hd-access'
import EditInvoiceForm from '../EditInvoiceForm'
import { loadHdShopExtras } from '@/lib/hd/hd-extras-load'
import { hdLaborRateFrom } from '@/lib/hd/labor-rate'
import { isInvoiceLocked, lockedMessage } from '@/lib/hd/invoice-lock'
import Link from 'next/link'

export const metadata = { title: 'Edit Invoice — NWI HD Suite' }

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = (await checkHDAccess(user.id)) || (await reeferStandaloneCan(user.id, 'reefer_invoices'))
  if (!hasAccess) redirect('/hd/signup')

  const { data: inv } = await supabase
    .from('hd_invoices')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!inv) notFound()

  // Paid, partially paid and void invoices are closed. The PUT refuses them too; this
  // says so instead of offering a form whose save would be refused.
  if (isInvoiceLocked((inv as Record<string, unknown>).status)) {
    return (
      <div style={{ background: '#F4F5F7', color: '#1A1A1A', minHeight: '100dvh', padding: '24px 20px' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }} data-invoice-locked="true">
          <Link href={`/hd/invoices/${id}`} style={{ color: 'var(--paper-muted)', fontSize: 13 }}>&larr; Back to the invoice</Link>
          <p className="mt-4 text-base font-semibold">{lockedMessage(inv as Record<string, unknown>)}</p>
        </div>
      </div>
    )
  }

  // Used ONLY when the invoice recorded no labor rate, and then shown as assumed.
  // hd_labor_rate only (hdLaborRateFrom): default_labor_rate is LD's, and would bill an
  // HD job at the light-duty rate. None set: the form says so and asks for one.
  const { data: profile } = await supabase
    .from('profiles')
    .select('hd_labor_rate')
    .eq('id', user.id)
    .maybeSingle()
  const shopLaborRate = hdLaborRateFrom(profile as Record<string, unknown> | null)

  // HD's drive time / mileage now and the service call setting (migration 178), for
  // hours or a fee the tech adds to this invoice. Its recorded rates still win.
  const { shop, available } = await loadHdShopExtras(supabase, user.id)

  return (
    <EditInvoiceForm
      invoice={inv as Record<string, unknown>}
      shopLaborRate={shopLaborRate}
      shop={{ extras: shop.extras, serviceCallTax: shop.serviceCall.tax, serviceCallAvailable: available && 'service_call_fee' in (inv as Record<string, unknown>) }}
    />
  )
}
