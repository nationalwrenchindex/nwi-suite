import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkHDForemanAccess } from '@/lib/hd-access'

export default async function HDForemanPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasForemanAccess = await checkHDForemanAccess(user.id)
  if (!hasForemanAccess) redirect('/hd/upgrade')

  redirect('/foreman')
}
