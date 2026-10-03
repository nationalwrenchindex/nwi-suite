'use client'

// ─── Cloudflare Turnstile, for every auth form in both products ────────────────
//
// ONE COMPONENT, FIVE CALL SITES. Supabase CAPTCHA protection is a per-PROJECT
// setting: once it is enabled in the dashboard it applies to signUp,
// signInWithPassword, signInWithOtp, resetPasswordForEmail and resend — ALL of
// them, everywhere. A form that does not send a token stops working entirely.
//
// So the list this had to cover is not "the signup forms", it is every one of
// those calls in the codebase:
//
//   src/app/(auth)/login/page.tsx            signInWithPassword   (LD + Fleet Pro + admin)
//   src/app/(auth)/reset-password/page.tsx   resetPasswordForEmail
//   src/app/(auth)/signup/SignupClient.tsx   signUp               (LD)
//   src/app/hd/login/page.tsx                signInWithPassword   (HD)
//   src/app/hd/signup/page.tsx               signUp               (HD)
//
// Fleet Pro and the admin dashboard have no auth of their own — both redirect to
// /login — and there is no signInWithOtp or resend anywhere in this repo.
//
// NWI-GARAGE IS NOT IN THIS REPOSITORY. If it calls any of those five methods
// against the same Supabase project, it needs the same treatment in its own
// codebase BEFORE the dashboard toggle is flipped, or its users are locked out.
//
// ── THE TWO RULES THAT MATTER ───────────────────────────────────────────────
//
// 1. TOKENS ARE SINGLE-USE. Turnstile issues one token per solve, and Supabase
//    consumes it. Without a reset after every attempt, a failed login cannot be
//    retried — the second submit sends a spent token and fails for a reason the
//    user cannot see. reset() is called on success AND on failure.
//
// 2. NO SITE KEY MEANS NO WIDGET AND NO TOKEN, and every form must still submit.
//    That is what makes this deployable before the dashboard is touched: the code
//    ships, nothing changes, and the toggle is a separate deliberate step.

import { useCallback, useRef, useState } from 'react'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''

/** True when a site key is configured. False means every form runs as it did before. */
export const captchaEnabled = Boolean(TURNSTILE_SITE_KEY)

export interface CaptchaControl {
  /** The solved token, or undefined. Pass straight into options.captchaToken. */
  token: string | undefined
  /** Call after EVERY attempt, success or failure. Tokens are single-use. */
  reset: () => void
  /** Render this inside the form. Renders nothing when no site key is set. */
  field: React.ReactNode
  /**
   * True when a CAPTCHA is required and has not been solved yet.
   *
   * ALWAYS FALSE when there is no site key, so a submit button is never disabled
   * by a widget that is not on the page.
   */
  pending: boolean
}

/**
 * The widget, its token, and the reset — as one object a form can spread in.
 *
 * `options: { captchaToken: captcha.token }` is safe to pass unconditionally:
 * Supabase ignores an undefined captchaToken, so the call is identical to what it
 * was when CAPTCHA is off.
 */
export function useCaptcha(): CaptchaControl {
  const ref = useRef<TurnstileInstance | null>(null)
  const [token, setToken] = useState<string | undefined>(undefined)

  const reset = useCallback(() => {
    setToken(undefined)
    // The widget may already be unmounted on a redirect; a reset that throws must
    // not surface as a login failure.
    try { ref.current?.reset() } catch { /* nothing to reset */ }
  }, [])

  const field = captchaEnabled ? (
    <div className="flex justify-center py-1">
      <Turnstile
        ref={ref}
        siteKey={TURNSTILE_SITE_KEY}
        options={{ theme: 'dark', size: 'flexible' }}
        onSuccess={setToken}
        // A token that expires while the user is still typing must not be sent.
        onExpire={() => setToken(undefined)}
        onError={() => setToken(undefined)}
      />
    </div>
  ) : null

  return { token, reset, field, pending: captchaEnabled && !token }
}
