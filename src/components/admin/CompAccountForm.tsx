'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function CompAccountForm() {
  const router   = useRouter()
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<{ name: string; email: string } | null>(null)
  const [error, setError]     = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res  = await fetch('/api/admin/comp-account', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong')
      } else {
        setResult({ name: json.name, email: json.email })
        setEmail('')
        router.refresh()
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-dark-card border border-orange/20 rounded-xl p-6">
      <h2 className="text-white font-semibold text-lg mb-1">Grant Comp Account</h2>
      <p className="text-white/40 text-sm mb-4">
        Sets tier to Elite with full module access. No Stripe required, no expiration. Webhook-protected from accidental cancellation.
      </p>

      <form onSubmit={handleSubmit} className="flex gap-3">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="user@example.com"
          required
          className="nwi-input flex-1"
        />
        <button
          type="submit"
          disabled={loading || !email}
          className="btn-primary px-6 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Granting…' : 'Grant Elite'}
        </button>
      </form>

      {result && (
        <p className="mt-3 text-green-400 text-sm">
          Comped: <strong>{result.name}</strong> ({result.email}) now has Elite access.
        </p>
      )}
      {error && (
        <p className="mt-3 text-red-400 text-sm">{error}</p>
      )}
    </div>
  )
}
