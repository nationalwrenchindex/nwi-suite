import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import ImportWizard from './ImportWizard'

export const metadata = { title: 'Import Data — NWI HD Suite' }

export default async function ImportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDStarterAccess(user.id)
  if (!hasAccess) redirect('/hd/upgrade')

  return (
    <main className="flex-1 min-h-screen" style={{ background: '#0a0f14' }}>
      <ImportWizard />
    </main>
  )
}
