'use client'

// /fleet-manager/set-password - after the invitation link, he chooses his own password.
// From then on he signs in at /fleet-manager/login with his email and that password.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const inputStyle = { background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827' }

export default function FleetManagerSetPassword() {
  const router = useRouter()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pw.length < 8) return setError('Use at least 8 characters.')
    if (pw !== pw2) return setError('The two passwords do not match.')
    setBusy(true); setError(null)
    const { error } = await createClient().auth.updateUser({ password: pw })
    if (error) { setError(error.message); setBusy(false); return }
    router.push('/fleet-manager'); router.refresh()
  }

  return (
    <main className="pt-8">
      <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#C2410C' }}>Fleet service history</p>
      <h1 className="mt-1 mb-6 text-2xl font-bold" style={{ color: '#111827' }}>Set your password</h1>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-semibold" style={{ color: '#374151' }}>New password
          <input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} className="mt-1 w-full rounded-lg px-3 py-3 text-base" style={inputStyle} />
        </label>
        <label className="block text-sm font-semibold" style={{ color: '#374151' }}>Type it again
          <input type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} className="mt-1 w-full rounded-lg px-3 py-3 text-base" style={inputStyle} />
        </label>
        {error && <p role="alert" className="text-sm" style={{ color: '#991B1B' }}>{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-lg py-3 text-base font-bold text-white disabled:opacity-60" style={{ background: '#C2410C' }}>
          {busy ? 'Saving...' : 'Save and open my fleet'}
        </button>
      </form>
    </main>
  )
}
