'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { FLEET_PRO_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/types/fleet-pro'
import type { FleetProMemberRow, FleetProRole } from '@/types/fleet-pro'
import { NWI_ORANGE } from '@/components/fleet-pro/brand'

/**
 * One row of the partner's book of business: the fleet's CRM record joined to the
 * white-label settings on fleet_pro_reseller_accounts, plus the two counts the
 * partner actually scans this table for.
 *
 * Declared here rather than in src/types/fleet-pro-partner.ts because
 * PartnerFleetRow there is the DASHBOARD's shape — it carries revenue, PM and
 * defect figures this screen never loads. The API routes import this type so the
 * wire format and the table can never drift.
 */
export interface PartnerAccountRow {
  fleet_account_id:   string
  fleet_name:         string
  contact_name:       string | null
  contact_email:      string | null
  contact_phone:      string | null
  brand_name:         string
  brand_logo_url:     string | null
  brand_accent_color: string | null
  fleet_pro_enabled:  boolean
  fleet_pro_status:   string | null
  unit_count:         number
  member_count:       number
  created_at:         string | null
}

const CARD    = '#111920'
const HEAD    = '#162030'
const BORDER  = '#1e3040'
const GREEN   = '#22C55E'
const MUTED   = 'rgba(255,255,255,0.4)'
const ENABLED_LABEL = 'Fleet Pro on'

const INPUT_CLASS = 'w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20'
const INPUT_STYLE = { background: HEAD, border: `1px solid ${BORDER}` }
const LABEL_CLASS = 'block text-xs uppercase tracking-wider mb-1.5'

type PanelKind = 'brand' | 'invite'

interface BrandDraft {
  fleet_name:         string
  contact_name:       string
  contact_email:      string
  contact_phone:      string
  brand_name:         string
  brand_logo_url:     string
  brand_accent_color: string
}

const ACCENT_HEX = /^#[0-9a-f]{6}$/i

function draftFrom(row: PartnerAccountRow): BrandDraft {
  return {
    fleet_name:         row.fleet_name,
    contact_name:       row.contact_name  ?? '',
    contact_email:      row.contact_email ?? '',
    contact_phone:      row.contact_phone ?? '',
    brand_name:         row.brand_name,
    brand_logo_url:     row.brand_logo_url ?? '',
    brand_accent_color: row.brand_accent_color ?? '',
  }
}

function statusLabel(row: PartnerAccountRow): string {
  if (!row.fleet_pro_enabled) return 'Not enabled'
  const status = row.fleet_pro_status
  if (!status || status === 'active') return ENABLED_LABEL
  return `${ENABLED_LABEL} — ${status.replace(/_/g, ' ')}`
}

function StatusPill({ row }: { row: PartnerAccountRow }) {
  const color = row.fleet_pro_enabled ? GREEN : MUTED
  return (
    <span
      className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: `${color}20`, color }}
    >
      {statusLabel(row)}
    </span>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required = false,
}: {
  id:           string
  label:        string
  value:        string
  onChange:     (next: string) => void
  placeholder?: string
  type?:        string
  required?:    boolean
}) {
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS} style={{ color: MUTED }}>{label}</label>
      <input
        id={id}
        type={type}
        required={required}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={INPUT_CLASS}
        style={INPUT_STYLE}
      />
    </div>
  )
}

export default function AccountsClient({ partnerName }: { partnerName: string }) {
  const [rows,      setRows]      = useState<PartnerAccountRow[]>([])
  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // ── add form ───────────────────────────────────────────────────────────────
  const [showAdd,     setShowAdd]     = useState(false)
  const [creating,    setCreating]    = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createNote,  setCreateNote]  = useState<string | null>(null)
  const [newFleet,   setNewFleet]   = useState('')
  const [newName,    setNewName]    = useState('')
  const [newEmail,   setNewEmail]   = useState('')
  const [newPhone,   setNewPhone]   = useState('')
  const [newBrand,   setNewBrand]   = useState('')
  const [newLogo,    setNewLogo]    = useState('')
  const [newAccent,  setNewAccent]  = useState('')

  // ── per-row state ──────────────────────────────────────────────────────────
  // Keyed by fleet_account_id so a failure on one customer never blanks the table
  // or freezes the rows either side of it.
  const [openPanel, setOpenPanel] = useState<{ id: string; kind: PanelKind } | null>(null)
  const [busyId,    setBusyId]    = useState<string | null>(null)
  const [rowError,  setRowError]  = useState<{ id: string; message: string } | null>(null)
  const [rowNote,   setRowNote]   = useState<{ id: string; message: string } | null>(null)

  const [draft, setDraft] = useState<BrandDraft | null>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName,  setInviteName]  = useState('')
  const [inviteRole,  setInviteRole]  = useState<FleetProRole>('manager')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res  = await fetch('/api/fleet-pro/partner/accounts', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load your fleet accounts')
      setRows((json.accounts ?? []) as PartnerAccountRow[])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load your fleet accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function openBrand(row: PartnerAccountRow) {
    const isOpen = openPanel?.id === row.fleet_account_id && openPanel.kind === 'brand'
    setRowError(null)
    setRowNote(null)
    if (isOpen) {
      setOpenPanel(null)
      setDraft(null)
      return
    }
    setDraft(draftFrom(row))
    setOpenPanel({ id: row.fleet_account_id, kind: 'brand' })
  }

  function openInvite(row: PartnerAccountRow) {
    const isOpen = openPanel?.id === row.fleet_account_id && openPanel.kind === 'invite'
    setRowError(null)
    setRowNote(null)
    if (isOpen) {
      setOpenPanel(null)
      return
    }
    setInviteEmail('')
    setInviteName('')
    setInviteRole('manager')
    setOpenPanel({ id: row.fleet_account_id, kind: 'invite' })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newFleet.trim()) return
    if (newAccent.trim() && !ACCENT_HEX.test(newAccent.trim())) {
      setCreateError('Accent color must be a 6-digit hex value like #ff6600')
      return
    }
    setCreating(true)
    setCreateError(null)
    setCreateNote(null)
    try {
      const res = await fetch('/api/fleet-pro/partner/accounts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          fleet_name:         newFleet.trim(),
          contact_name:       newName.trim()   || undefined,
          contact_email:      newEmail.trim()  || undefined,
          contact_phone:      newPhone.trim()  || undefined,
          brand_name:         newBrand.trim()  || undefined,
          brand_logo_url:     newLogo.trim()   || undefined,
          brand_accent_color: newAccent.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not create that fleet account')

      const created = json.account as PartnerAccountRow
      setRows(prev => [...prev, created].sort((a, b) => a.fleet_name.localeCompare(b.fleet_name)))
      setNewFleet('')
      setNewName('')
      setNewEmail('')
      setNewPhone('')
      setNewBrand('')
      setNewLogo('')
      setNewAccent('')
      setShowAdd(false)
      setCreateNote(`${created.fleet_name} added. Invite their fleet manager, then turn Fleet Pro on when they are ready to be billed.`)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create that fleet account')
    } finally {
      setCreating(false)
    }
  }

  async function handleSaveBrand(row: PartnerAccountRow, e: React.FormEvent) {
    e.preventDefault()
    if (!draft) return
    if (!draft.fleet_name.trim()) {
      setRowError({ id: row.fleet_account_id, message: 'A fleet name is required' })
      return
    }
    if (draft.brand_accent_color.trim() && !ACCENT_HEX.test(draft.brand_accent_color.trim())) {
      setRowError({ id: row.fleet_account_id, message: 'Accent color must be a 6-digit hex value like #ff6600' })
      return
    }
    setBusyId(row.fleet_account_id)
    setRowError(null)
    setRowNote(null)
    try {
      const res = await fetch(`/api/fleet-pro/partner/accounts/${row.fleet_account_id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          fleet_name:         draft.fleet_name.trim(),
          contact_name:       draft.contact_name.trim(),
          contact_email:      draft.contact_email.trim(),
          contact_phone:      draft.contact_phone.trim(),
          brand_name:         draft.brand_name.trim(),
          brand_logo_url:     draft.brand_logo_url.trim(),
          brand_accent_color: draft.brand_accent_color.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save those changes')

      const patch = (json.account ?? {}) as Partial<PartnerAccountRow>
      setRows(prev => prev
        .map(r => (r.fleet_account_id === row.fleet_account_id ? { ...r, ...patch } : r))
        .sort((a, b) => a.fleet_name.localeCompare(b.fleet_name)))
      setOpenPanel(null)
      setDraft(null)
      setRowNote({ id: row.fleet_account_id, message: 'Saved.' })
    } catch (err) {
      setRowError({
        id:      row.fleet_account_id,
        message: err instanceof Error ? err.message : 'Could not save those changes',
      })
    } finally {
      setBusyId(null)
    }
  }

  async function handleInvite(row: PartnerAccountRow, e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setBusyId(row.fleet_account_id)
    setRowError(null)
    setRowNote(null)
    try {
      const res = await fetch(`/api/fleet-pro/partner/accounts/${row.fleet_account_id}/invite`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          email:     inviteEmail.trim(),
          role:      inviteRole,
          full_name: inviteName.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not send that invitation')

      const member = json.member as FleetProMemberRow
      setRows(prev => prev.map(r => (
        r.fleet_account_id === row.fleet_account_id
          ? { ...r, member_count: r.member_count + 1 }
          : r
      )))
      setInviteEmail('')
      setInviteName('')
      setOpenPanel(null)
      setRowNote({ id: row.fleet_account_id, message: `Invitation sent to ${member.email}.` })
    } catch (err) {
      setRowError({
        id:      row.fleet_account_id,
        message: err instanceof Error ? err.message : 'Could not send that invitation',
      })
    } finally {
      setBusyId(null)
    }
  }

  async function handleUnlink(row: PartnerAccountRow) {
    const confirmed = window.confirm(
      `Remove ${row.fleet_name} from your partner account?\n\n` +
      'Their units, work orders and inspection history are kept — only the reseller ' +
      'link and the white-label settings are removed.',
    )
    if (!confirmed) return

    setBusyId(row.fleet_account_id)
    setRowError(null)
    setRowNote(null)
    try {
      const res = await fetch(`/api/fleet-pro/partner/accounts/${row.fleet_account_id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not unlink that fleet account')
      setRows(prev => prev.filter(r => r.fleet_account_id !== row.fleet_account_id))
      setOpenPanel(null)
    } catch (err) {
      setRowError({
        id:      row.fleet_account_id,
        message: err instanceof Error ? err.message : 'Could not unlink that fleet account',
      })
    } finally {
      setBusyId(null)
    }
  }

  const enabledCount = rows.filter(r => r.fleet_pro_enabled).length

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest mb-1 font-semibold" style={{ color: NWI_ORANGE }}>
          {partnerName}
        </p>
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">FLEET ACCOUNTS</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.5)' }}>
          Every fleet you resell, how it is branded in their portal, and who you have seated on it.
          {rows.length > 0 && ` ${enabledCount} of ${rows.length} billing.`}
        </p>
      </header>

      {/* ── add ───────────────────────────────────────────────────────────── */}
      <section className="rounded-xl p-4 sm:p-5 mb-8" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-condensed font-bold text-lg text-white tracking-wide">ADD FLEET ACCOUNT</h2>
            <p className="text-xs mt-1" style={{ color: MUTED }}>
              Creates the customer record only. Nothing is billed until you turn Fleet Pro on for them.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setShowAdd(v => !v); setCreateError(null); setCreateNote(null) }}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: NWI_ORANGE }}
          >
            {showAdd ? 'Cancel' : 'Add fleet account'}
          </button>
        </div>

        {createNote && !showAdd && (
          <p className="text-xs mt-3" style={{ color: GREEN }}>{createNote}</p>
        )}

        {showAdd && (
          <form onSubmit={handleCreate} className="space-y-3 mt-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id="new-fleet"
                label="Fleet name"
                required
                value={newFleet}
                onChange={setNewFleet}
                placeholder="Cascade County Public Works"
              />
              <Field
                id="new-contact"
                label="Contact name"
                value={newName}
                onChange={setNewName}
                placeholder="Dale Whitaker"
              />
              <Field
                id="new-email"
                label="Contact email"
                type="email"
                value={newEmail}
                onChange={setNewEmail}
                placeholder="fleet@county.gov"
              />
              <Field
                id="new-phone"
                label="Contact phone"
                type="tel"
                value={newPhone}
                onChange={setNewPhone}
                placeholder="(406) 555-0142"
              />
            </div>

            <div className="pt-2">
              <p className="text-xs uppercase tracking-wider mb-3" style={{ color: MUTED }}>
                Portal branding <span className="normal-case">(optional — defaults to the fleet name and your logo)</span>
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field
                  id="new-brand"
                  label="Brand name"
                  value={newBrand}
                  onChange={setNewBrand}
                  placeholder="Cascade Fleet Portal"
                />
                <Field
                  id="new-logo"
                  label="Logo URL"
                  value={newLogo}
                  onChange={setNewLogo}
                  placeholder="https://…/logo.png"
                />
                <div>
                  <label htmlFor="new-accent" className={LABEL_CLASS} style={{ color: MUTED }}>
                    Accent color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="new-accent"
                      type="text"
                      value={newAccent}
                      onChange={e => setNewAccent(e.target.value)}
                      placeholder="#ff6600"
                      className={INPUT_CLASS}
                      style={INPUT_STYLE}
                    />
                    <span
                      className="w-9 h-9 rounded-lg shrink-0"
                      style={{
                        background: ACCENT_HEX.test(newAccent.trim()) ? newAccent.trim() : 'transparent',
                        border:     `1px solid ${BORDER}`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1 flex-wrap">
              <button
                type="submit"
                disabled={creating || !newFleet.trim()}
                className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity"
                style={{ background: NWI_ORANGE, opacity: creating || !newFleet.trim() ? 0.5 : 1 }}
              >
                {creating ? 'Creating…' : 'Create fleet account'}
              </button>
              {createError && <p className="text-xs text-red-400">{createError}</p>}
            </div>
          </form>
        )}
      </section>

      {/* ── table ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <p className="text-sm" style={{ color: MUTED }}>Loading your fleet accounts…</p>
      ) : loadError ? (
        <div
          className="rounded-xl p-4 text-sm"
          style={{ background: CARD, border: `1px solid ${BORDER}`, color: '#F87171' }}
        >
          {loadError}
        </div>
      ) : rows.length === 0 ? (
        <div
          className="rounded-xl p-6 text-sm"
          style={{ background: CARD, border: `1px solid ${BORDER}`, color: MUTED }}
        >
          You do not have any fleet accounts yet. Add the first one above — it costs nothing until
          you enable Fleet Pro for them.
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]" style={{ background: CARD }}>
              <thead style={{ background: HEAD }}>
                <tr>
                  {['Fleet', 'Brand', 'Units', 'People', 'Fleet Pro', ''].map((h, i) => (
                    <th
                      key={h || `col-${i}`}
                      className="text-left text-xs uppercase tracking-wider font-medium px-4 py-3"
                      style={{ color: MUTED }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const id      = row.fleet_account_id
                  const busy    = busyId === id
                  const err     = rowError?.id === id ? rowError.message : null
                  const note    = rowNote?.id  === id ? rowNote.message  : null
                  const panel   = openPanel?.id === id ? openPanel.kind : null

                  return (
                    // A row and its expansion panel are siblings inside <tbody>, so
                    // they cannot be wrapped in a div — only a keyed fragment.
                    <Fragment key={id}>
                      <tr style={{ borderTop: `1px solid ${BORDER}`, opacity: busy ? 0.6 : 1 }}>
                        <td className="px-4 py-3 align-top">
                          <p className="text-sm text-white font-medium">{row.fleet_name}</p>
                          {(row.contact_name || row.contact_email) && (
                            <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                              {[row.contact_name, row.contact_email].filter(Boolean).join(' · ')}
                            </p>
                          )}
                          {err  && <p className="text-xs mt-1 text-red-400">{err}</p>}
                          {note && <p className="text-xs mt-1" style={{ color: GREEN }}>{note}</p>}
                        </td>

                        <td className="px-4 py-3 align-top">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="w-3 h-3 rounded-full shrink-0"
                              style={{
                                background: row.brand_accent_color ?? 'transparent',
                                border:     `1px solid ${BORDER}`,
                              }}
                            />
                            <span className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
                              {row.brand_name}
                            </span>
                          </span>
                        </td>

                        <td className="px-4 py-3 align-top text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
                          {row.unit_count}
                        </td>

                        <td className="px-4 py-3 align-top text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
                          {row.member_count}
                        </td>

                        <td className="px-4 py-3 align-top">
                          <StatusPill row={row} />
                        </td>

                        <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openBrand(row)}
                              disabled={busy}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                              style={{
                                background: HEAD,
                                border:     `1px solid ${BORDER}`,
                                color:      'rgba(255,255,255,0.75)',
                                opacity:    busy ? 0.5 : 1,
                              }}
                            >
                              {panel === 'brand' ? 'Close' : 'Edit'}
                            </button>
                            <button
                              type="button"
                              onClick={() => openInvite(row)}
                              disabled={busy}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
                              style={{ background: NWI_ORANGE, opacity: busy ? 0.5 : 1 }}
                            >
                              {panel === 'invite' ? 'Close' : 'Invite'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleUnlink(row)}
                              disabled={busy}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                              style={{
                                background: 'rgba(239,68,68,0.12)',
                                color:      '#F87171',
                                opacity:    busy ? 0.5 : 1,
                              }}
                            >
                              Unlink
                            </button>
                          </div>
                        </td>
                      </tr>

                      {panel === 'brand' && draft && (
                        <tr style={{ borderTop: `1px solid ${BORDER}`, background: '#0e161d' }}>
                          <td colSpan={6} className="px-4 py-4">
                            <form onSubmit={e => void handleSaveBrand(row, e)} className="space-y-3">
                              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                <Field
                                  id={`fleet-${id}`}
                                  label="Fleet name"
                                  value={draft.fleet_name}
                                  onChange={v => setDraft(d => (d ? { ...d, fleet_name: v } : d))}
                                />
                                <Field
                                  id={`cname-${id}`}
                                  label="Contact name"
                                  value={draft.contact_name}
                                  onChange={v => setDraft(d => (d ? { ...d, contact_name: v } : d))}
                                />
                                <Field
                                  id={`cmail-${id}`}
                                  label="Contact email"
                                  type="email"
                                  value={draft.contact_email}
                                  onChange={v => setDraft(d => (d ? { ...d, contact_email: v } : d))}
                                />
                                <Field
                                  id={`cphone-${id}`}
                                  label="Contact phone"
                                  type="tel"
                                  value={draft.contact_phone}
                                  onChange={v => setDraft(d => (d ? { ...d, contact_phone: v } : d))}
                                />
                              </div>

                              <div className="grid gap-3 sm:grid-cols-3">
                                <Field
                                  id={`brand-${id}`}
                                  label="Brand name"
                                  value={draft.brand_name}
                                  onChange={v => setDraft(d => (d ? { ...d, brand_name: v } : d))}
                                  placeholder={row.fleet_name}
                                />
                                <Field
                                  id={`logo-${id}`}
                                  label="Logo URL"
                                  value={draft.brand_logo_url}
                                  onChange={v => setDraft(d => (d ? { ...d, brand_logo_url: v } : d))}
                                  placeholder="https://…/logo.png"
                                />
                                <div>
                                  <label htmlFor={`accent-${id}`} className={LABEL_CLASS} style={{ color: MUTED }}>
                                    Accent color
                                  </label>
                                  <div className="flex items-center gap-2">
                                    <input
                                      id={`accent-${id}`}
                                      type="text"
                                      value={draft.brand_accent_color}
                                      onChange={e => setDraft(d => (d ? { ...d, brand_accent_color: e.target.value } : d))}
                                      placeholder="#ff6600"
                                      className={INPUT_CLASS}
                                      style={INPUT_STYLE}
                                    />
                                    <span
                                      className="w-9 h-9 rounded-lg shrink-0"
                                      style={{
                                        background: ACCENT_HEX.test(draft.brand_accent_color.trim())
                                          ? draft.brand_accent_color.trim()
                                          : 'transparent',
                                        border: `1px solid ${BORDER}`,
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-3 pt-1">
                                <button
                                  type="submit"
                                  disabled={busy}
                                  className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity"
                                  style={{ background: NWI_ORANGE, opacity: busy ? 0.5 : 1 }}
                                >
                                  {busy ? 'Saving…' : 'Save changes'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setOpenPanel(null); setDraft(null) }}
                                  className="text-xs font-semibold px-3 py-2"
                                  style={{ color: MUTED }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      )}

                      {panel === 'invite' && (
                        <tr style={{ borderTop: `1px solid ${BORDER}`, background: '#0e161d' }}>
                          <td colSpan={6} className="px-4 py-4">
                            <form onSubmit={e => void handleInvite(row, e)} className="space-y-3">
                              <p className="text-xs" style={{ color: MUTED }}>
                                Invite someone at {row.fleet_name} into their portal. They sign in with this
                                address to accept; the invitation expires after 14 days.
                              </p>

                              <div className="grid gap-3 sm:grid-cols-3">
                                <Field
                                  id={`iemail-${id}`}
                                  label="Email address"
                                  type="email"
                                  required
                                  value={inviteEmail}
                                  onChange={setInviteEmail}
                                  placeholder="name@department.gov"
                                />
                                <Field
                                  id={`iname-${id}`}
                                  label="Name (optional)"
                                  value={inviteName}
                                  onChange={setInviteName}
                                  placeholder="Dale Whitaker"
                                />
                                <div>
                                  <label htmlFor={`irole-${id}`} className={LABEL_CLASS} style={{ color: MUTED }}>
                                    Access level
                                  </label>
                                  <select
                                    id={`irole-${id}`}
                                    value={inviteRole}
                                    onChange={e => setInviteRole(e.target.value as FleetProRole)}
                                    className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                                    style={INPUT_STYLE}
                                  >
                                    {FLEET_PRO_ROLES.map(r => (
                                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>

                              <p className="text-xs leading-relaxed" style={{ color: MUTED }}>
                                {ROLE_DESCRIPTIONS[inviteRole]}
                              </p>

                              <div className="flex items-center gap-3 pt-1">
                                <button
                                  type="submit"
                                  disabled={busy || !inviteEmail.trim()}
                                  className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity"
                                  style={{ background: NWI_ORANGE, opacity: busy || !inviteEmail.trim() ? 0.5 : 1 }}
                                >
                                  {busy ? 'Sending…' : 'Send invitation'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setOpenPanel(null)}
                                  className="text-xs font-semibold px-3 py-2"
                                  style={{ color: MUTED }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
