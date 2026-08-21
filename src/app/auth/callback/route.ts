import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Determine where to send the user
      if (next === '/update-password') {
        return NextResponse.redirect(`${origin}/update-password`)
      }

      // Fleet Pro members are the customer's staff, not mechanics. They have no
      // business_name and must never be sent through the mechanic onboarding
      // wizard, so the onboarding check is skipped for portal destinations.
      const isFleetProNext = next.startsWith('/fleet-pro')

      // Check if onboarding has been completed
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user && !isFleetProNext) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('business_name')
          .eq('id', user.id)
          .single()

        if (!profile?.business_name) {
          return NextResponse.redirect(`${origin}/onboarding`)
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Something went wrong — send back to login with an error hint
  return NextResponse.redirect(`${origin}/login?error=auth_error`)
}
