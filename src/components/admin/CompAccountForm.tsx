'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const TIER_OPTIONS = [
  { group: 'Light Duty', options: [
    { value: 'starter',         label: 'LD Starter'         },
    { value: 'pro',             label: 'LD Pro'             },
    { value: 'full_suite',      label: 'LD Full Suite'      },
    { value: 'full_suite_plus', label: 'LD Full Suite Plus' },
    { value: 'elite',           label: 'LD Elite'           },
  ]},
  { group: 'Heavy Duty', options: [
    { value: 'hd_reefer',  label: 'HD Reefer Standalone' },
    { value: 'hd_starter', label: 'HD Starter' },
    { value: 'hd_pro',     label: 'HD Pro'     },
    { value: 'hd_elite',   label: 'HD Elite'   },
  ]},
]

export default function CompAccountForm() {
  const router   = useRouter()
  const [email,  setEmail]   = useState('')
  const [tier,   setTier]    = useState('elite')
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<{ name: string; email: string; tier: string } | null>(null)
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
        body:    JSON.stringify({ email, tier }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong')
      } else {
        setResult({ name: json.name, email: json.email, tier: json.tier })
        setEmail('')
        router.refresh()
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  const selectedLabel = TIER_OPTIONS.flatMap(g => g.options).find(o => o.value === tier)?.label ?? tier

  return (
    <div className="bg-dark-card border border-orange/20 rounded-xl p-6">
      <h2 className="text-white font-semibold text-lg mb-1">Grant Comp Account</h2>
      <p className="text-white/40 text-sm mb-4">
        No Stripe required, no expiration. Webhook-protected from accidental cancellation. HD tiers set vertical = heavy_duty automatically.
      </p>

      <form onSubmit={handleSubmit} className="flex gap-3 flex-wrap">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="user@example.com"
          required
          className="nwi-input flex-1 min-w-48"
        />
        <select
          value={tier}
          onChange={e => setTier(e.target.value)}
          className="nwi-input w-48"
        >
          {TIER_OPTIONS.map(group => (
            <optgroup key={group.group} label={group.group}>
              {group.options.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="submit"
          disabled={loading || !email}
          className="btn-primary px-6 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Granting…' : `Grant ${selectedLabel}`}
        </button>
      </form>

      {result && (
        <p className="mt-3 text-green-400 text-sm">
          Comped: <strong>{result.name}</strong> ({result.email}) → <strong>{result.tier}</strong>
        </p>
      )}
      {error && (
        <p className="mt-3 text-red-400 text-sm">{error}</p>
      )}
    </div>
  )
}
