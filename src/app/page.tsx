import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Root "/" redirects based on auth state
export default async function RootPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Check if onboarding is complete
  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) {
    redirect('/onboarding')
  }

  redirect('/dashboard')
}
