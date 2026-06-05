import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import GuidedDiagnostic from './GuidedDiagnostic'

export default async function GuidedDiagnosticPage({
  searchParams,
}: {
  searchParams: Promise<{ alarm?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) redirect('/hd/signup')

  const { alarm } = await searchParams

  return <GuidedDiagnostic alarmCode={alarm ?? '25'} />
}
