'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect') ?? '/dashboard'

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const urlError = searchParams.get('error')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // Check if onboarding is needed
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('business_name')
        .eq('id', user.id)
        .single()

      if (!profile?.business_name) {
        router.push('/onboarding')
        return
      }
    }

    router.push(redirectTo)
    router.refresh()
  }

  return (
    <div className="py-10">
      <div className="mb-8">
        <h1 className="font-condensed font-bold text-4xl text-white tracking-wide mb-2">
          WELCOME BACK
        </h1>
        <p className="text-white/50 text-sm">
          Sign in to your National Wrench Index Suite&#8482; account.
        </p>
      </div>

      {(error || urlError) && (
        <div className="alert-error mb-6">
          {error ?? 'Authentication error. Please try again.'}
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-5">
        <div>
          <label htmlFor="email" className="nwi-label">Email address</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="nwi-input"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="password" className="nwi-label mb-0">Password</label>
            <Link href="/reset-password" className="text-orange text-xs hover:text-orange-light transition-colors">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="nwi-input"
          />
        </div>

        <button type="submit" disabled={loading} className="btn-primary mt-2">
          {loading ? 'Signing in…' : 'SIGN IN'}
        </button>
      </form>

      <div className="mt-6 text-center">
        <p className="text-white/40 text-sm">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="text-orange hover:text-orange-light transition-colors font-medium">
            Create one free
          </Link>
        </p>
      </div>

      {/* Divider */}
      <div className="relative my-8">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-dark-border" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-dark px-3 text-white/30 text-xs">SECURE LOGIN</span>
        </div>
      </div>

      <p className="text-white/20 text-xs text-center leading-relaxed">
        Your data is protected with industry-standard encryption and Supabase row-level security.
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
