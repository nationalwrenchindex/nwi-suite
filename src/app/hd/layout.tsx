import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import HDNav from '@/components/hd/HDNav'

// Auth-protected pages handle their own redirect. The layout:
// - Unauthenticated: bare background (login/signup render without nav)
// - Authenticated + no HD subscription: redirect to /hd/signup
// - Authenticated + HD access: full layout with HDNav
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

  // Skip subscription check for auth routes so users can always reach signup/login
  const pathname = (await headers()).get('x-pathname') ?? ''
  const isHDAuthPage = pathname.startsWith('/hd/signup') || pathname.startsWith('/hd/login')

  if (!isHDAuthPage) {
    const hasAccess = await checkHDAccess(user.id)
    if (!hasAccess) redirect('/hd/signup')
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
