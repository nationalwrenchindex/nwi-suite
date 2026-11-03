import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess, reeferStandaloneCan } from '@/lib/hd-access'
import EditInvoiceForm from '../EditInvoiceForm'
import { loadHdShopExtras } from '@/lib/hd/hd-extras-load'

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

  // Used ONLY when the invoice recorded no labor rate, and then shown as assumed.
  // hd_labor_rate first, as the work order converter reads it: default_labor_rate is
  // LD's, and would bill an HD job at the light-duty rate.
  const { data: profile } = await supabase
    .from('profiles')
    .select('hd_labor_rate, default_labor_rate')
    .eq('id', user.id)
    .maybeSingle()
  const p = (profile ?? {}) as Record<string, unknown>
  const shopLaborRate =
    p.hd_labor_rate != null ? Number(p.hd_labor_rate)
    : p.default_labor_rate != null ? Number(p.default_labor_rate)
    : null

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
