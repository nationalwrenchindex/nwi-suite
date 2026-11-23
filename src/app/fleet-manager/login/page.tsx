'use client'

// /fleet-manager/login - the fleet manager signs in with his own email and password.
// Its own page rather than /login: /login sends an account with no business name to
// the mechanic onboarding wizard, which a fleet customer must never see.

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useCaptcha } from '@/components/auth/CaptchaField'

const input = 'w-full rounded-lg px-3 py-3 text-base'
const inputStyle = { background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827' }

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(
    params.get('error') === 'link' ? 'That link has expired or was already used. Sign in with your password, or ask your service shop to send a new invitation.' : null)
  const captcha = useCaptcha()

  // Already signed in: straight to the dashboard.
  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => { if (data.user) router.replace('/fleet-manager') })
  }, [router])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password, options: { captchaToken: captcha.token } })
    captcha.reset()
    if (error) { setError(error.message); setBusy(false); return }
    router.push('/fleet-manager'); router.refresh()
  }

  return (
    <main className="pt-8">
      <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#C2410C' }}>Fleet service history</p>
      <h1 className="mt-1 mb-6 text-2xl font-bold" style={{ color: '#111827' }}>Sign in</h1>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-semibold" style={{ color: '#374151' }}>Email
          <input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className={`${input} mt-1`} style={inputStyle} />
        </label>
        <label className="block text-sm font-semibold" style={{ color: '#374151' }}>Password
          <input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className={`${input} mt-1`} style={inputStyle} />
        </label>
        {error && <p role="alert" className="text-sm" style={{ color: '#991B1B' }}>{error}</p>}
        {captcha.field}
        <button type="submit" disabled={busy || captcha.pending} className="w-full rounded-lg py-3 text-base font-bold text-white disabled:opacity-60" style={{ background: '#C2410C' }}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      <p className="mt-6 text-sm" style={{ color: '#4B5563' }}>
        Forgot your password? <Link href="/reset-password" className="font-semibold" style={{ color: '#C2410C' }}>Reset it</Link>
      </p>
    </main>
  )
}

export default function FleetManagerLogin() {
  return <Suspense><LoginForm /></Suspense>
}
