import { createClient } from '@/lib/supabase/server'
import HDNav from '@/components/hd/HDNav'

// Auth-protected pages handle their own redirect. The layout only wraps
// authenticated sessions with HDNav — unauthenticated routes (login/signup)
// get a bare background so nav never appears on public pages.
export default async function HDLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return (
      <div className="min-h-dvh" style={{ background: '#0a0f14' }}>
        {children}
      </div>
    )
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name')
    .eq('id', user.id)
    .single()

  return (
    <div className="min-h-dvh flex" style={{ background: '#0a0f14' }}>
      <HDNav businessName={profile?.business_name ?? undefined} />
      <div className="flex-1 min-w-0 flex flex-col">
        {children}
      </div>
    </div>
  )
}
