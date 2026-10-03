import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendFounderAlert } from '@/lib/email-alerts'

/**
 * True the FIRST time a user comes through here after confirming their email.
 *
 * This route also handles password resets and every subsequent magic link, so a
 * naive "user exists" check would alert on every one. Supabase stamps
 * email_confirmed_at when the address is proven; comparing it to last_sign_in_at
 * identifies the confirmation visit specifically — on any later sign-in,
 * last_sign_in_at has moved well past it.
 *
 * A 60-second window rather than equality, because the two timestamps are written
 * by different statements and are close but not identical.
 */
function isFirstConfirmation(user: { email_confirmed_at?: string | null; last_sign_in_at?: string | null }): boolean {
  const confirmed = user.email_confirmed_at ? Date.parse(user.email_confirmed_at) : NaN
  if (Number.isNaN(confirmed)) return false
  const lastSignIn = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : NaN
  // Never signed in before: this is unambiguously the first time.
  if (Number.isNaN(lastSignIn)) return true
  return Math.abs(lastSignIn - confirmed) < 60_000
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

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

      // ── NEW SIGNUP ALERT (Part 6) ──
      // Fired HERE rather than from the signup form, for two reasons: this runs
      // server-side so it cannot be skipped or spoofed by a client, and it is the
      // exact moment the email address is proven real. An alert on an unverified
      // signup is an alert on a bot.
      //
      // Uses sendFounderAlert, the path that already exists in
      // src/lib/email-alerts.ts (the Stripe webhook's sendNewSubscriberAlert is the
      // PAYING-customer alert and is deliberately left alone — a signup is not a
      // sale, and merging them would make the paying-subscriber alert untrustworthy).
      //
      // Best-effort: a mail failure must never block someone getting into the app.
      if (user && isFirstConfirmation(user)) {
        void sendFounderAlert({
          subject: `New signup — ${user.email ?? 'unknown email'}`,
          html: [
            '<h2>New account verified</h2>',
            `<p><strong>Email:</strong> ${escapeHtml(user.email ?? '—')}</p>`,
            `<p><strong>Name:</strong> ${escapeHtml(String(user.user_metadata?.full_name ?? '—'))}</p>`,
            `<p><strong>Business:</strong> ${escapeHtml(String(user.user_metadata?.business_name ?? '—'))}</p>`,
            `<p><strong>Trade:</strong> ${escapeHtml(String(user.user_metadata?.profession_type ?? '—'))}</p>`,
            `<p><strong>Plan chosen at signup:</strong> ${escapeHtml(String(user.user_metadata?.plan ?? 'none'))}</p>`,
            `<p><strong>Signed up:</strong> ${escapeHtml(user.created_at ?? '—')}</p>`,
            '<p style="color:#888">This is a verified signup, not a payment. The paying-subscriber alert still comes from the Stripe webhook.</p>',
          ].join(''),
        }).catch(err => console.error('[auth/callback] signup alert failed:', err))
      }

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
