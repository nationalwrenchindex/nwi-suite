import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import EditInvoiceForm from '../EditInvoiceForm'

export const metadata = { title: 'Edit Invoice — NWI HD Suite' }

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) redirect('/hd/signup')

  const { data: inv } = await supabase
    .from('hd_invoices')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!inv) notFound()

  return <EditInvoiceForm invoice={inv as Record<string, unknown>} />
}
