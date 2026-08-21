'use client'

import { useCallback, useEffect, useState } from 'react'
import { FLEET_PRO_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/types/fleet-pro'
import type { FleetProMemberRow, FleetProRole, FleetProStatus } from '@/types/fleet-pro'

const FP_ORANGE = '#E85D24'

const STATUS_COLOR: Record<FleetProStatus, string> = {
  active:  '#22C55E',
  invited: FP_ORANGE,
  revoked: 'rgba(255,255,255,0.4)',
}

const STATUS_LABEL: Record<FleetProStatus, string> = {
  active:  'Active',
  invited: 'Invited',
  revoked: 'Revoked',
}

function fmtDate(value: string | null): string {
  if (!value) return '—'
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return '—'
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function StatusPill({ status }: { status: FleetProStatus }) {
  const color = STATUS_COLOR[status]
  return (
    <span
      className="text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ background: `${color}20`, color }}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

export default function TeamClient({ fleetName }: { fleetName: string }) {
  const [members, setMembers] = useState<FleetProMemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Invite form
  const [email,    setEmail]    = useState('')
  const [fullName, setFullName] = useState('')
  const [role,     setRole]     = useState<FleetProRole>('viewer')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteNote,  setInviteNote]  = useState<string | null>(null)

  // Row-level state — keyed by member id so one busy row never freezes the table.
  const [busyId,  setBusyId]  = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res  = await fetch('/api/fleet-pro/members', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load the roster')
      setMembers((json.members ?? []) as FleetProMemberRow[])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the roster')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setInviting(true)
    setInviteError(null)
    setInviteNote(null)
    try {
      const res = await fetch('/api/fleet-pro/members', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          email:     email.trim(),
          role,
          full_name: fullName.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not send that invitation')

      setEmail('')
      setFullName('')
      setRole('viewer')
      setInviteNote(`Invitation sent to ${(json.member as FleetProMemberRow).email}.`)
      await load()
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Could not send that invitation')
    } finally {
      setInviting(false)
    }
  }

  async function handleRoleChange(member: FleetProMemberRow, next: FleetProRole) {
    if (next === member.role) return
    setBusyId(member.id)
    setRowError(null)
    try {
      const res = await fetch(`/api/fleet-pro/members/${member.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ role: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not update that role')
      const updated = json.member as FleetProMemberRow
      setMembers(prev => prev.map(m => (m.id === member.id ? { ...updated, is_self: m.is_self } : m)))
    } catch (err) {
      setRowError({ id: member.id, message: err instanceof Error ? err.message : 'Could not update that role' })
    } finally {
      setBusyId(null)
    }
  }

  async function handleRevoke(member: FleetProMemberRow) {
    const what = member.status === 'invited' ? 'Cancel the invitation for' : 'Remove access for'
    if (!window.confirm(`${what} ${member.email}?`)) return
    setBusyId(member.id)
    setRowError(null)
    try {
      const res = await fetch(`/api/fleet-pro/members/${member.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not revoke that member')
      const updated = json.member as FleetProMemberRow
      setMembers(prev => prev.map(m => (m.id === member.id ? { ...updated, is_self: m.is_self } : m)))
    } catch (err) {
      setRowError({ id: member.id, message: err instanceof Error ? err.message : 'Could not revoke that member' })
    } finally {
      setBusyId(null)
    }
  }

  const active  = members.filter(m => m.status === 'active')
  const pending = members.filter(m => m.status === 'invited')
  const revoked = members.filter(m => m.status === 'revoked')

  function renderTable(rows: FleetProMemberRow[], dateLabel: string) {
    return (
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]" style={{ background: '#111920' }}>
            <thead style={{ background: '#162030' }}>
              <tr>
                {['Member', 'Role', 'Status', dateLabel, ''].map((h, i) => (
                  <th
                    key={h || `col-${i}`}
                    className="text-left text-xs uppercase tracking-wider font-medium px-4 py-3"
                    style={{ color: 'rgba(255,255,255,0.4)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(m => {
                const busy    = busyId === m.id
                const isGone  = m.status === 'revoked'
                const rowErr  = rowError?.id === m.id ? rowError.message : null
                return (
                  <tr key={m.id} style={{ borderTop: '1px solid #1e3040', opacity: isGone ? 0.5 : 1 }}>
                    <td className="px-4 py-3 align-top">
                      <p className="text-sm text-white font-medium">
                        {m.full_name || m.email}
                        {m.is_self && (
                          <span className="ml-2 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                            (you)
                          </span>
                        )}
                      </p>
                      {m.full_name && (
                        <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>{m.email}</p>
                      )}
                      {rowErr && <p className="text-xs mt-1 text-red-400">{rowErr}</p>}
                    </td>

                    <td className="px-4 py-3 align-top">
                      {isGone ? (
                        <span className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                          {ROLE_LABELS[m.role]}
                        </span>
                      ) : (
                        <select
                          value={m.role}
                          disabled={busy}
                          onChange={e => void handleRoleChange(m, e.target.value as FleetProRole)}
                          className="px-2 py-1.5 rounded-lg text-sm text-white"
                          style={{ background: '#162030', border: '1px solid #1e3040', opacity: busy ? 0.5 : 1 }}
                        >
                          {FLEET_PRO_ROLES.map(r => (
                            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                          ))}
                        </select>
                      )}
                    </td>

                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      <StatusPill status={m.status} />
                    </td>

                    <td
                      className="px-4 py-3 align-top text-sm whitespace-nowrap"
                      style={{ color: 'rgba(255,255,255,0.5)' }}
                    >
                      {fmtDate(m.status === 'active' ? m.accepted_at : m.invited_at)}
                    </td>

                    <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                      {!isGone && (
                        <button
                          onClick={() => void handleRevoke(m)}
                          disabled={busy}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity"
                          style={{
                            background: 'rgba(239,68,68,0.12)',
                            color:      '#F87171',
                            opacity:    busy ? 0.5 : 1,
                          }}
                        >
                          {m.status === 'invited' ? 'Cancel' : 'Remove'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6">
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            NWI Fleet Pro
          </p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">TEAM</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Who at {fleetName} can see this portal, and what each of them can do.
          </p>
        </header>

        {/* ── invite ───────────────────────────────────────────────────────── */}
        <section
          className="rounded-xl p-4 sm:p-5 mb-8"
          style={{ background: '#111920', border: '1px solid #1e3040' }}
        >
          <h2 className="font-condensed font-bold text-lg text-white tracking-wide mb-4">
            INVITE SOMEONE
          </h2>

          <form onSubmit={handleInvite} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="invite-email"
                  className="block text-xs uppercase tracking-wider mb-1.5"
                  style={{ color: 'rgba(255,255,255,0.4)' }}
                >
                  Email address
                </label>
                <input
                  id="invite-email"
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@department.gov"
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                  style={{ background: '#162030', border: '1px solid #1e3040' }}
                />
              </div>

              <div>
                <label
                  htmlFor="invite-name"
                  className="block text-xs uppercase tracking-wider mb-1.5"
                  style={{ color: 'rgba(255,255,255,0.4)' }}
                >
                  Name <span className="normal-case">(optional)</span>
                </label>
                <input
                  id="invite-name"
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Dale Whitaker"
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
                  style={{ background: '#162030', border: '1px solid #1e3040' }}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="invite-role"
                className="block text-xs uppercase tracking-wider mb-1.5"
                style={{ color: 'rgba(255,255,255,0.4)' }}
              >
                Access level
              </label>
              <select
                id="invite-role"
                value={role}
                onChange={e => setRole(e.target.value as FleetProRole)}
                className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                style={{ background: '#162030', border: '1px solid #1e3040' }}
              >
                {FLEET_PRO_ROLES.map(r => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
              <p className="text-xs mt-2 leading-relaxed" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {ROLE_DESCRIPTIONS[role]}
              </p>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={inviting || !email.trim()}
                className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity"
                style={{ background: FP_ORANGE, opacity: inviting || !email.trim() ? 0.5 : 1 }}
              >
                {inviting ? 'Sending…' : 'Send invitation'}
              </button>
              {inviteError && <p className="text-xs text-red-400">{inviteError}</p>}
              {inviteNote  && <p className="text-xs" style={{ color: '#22C55E' }}>{inviteNote}</p>}
            </div>
          </form>
        </section>

        {/* ── roster ───────────────────────────────────────────────────────── */}
        {loading ? (
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Loading the roster…</p>
        ) : loadError ? (
          <div
            className="rounded-xl p-4 text-sm"
            style={{ background: '#111920', border: '1px solid #1e3040', color: '#F87171' }}
          >
            {loadError}
          </div>
        ) : (
          <div className="space-y-8">
            <section>
              <h2 className="font-condensed font-bold text-lg text-white tracking-wide mb-3">
                ACTIVE MEMBERS <span style={{ color: 'rgba(255,255,255,0.3)' }}>({active.length})</span>
              </h2>
              {active.length === 0 ? (
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Nobody has accepted an invitation yet.
                </p>
              ) : renderTable(active, 'Joined')}
            </section>

            {pending.length > 0 && (
              <section>
                <h2 className="font-condensed font-bold text-lg text-white tracking-wide mb-3">
                  PENDING INVITATIONS <span style={{ color: FP_ORANGE }}>({pending.length})</span>
                </h2>
                <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  These people have been emailed a link but have not signed in yet. Invitations expire after 14 days.
                </p>
                {renderTable(pending, 'Invited')}
              </section>
            )}

            {revoked.length > 0 && (
              <section>
                <h2 className="font-condensed font-bold text-lg text-white tracking-wide mb-3">
                  REVOKED <span style={{ color: 'rgba(255,255,255,0.3)' }}>({revoked.length})</span>
                </h2>
                <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Access removed. Kept for the record — invite the same address again to restore it.
                </p>
                {renderTable(revoked, 'Invited')}
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
