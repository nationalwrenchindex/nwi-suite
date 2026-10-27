import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess, reeferStandaloneCan } from '@/lib/hd-access'
import EditWorkOrderForm from '../EditWorkOrderForm'

export const metadata = { title: 'Edit Work Order — NWI HD Suite' }

// The same page/form split as /hd/invoices/[id]/edit. NOT the same route behaviour:
// the form saves through the work order's allow-listed PATCH, which takes no money and
// refuses an invoiced job.
export default async function EditWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = (await checkHDStarterAccess(user.id)) || (await reeferStandaloneCan(user.id, 'reefer_work_orders'))
  if (!hasAccess) redirect('/hd/upgrade')

  // '*' so the migration-159 unit columns are read when they exist and the page still
  // loads before they do.
  const { data: wo } = await supabase
    .from('hd_work_orders')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!wo) notFound()

  return <EditWorkOrderForm workOrder={wo as Record<string, unknown>} />
}
