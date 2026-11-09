'use client'

// HD QuickWrench: the CUSTOMER block and RECENT UNITS FROM INTEL HUB (Brock, Nov 9, 2026).
// Sits above the tabs, so every tab's hand-off carries it (lib/hd/qw-handoff).
//
// - Search finds BOTH Intel Hubs, as the HD quote form does: LD `customers` and HD
//   `hd_fleet_accounts`. Picking either links it.
// - A NEW customer is saved as an HD FLEET ACCOUNT only, and only once a name is typed.
//   Never a `customers` row: logHDCustomer makes that when the quote is saved, and a
//   second here would be a duplicate (Brock's decision 1). A picked customers record is
//   linked, and nothing is created for it.
// - Auto-save on blur, like LD: the account this block CREATED is kept up to date as the
//   tech types. A record that was PICKED is never rewritten from here - edits travel on
//   this job's hand-off only.
// - Picking a unit brings its number, serial, manufacturer, model, year and BM number
//   (onUnitPicked) and fills this block from the unit's fleet account. Its hours are not
//   touched here.
// - All of it is optional. An alarm-code lookup with an empty block saves nothing.

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { EMPTY_QW_CUSTOMER, type QwCustomer, type QwUnit } from '@/lib/hd/qw-handoff'
import { likeEscape } from '@/lib/hd/labor-library'

interface Hit {
  source: 'customer' | 'fleet'
  id: string
  label: string
  sublabel: string
  contactName: string
  phone: string
  email: string
  address: string
}

const inp = 'w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20'
const inpStyle = { background: 'var(--hd-inner)', border: '1px solid var(--hd-border)' }
const labelCls = 'block text-xs uppercase tracking-widest mb-1.5'

function unitLabel(u: QwUnit): string {
  return [u.unit_number ? `Unit ${u.unit_number}` : null, [u.manufacturer, u.model].filter(Boolean).join(' ') || null,
    u.serial_number ? `SN ${u.serial_number}` : null].filter(Boolean).join(' - ')
}

export default function QuickWrenchCustomer({ value, onChange, unit, onUnitPicked, onUnitCleared }: {
  value: QwCustomer
  onChange: (c: QwCustomer) => void
  unit: QwUnit | null
  onUnitPicked: (u: QwUnit) => void
  onUnitCleared: () => void
}) {
  const [search, setSearch]       = useState('')
  const [hits, setHits]           = useState<Hit[]>([])
  const [failed, setFailed]       = useState('')
  const [savedNote, setSavedNote] = useState('')
  const [saveError, setSaveError] = useState('')
  const [recent, setRecent]       = useState<QwUnit[]>([])
  const [unitSearch, setUnitSearch] = useState('')
  const [unitHits, setUnitHits]   = useState<QwUnit[]>([])
  // The fleet account THIS block created - the only record it ever writes to again.
  const createdId = useRef<string | null>(null)
  const latest = useRef(value)
  latest.current = value

  const set = (patch: Partial<QwCustomer>) => onChange({ ...latest.current, ...patch })

  // ── Search both Intel Hubs ──
  useEffect(() => {
    const q = search.trim()
    if (q.length < 2) { setHits([]); setFailed(''); return }
    const t = setTimeout(async () => {
      const term = encodeURIComponent(q)
      const [cr, fr] = await Promise.allSettled([
        fetch(`/api/customers?search=${term}&limit=5`),
        fetch(`/api/hd/fleet-accounts?search=${term}&limit=5`),
      ])
      const out: Hit[] = []
      const bad: string[] = []
      if (fr.status === 'fulfilled' && fr.value.ok) {
        const d = await fr.value.json().catch(() => ({})) as { fleet_accounts?: Array<Record<string, unknown>> }
        for (const a of d.fleet_accounts ?? []) out.push({
          source: 'fleet', id: String(a.id), label: String(a.fleet_name ?? '(unnamed fleet)'),
          sublabel: [a.contact_name, a.contact_phone, a.address].filter(Boolean).join(' - '),
          contactName: String(a.contact_name ?? ''), phone: String(a.contact_phone ?? ''),
          email: String(a.contact_email ?? ''), address: String(a.address ?? ''),
        })
      } else bad.push('fleet accounts')
      if (cr.status === 'fulfilled' && cr.value.ok) {
        const d = await cr.value.json().catch(() => ({})) as { customers?: Array<Record<string, unknown>> }
        for (const c of d.customers ?? []) {
          const person = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()
          const company = (c.company_name as string | null) ?? ''
          const address = [c.address_line1, c.city, [c.state, c.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
          out.push({
            source: 'customer', id: String(c.id), label: company || person || '(no name)',
            sublabel: [company && person ? person : null, c.phone, c.email].filter(Boolean).join(' - '),
            contactName: company ? person : '', phone: String(c.phone ?? ''), email: String(c.email ?? ''), address,
          })
        }
      } else bad.push('customers')
      setHits(out)
      setFailed(bad.length ? `Could not search ${bad.join(' or ')}.` : '')
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  function pick(h: Hit) {
    setSearch(''); setHits([])
    createdId.current = null
    onChange({
      name: h.label, contactName: h.contactName, phone: h.phone, email: h.email, address: h.address,
      customerId: h.source === 'customer' ? h.id : null,
      fleetAccountId: h.source === 'fleet' ? h.id : null,
    })
    setSavedNote(h.source === 'fleet' ? 'Linked fleet account from HD Intel Hub.' : 'Linked customer from Intel Hub.')
  }

  // ── Auto-save: a NEW customer becomes a fleet account; nothing until a name is typed ──
  async function save() {
    const c = latest.current
    const name = c.name.trim()
    if (!name) return
    if (c.customerId) return                       // a picked customers row: linked, never written
    if (c.fleetAccountId && c.fleetAccountId !== createdId.current) return   // picked: never rewritten
    const row = {
      fleet_name:    name,
      contact_name:  c.contactName.trim() || null,
      contact_phone: c.phone.trim()       || null,
      contact_email: c.email.trim()       || null,
      address:       c.address.trim()     || null,
    }
    setSaveError('')
    try {
      const supabase = createClient()
      if (c.fleetAccountId) {
        const { error } = await supabase.from('hd_fleet_accounts').update(row).eq('id', c.fleetAccountId)
        if (error) throw new Error(error.message)
      } else {
        // The same name already in Intel Hub is that account - link it, never a twin.
        const { data: same } = await supabase.from('hd_fleet_accounts').select('id').ilike('fleet_name', likeEscape(name)).limit(1)
        if (same?.[0]?.id) {
          set({ fleetAccountId: String(same[0].id) })
          setSavedNote('Linked the fleet account already in HD Intel Hub with this name.')
          return
        }
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('Not signed in.')
        const { data, error } = await supabase.from('hd_fleet_accounts').insert({ user_id: user.id, ...row }).select('id').single()
        if (error || !data) throw new Error(error?.message ?? 'Not saved.')
        createdId.current = String(data.id)
        set({ fleetAccountId: String(data.id) })
      }
      setSavedNote('Saved to HD Intel Hub as a fleet account.')
      setTimeout(() => setSavedNote(''), 2500)
    } catch (e) {
      setSaveError(`Not saved to Intel Hub: ${e instanceof Error ? e.message : 'unknown error'}. It still goes on this job.`)
    }
  }

  function clearCustomer() {
    createdId.current = null
    onChange(EMPTY_QW_CUSTOMER)
    setSavedNote(''); setSaveError('')
  }

  // ── Units: recent first, the linked account's own when one is linked ──
  useEffect(() => {
    const acct = value.fleetAccountId && value.fleetAccountId !== createdId.current ? value.fleetAccountId : null
    const qs = new URLSearchParams({ sort: 'recent', limit: '6', ...(acct ? { fleet_account_id: acct } : {}) })
    fetch(`/api/hd/fleet-units?${qs}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setRecent(Array.isArray(d?.units) ? d.units as QwUnit[] : []))
      .catch(() => setRecent([]))
  }, [value.fleetAccountId])

  useEffect(() => {
    const q = unitSearch.trim()
    if (q.length < 2) { setUnitHits([]); return }
    const t = setTimeout(() => {
      fetch(`/api/hd/fleet-units?${new URLSearchParams({ search: q, sort: 'recent', limit: '8' })}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => setUnitHits(Array.isArray(d?.units) ? d.units as QwUnit[] : []))
        .catch(() => setUnitHits([]))
    }, 300)
    return () => clearTimeout(t)
  }, [unitSearch])

  async function pickUnit(u: QwUnit) {
    setUnitSearch(''); setUnitHits([])
    onUnitPicked(u)
    // The unit's fleet account fills the customer block - unless a different customer
    // is already linked, which is left alone rather than silently swapped.
    if (!u.fleet_account_id) return
    const cur = latest.current
    if ((cur.fleetAccountId && cur.fleetAccountId !== u.fleet_account_id) || cur.customerId) return
    try {
      const { data } = await createClient().from('hd_fleet_accounts')
        .select('id, fleet_name, contact_name, contact_phone, contact_email, address').eq('id', u.fleet_account_id).maybeSingle()
      if (!data) return
      createdId.current = null
      onChange({
        name: String(data.fleet_name ?? ''), contactName: String(data.contact_name ?? ''),
        phone: String(data.contact_phone ?? ''), email: String(data.contact_email ?? ''), address: String(data.address ?? ''),
        customerId: null, fleetAccountId: String(data.id),
      })
      setSavedNote(`Filled from the unit's fleet account, ${String(data.fleet_name ?? '')}.`)
    } catch { /* the unit itself is already filled */ }
  }

  const linked = value.customerId ? 'customer' : value.fleetAccountId ? (value.fleetAccountId === createdId.current ? 'created' : 'fleet') : null

  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }} data-testid="qw-customer-block">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-widest font-bold" style={{ color: 'var(--hd-text-faint)' }}>
          Customer <span className="font-normal">(optional)</span>
        </p>
        {(value.name || value.phone || value.email || linked) && (
          <button type="button" onClick={clearCustomer} className="text-xs font-semibold" style={{ color: 'var(--hd-info)', background: 'none', border: 'none', cursor: 'pointer' }}>
            Clear customer
          </button>
        )}
      </div>

      <div className="relative">
        <input className={inp} style={inpStyle} value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search customers and fleet accounts by name or phone" aria-label="Search customers and fleet accounts" />
        {hits.length > 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg overflow-hidden" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }}>
            {hits.map(h => (
              <button key={`${h.source}:${h.id}`} type="button" onClick={() => pick(h)} className="w-full text-left px-3 py-2 text-sm"
                style={{ color: 'var(--hd-text)', background: 'transparent', borderBottom: '1px solid var(--hd-border)' }}>
                <span className="font-semibold">{h.label}</span>
                <span className="ml-2 text-[11px] uppercase" style={{ color: 'var(--hd-text-faint)' }}>{h.source === 'fleet' ? 'Fleet account' : 'Customer'}</span>
                {h.sublabel && <span className="block text-xs" style={{ color: 'var(--hd-text-muted)' }}>{h.sublabel}</span>}
              </button>
            ))}
          </div>
        )}
        {failed && <p className="text-xs mt-1" style={{ color: 'var(--hd-warn)' }}>{failed}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} style={{ color: 'var(--hd-text-faint)' }}>Fleet / Customer Name</label>
          <input className={inp} style={inpStyle} value={value.name} onChange={e => set({ name: e.target.value })} onBlur={save}
            placeholder="e.g. LTL Pros Inc" data-testid="qw-customer-name" />
        </div>
        <div>
          <label className={labelCls} style={{ color: 'var(--hd-text-faint)' }}>Contact</label>
          <input className={inp} style={inpStyle} value={value.contactName} onChange={e => set({ contactName: e.target.value })} onBlur={save} placeholder="Who to call" />
        </div>
        <div>
          <label className={labelCls} style={{ color: 'var(--hd-text-faint)' }}>Phone</label>
          <input className={inp} style={inpStyle} type="tel" value={value.phone} onChange={e => set({ phone: e.target.value })} onBlur={save} placeholder="(555) 000-0000" />
        </div>
        <div>
          <label className={labelCls} style={{ color: 'var(--hd-text-faint)' }}>Email</label>
          <input className={inp} style={inpStyle} type="email" value={value.email} onChange={e => set({ email: e.target.value })} onBlur={save} placeholder="dispatch@fleet.com" />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} style={{ color: 'var(--hd-text-faint)' }}>Address</label>
          <input className={inp} style={inpStyle} value={value.address} onChange={e => set({ address: e.target.value })} onBlur={save} placeholder="Street, city, state ZIP" />
        </div>
      </div>
      <p className="text-[11px]" style={{ color: saveError ? 'var(--hd-warn)' : 'var(--hd-text-faint)' }} data-testid="qw-customer-note">
        {saveError || savedNote || (linked === 'customer' ? 'Linked to an Intel Hub customer. Changes here go on this job only.'
          : linked === 'fleet' ? 'Linked to an HD Intel Hub fleet account. Changes here go on this job only.'
          : 'A new customer is saved to HD Intel Hub as a fleet account once a name is typed. Leave it blank for a lookup.')}
      </p>

      <div>
        <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--hd-text-faint)' }}>Recent Units from Intel Hub</p>
        {unit ? (
          <div className="flex flex-wrap items-center gap-3 px-3 py-2 rounded-lg" style={{ background: 'var(--hd-inner)', border: '1px solid var(--hd-border)' }} data-testid="qw-unit-picked">
            <span className="text-sm font-semibold" style={{ color: 'var(--hd-text)' }}>{unitLabel(unit)}</span>
            <button type="button" onClick={onUnitCleared} className="text-xs font-semibold ml-auto" style={{ color: 'var(--hd-info)', background: 'none', border: 'none', cursor: 'pointer' }}>
              Unlink unit
            </button>
          </div>
        ) : (
          <>
            {recent.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2" data-testid="qw-recent-units">
                {recent.map(u => (
                  <button key={u.id} type="button" onClick={() => void pickUnit(u)} className="text-left p-3 rounded-lg"
                    style={{ background: 'var(--hd-inner)', border: '1px solid var(--hd-border)', color: 'var(--hd-text)' }}>
                    <span className="block text-sm font-semibold">{u.unit_number ? `Unit ${u.unit_number}` : '(no unit number)'}</span>
                    <span className="block text-xs" style={{ color: 'var(--hd-text-muted)' }}>{[u.manufacturer, u.model].filter(Boolean).join(' ')}</span>
                    {u.serial_number && <span className="block text-xs" style={{ color: 'var(--hd-text-faint)' }}>SN {u.serial_number}</span>}
                    {u.fleet_account?.fleet_name && <span className="block text-xs" style={{ color: 'var(--hd-text-faint)' }}>{u.fleet_account.fleet_name}</span>}
                  </button>
                ))}
              </div>
            )}
            <div className="relative">
              <input className={inp} style={inpStyle} value={unitSearch} onChange={e => setUnitSearch(e.target.value)}
                placeholder="Find a unit by unit number, serial or BM number" aria-label="Find a unit" />
              {unitHits.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg overflow-hidden" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }}>
                  {unitHits.map(u => (
                    <button key={u.id} type="button" onClick={() => void pickUnit(u)} className="w-full text-left px-3 py-2 text-sm"
                      style={{ color: 'var(--hd-text)', background: 'transparent', borderBottom: '1px solid var(--hd-border)' }}>
                      {unitLabel(u)}{u.fleet_account?.fleet_name ? ` - ${u.fleet_account.fleet_name}` : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
