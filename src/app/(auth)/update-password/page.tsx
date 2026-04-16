'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function UpdatePasswordPage() {
  const router = useRouter()

  const [password, setPassword]     = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [success, setSuccess]       = useState(false)

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault()

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPwd) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSuccess(true)
    setTimeout(() => router.push('/dashboard'), 2500)
  }

  if (success) {
    return (
      <div className="py-10 text-center">
        <div className="w-16 h-16 bg-success/10 border border-success/30 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-success" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="font-condensed font-bold text-3xl text-white mb-3 tracking-wide">
          PASSWORD UPDATED
        </h1>
        <p className="text-white/60 text-sm">
          Your password has been changed. Redirecting you to the dashboard…
        </p>
      </div>
    )
  }

  return (
    <div className="py-10">
      <div className="mb-8">
        <div className="w-12 h-12 bg-orange/10 border border-orange/30 rounded-xl flex items-center justify-center mb-6">
          <svg className="w-6 h-6 text-orange" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h1 className="font-condensed font-bold text-4xl text-white tracking-wide mb-2">
          SET NEW PASSWORD
        </h1>
        <p className="text-white/50 text-sm">
          Choose a strong password for your account.
        </p>
      </div>

      {error && <div className="alert-error mb-5">{error}</div>}

      <form onSubmit={handleUpdate} className="space-y-5">
        <div>
          <label htmlFor="password" className="nwi-label">New password</label>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 8 characters"
            className="nwi-input"
          />
          {/* Strength bar */}
          {password.length > 0 && (
            <div className="mt-2 flex gap-1">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    password.length >= i * 3
                      ? password.length < 8
                        ? 'bg-danger'
                        : password.length < 12
                        ? 'bg-yellow-500'
                        : 'bg-success'
                      : 'bg-dark-border'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <label htmlFor="confirmPwd" className="nwi-label">Confirm new password</label>
          <input
            id="confirmPwd"
            type="password"
            required
            autoComplete="new-password"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            placeholder="••••••••"
            className={`nwi-input ${
              confirmPwd && confirmPwd !== password ? 'nwi-input-error' : ''
            }`}
          />
          {confirmPwd && confirmPwd !== password && (
            <p className="text-danger text-xs mt-1">Passwords don&apos;t match</p>
          )}
        </div>

        <button type="submit" disabled={loading} className="btn-primary mt-2">
          {loading ? 'Updating…' : 'UPDATE PASSWORD'}
        </button>
      </form>
    </div>
  )
}
