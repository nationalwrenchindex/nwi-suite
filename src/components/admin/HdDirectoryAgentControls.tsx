'use client'

import { useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { HD_CATEGORY_LABEL, HD_SERVICE_CATEGORIES } from '@/lib/hd-directory-agent/config'

// Manual triggers for the HD directory agent's three scheduled jobs, plus the
// prospect-table category filter. The routes accept either the cron secret or a
// founder session, so these fetches authenticate on the session cookie alone.

type Action = 'search' | 'invite' | 'follow-up'

export default function HdDirectoryAgentControls({ category }: { category: string | null }) {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const [city,    setCity]    = useState('')
  const [state,   setState]   = useState('')
  const [running, setRunning] = useState<Action | null>(null)
  const [result,  setResult]  = useState<string | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  function onCategoryChange(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next) params.set('category', next)
    else params.delete('category')
    const query = params.toString()
    router.push(query ? `${pathname}?${query}` : pathname)
  }

  async function run(action: Action, body?: Record<string, unknown>) {
    setRunning(action)
    setError(null)
    setResult(null)

    try {
      const res = await fetch(`/api/hd-directory-agent/${action}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body ?? {}),
      })
      const json = await res.json()

      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`)
      } else if (action === 'search') {
        const names   = (json.businessNames as string[] | undefined) ?? []
        const skipped = (json.skipped as Array<{ city: string }> | undefined) ?? []
        setResult(
          `Found ${json.newProspects ?? 0} new prospect${json.newProspects === 1 ? '' : 's'}` +
          (names.length > 0 ? `: ${names.slice(0, 10).join(', ')}${names.length > 10 ? '…' : ''}` : '') +
          (skipped.length > 0 ? ` · ${skipped.length} city/cities skipped on time budget` : ''),
        )
        router.refresh()
      } else {
        setResult(`Sent ${json.sent ?? 0} SMS${json.failed ? ` · ${json.failed} failed` : ''}`)
        router.refresh()
      }
    } catch {
      setError('Network error')
    } finally {
      setRunning(null)
    }
  }

  const busy = running !== null

  return (
    <div className="bg-dark-card border border-orange/20 rounded-xl p-6">
      <h2 className="text-white font-semibold text-lg mb-1">Manual Controls</h2>
      <p className="text-white/40 text-sm mb-4">
        Same jobs as the crons (search Tuesdays 8am UTC · invites daily 10am UTC ·
        follow-ups Thursdays 9am UTC). A full sweep covers 15 corridor cities; searching one
        city here is faster and never hits the time budget.
      </p>

      <form
        onSubmit={e => {
          e.preventDefault()
          void run('search', { city: city.trim(), state: state.trim() })
        }}
        className="flex gap-3 flex-wrap mb-4"
      >
        <input
          type="text"
          value={city}
          onChange={e => setCity(e.target.value)}
          placeholder="City (e.g. Knoxville)"
          required
          className="nwi-input flex-1 min-w-48"
        />
        <input
          type="text"
          value={state}
          onChange={e => setState(e.target.value)}
          placeholder="State (e.g. TN)"
          required
          maxLength={2}
          className="nwi-input w-32"
        />
        <button
          type="submit"
          disabled={busy || !city.trim() || !state.trim()}
          className="btn-primary px-6 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running === 'search' ? 'Searching…' : 'Search City'}
        </button>
      </form>

      <div className="flex gap-3 flex-wrap items-center">
        <button
          type="button"
          onClick={() => void run('invite')}
          disabled={busy}
          className="btn-primary px-6 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running === 'invite' ? 'Sending…' : 'Send Invites'}
        </button>
        <button
          type="button"
          onClick={() => void run('follow-up')}
          disabled={busy}
          className="btn-secondary px-6 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running === 'follow-up' ? 'Sending…' : 'Send Follow-Ups'}
        </button>

        <label className="text-white/40 text-sm ml-auto">
          Filter
          <select
            value={category ?? ''}
            onChange={e => onCategoryChange(e.target.value)}
            className="nwi-input w-44 ml-2"
          >
            <option value="">All categories</option>
            {HD_SERVICE_CATEGORIES.map(c => (
              <option key={c} value={c}>{HD_CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </label>
      </div>

      {result && <p className="mt-3 text-green-400 text-sm">{result}</p>}
      {error  && <p className="mt-3 text-red-400 text-sm">{error}</p>}
    </div>
  )
}
