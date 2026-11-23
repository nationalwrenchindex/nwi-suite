// POST /api/fleet-manager/accept - turn the invitation link into a session.
//
// The emailed link opens /fleet-manager/accept, a page with one button that posts
// here. Not a GET on purpose: mail scanners (Outlook Safe Links and the like) fetch
// every link in a message before the person does, and a GET that spent the one-time
// token would leave the real click with a dead link.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveFleetManager } from '@/lib/fleet-view/access'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null)
  const tokenHash = String(form?.get('token_hash') ?? '')
  const type = String(form?.get('type') ?? '') === 'magiclink' ? 'magiclink' : 'invite'
  const back = (path: string) => NextResponse.redirect(new URL(path, req.nextUrl.origin), 303)
  if (!tokenHash) return back('/fleet-manager/login?error=link')

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
  if (error || !data.user) return back('/fleet-manager/login?error=link')
  if (!(await resolveFleetManager(data.user))) return back('/fleet-manager/no-access')
  return back('/fleet-manager/set-password')
}
