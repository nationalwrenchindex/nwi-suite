'use client'

// The shop's side of the fleet manager dashboard: invite a fleet manager by email onto
// THIS fleet account, see who has access, remove it. He gets the fleet's units, PM
// due, repair history, PM/DOT sheets, and his invoices exactly as printed for him -
// never the shop's cost, markup or internal notes (lib/fleet-view/unit-history).

import { useCallback, useEffect, useState } from 'react'

interface Manager { user_id: string; email: string | null; granted_at: string | null; signed_in: boolean }

export default function FleetManagerAccess({ fleetAccountId }: { fleetAccountId: string }) {
  const base = `/api/hd/fleet-accounts/${fleetAccountId}/managers`
  const [managers, setManagers] = useState<Manager[] | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const r = await fetch(base)
    const j = await r.json().catch(() => ({}))
    setManagers(r.ok ? (j.managers ?? []) : [])
    if (!r.ok) setMsg({ ok: false, text: j.error ?? 'Could not load fleet managers.' })
  }, [base])
  useEffect(() => { void load() }, [load])

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const r = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, text: j.error ?? 'Could not send the invitation.' }); return }
    setEmail('')
    setMsg({ ok: true, text: j.email_sent
      ? `Invitation sent to ${j.manager?.email}. They set their own password from the link.`
      : `Access granted to ${j.manager?.email}, but the email was not sent. Ask them to use "Forgot password" at /fleet-manager/login.` })
    void load()
  }

  async function remove(m: Manager) {
    if (!window.confirm(`Remove ${m.email ?? 'this fleet manager'}'s access to this fleet?`)) return
    const r = await fetch(`${base}?user_id=${encodeURIComponent(m.user_id)}`, { method: 'DELETE' })
    const j = await r.json().catch(() => ({}))
    setMsg(r.ok ? { ok: true, text: `${m.email ?? 'Fleet manager'} no longer has access.` } : { ok: false, text: j.error ?? 'Could not remove access.' })
    void load()
  }

  return (
    <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--hd-border)' }} data-testid="fleet-manager-access">
      <p className="font-condensed font-bold text-white text-lg tracking-wide mb-1">FLEET MANAGER ACCESS</p>
      <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--hd-text-faint)' }}>
        Their own login to this fleet&apos;s units, PM due, repair history, PM and DOT sheets, and the invoices you sent them, as printed. Your parts cost, markup and internal notes are never shown.
      </p>
      <form onSubmit={invite} className="flex flex-col sm:flex-row gap-2">
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="manager@fleet.com"
          className="nwi-input flex-1 rounded-lg px-3 py-2 text-sm" aria-label="Fleet manager email" />
        <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold text-on-accent disabled:opacity-60" style={{ background: '#E85D24' }}>
          {busy ? 'Inviting...' : 'Invite'}
        </button>
      </form>
      {msg && <p className="text-xs mt-2" style={{ color: msg.ok ? 'var(--hd-positive)' : 'var(--hd-negative)' }}>{msg.text}</p>}
      <div className="mt-3 space-y-2">
        {managers === null ? (
          <p className="text-xs" style={{ color: 'var(--hd-text-faint)' }}>Loading...</p>
        ) : managers.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--hd-text-faint)' }}>No fleet manager has access yet.</p>
        ) : managers.map(m => (
          <div key={m.user_id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 break-all text-white">{m.email}
              <span className="ml-2 text-xs" style={{ color: 'var(--hd-text-faint)' }}>{m.signed_in ? 'signed in' : 'invited'}</span>
            </span>
            <button type="button" onClick={() => void remove(m)} className="text-xs font-semibold shrink-0" style={{ color: 'var(--hd-negative)' }}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  )
}
