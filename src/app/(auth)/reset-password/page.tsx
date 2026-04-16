'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordPage() {
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [sent, setSent]       = useState(false)

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/update-password`,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <div className="py-10 text-center">
        <div className="w-16 h-16 bg-orange/10 border border-orange/30 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-7 h-7 text-orange" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h1 className="font-condensed font-bold text-3xl text-white mb-3 tracking-wide">
          CHECK YOUR INBOX
        </h1>
        <p className="text-white/60 text-sm leading-relaxed mb-2">
          We sent a password reset link to
        </p>
        <p className="text-orange font-medium mb-6">{email}</p>
        <p className="text-white/40 text-xs mb-8">
          The link expires in 1 hour. Don&apos;t see it? Check your spam folder.
        </p>
        <button
          onClick={() => setSent(false)}
          className="text-white/50 hover:text-white text-sm transition-colors underline underline-offset-2"
        >
          Try a different email
        </button>
        <div className="mt-4">
          <Link href="/login" className="btn-ghost block text-center">
            ← Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="py-10">
      <div className="mb-8">
        <Link href="/login" className="flex items-center gap-1.5 text-white/40 hover:text-white text-sm transition-colors mb-6">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to sign in
        </Link>

        <h1 className="font-condensed font-bold text-4xl text-white tracking-wide mb-2">
          RESET PASSWORD
        </h1>
        <p className="text-white/50 text-sm leading-relaxed">
          Enter the email address tied to your account. We&apos;ll send you a secure link to set a new password.
        </p>
      </div>

      {error && <div className="alert-error mb-5">{error}</div>}

      <form onSubmit={handleReset} className="space-y-5">
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

        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'Sending…' : 'SEND RESET LINK'}
        </button>
      </form>
    </div>
  )
}
