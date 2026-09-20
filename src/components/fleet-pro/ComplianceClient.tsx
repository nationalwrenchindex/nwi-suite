'use client'

// ─── Fleet Pro — DOT & compliance calendar ────────────────────────────────────
// Three tabs, because the three things a manager does here are genuinely different
// jobs and cramming them into one screen made all of them worse:
//
//   Calendar — every tracked deadline, grouped by the month it falls in, filtered by
//              unit / driver / item type / status. This is the answer to "what is
//              about to bite me".
//   Drivers  — the roster. CDL and medical card dates live on the driver, so this is
//              where those two item families are actually edited.
//   Carrier  — insurance, IFTA and 2290. One row per fleet, so one form.
//
// Nothing here classifies a date. Colours and states come from the server, which got
// them from src/lib/fleet-pro/compliance.ts — the same module the alert email uses.
// If this file ever starts deciding what is red, the screen and the inbox will drift.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { FleetProRole } from '@/types/fleet-pro'
import { canEditUnits } from '@/types/fleet-pro'
import {
  COMPLIANCE_STATE_LABEL,
  COMPLIANCE_TYPE_LABEL,
  COMPLIANCE_ITEM_TYPES,
  type ComplianceItemType,
  type ComplianceState,
} from '@/lib/fleet-pro/compliance'
import {
  COMPLIANCE_FILE_MAX_BYTES,
  COMPLIANCE_LIMITS,
  type ComplianceCalendar,
  type ComplianceItem,
  type FleetProDriver,
} from '@/types/fleet-pro-compliance'
import { FleetProWordmark, NWI_BLUE } from './brand'

const CARD   = { background: '#111920', border: '1px solid #1e3040' }
const INPUT  = { background: '#162030', border: '1px solid #1e3040', color: '#fff' }
const MUTED  = 'rgba(255,255,255,0.45)'
const FAINT  = 'rgba(255,255,255,0.28)'
const RED    = '#ef4444'

type Tab = 'calendar' | 'drivers' | 'carrier'

/** Item types whose date is edited on this page rather than somewhere else. */
const DOC_DATE_TYPES: ComplianceItemType[] = ['annual_dot_inspection', 'irp']
const DRIVER_DATE_TYPES: ComplianceItemType[] = ['cdl', 'medical_card']
/** Item types that can carry an uploaded scan. */
const UPLOADABLE: ComplianceItemType[] = ['annual_dot_inspection', 'registration', 'irp', 'cdl', 'medical_card']

const STATE_ORDER: ComplianceState[] = ['expired', 'missing', 'due_soon', 'upcoming', 'current']

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(`${s}T12:00:00`)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function monthKey(s: string | null): string {
  return s && s.length >= 7 ? s.slice(0, 7) : ''
}

function monthLabel(key: string): string {
  if (!key) return 'No date on file'
  const d = new Date(`${key}-01T12:00:00`)
  return isNaN(d.getTime()) ? key : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
}

export default function ComplianceClient({ role }: { role: FleetProRole }) {
  const canEdit = canEditUnits(role)

  const [tab,     setTab]     = useState<Tab>('calendar')
  const [data,    setData]    = useState<ComplianceCalendar | null>(null)

  // ?tab=drivers opens the roster directly. The driver detail page links back here and
  // would otherwise dump the manager on the Calendar tab, one click from where they
  // started. Read from window in an effect rather than through useSearchParams: the
  // hook forces a Suspense boundary on this subtree at build time, which is a lot of
  // ceremony for restoring one tab.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab')
    if (requested === 'drivers' || requested === 'carrier') setTab(requested)
  }, [])

  const [drivers, setDrivers] = useState<FleetProDriver[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [notice,  setNotice]  = useState<string | null>(null)
  const [busy,    setBusy]    = useState<string | null>(null)

  // filters
  const [unitFilter,   setUnitFilter]   = useState('')
  const [driverFilter, setDriverFilter] = useState('')
  const [typeFilter,   setTypeFilter]   = useState('')
  const [stateFilter,  setStateFilter]  = useState('')
  const [hideCurrent,  setHideCurrent]  = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [calRes, drvRes] = await Promise.all([
        fetch('/api/fleet-pro/compliance'),
        fetch('/api/fleet-pro/drivers'),
      ])
      const cal = await calRes.json()
      if (!calRes.ok) throw new Error(cal.error ?? 'Could not load the compliance calendar')
      setData(cal as ComplianceCalendar)

      const drv = await drvRes.json()
      if (drvRes.ok) setDrivers((drv.drivers ?? []) as FleetProDriver[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the compliance calendar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function flash(message: string) {
    setNotice(message)
    setTimeout(() => setNotice(null), 3000)
  }

  // Memoised so the `?? []` fallback is not a fresh array on every render, which would
  // re-run the filter and the month grouping below for nothing.
  const items = useMemo(() => data?.items ?? [], [data])

  const filtered = useMemo(() => items.filter(i => {
    // Current items are hidden by default. A calendar that leads with forty green rows
    // buries the three red ones, which is the only failure mode that matters here.
    if (hideCurrent && i.state === 'current') return false
    if (stateFilter && i.state !== stateFilter) return false
    if (typeFilter && i.type !== typeFilter) return false
    if (unitFilter && !(i.subject === 'unit' && i.subject_id === unitFilter)) return false
    if (driverFilter && !(i.subject === 'driver' && i.subject_id === driverFilter)) return false
    return true
  }), [items, hideCurrent, stateFilter, typeFilter, unitFilter, driverFilter])

  // Grouped by the month the deadline falls in. Undated items lead — 'missing' is red,
  // and a red item with nowhere to sit on a calendar still has to be seen.
  const months = useMemo(() => {
    const map = new Map<string, ComplianceItem[]>()
    for (const item of filtered) {
      const key = monthKey(item.expires_on)
      const list = map.get(key)
      if (list) list.push(item)
      else map.set(key, [item])
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === '') return -1
      if (b[0] === '') return 1
      return a[0].localeCompare(b[0])
    })
  }, [filtered])

  const anyFilter = !!(unitFilter || driverFilter || typeFilter || stateFilter)

  return (
    <div className="max-w-7xl mx-auto w-full">
      <div className="mb-5">
        <FleetProWordmark className="block text-xs uppercase tracking-widest mb-1 font-semibold" />
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">DOT &amp; COMPLIANCE</h1>
        <p className="text-sm mt-1" style={{ color: MUTED }}>
          Annual inspections, registration, IRP, CDL and medical cards, IFTA, Form 2290
          and insurance. Managers and supervisors are emailed a digest when something
          expires or comes due.
        </p>
      </div>

      {/* Counters. A missing date counts as an alarm, not as an empty cell. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Expired',        value: data?.expired_count  ?? 0, color: RED },
          { label: 'No Date on File', value: data?.missing_count ?? 0, color: RED },
          { label: 'Due in 30 Days', value: data?.due_soon_count ?? 0, color: '#F97316' },
          { label: 'Due in 60 Days', value: data?.upcoming_count ?? 0, color: '#F59E0B' },
        ].map(card => (
          <div key={card.label} className="rounded-xl p-4" style={CARD}>
            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: MUTED }}>{card.label}</p>
            <p className="font-condensed font-bold text-2xl" style={{ color: card.color }}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {([['calendar', 'Calendar'], ['drivers', 'Drivers'], ['carrier', 'Carrier Filings']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={tab === key
              ? { background: NWI_BLUE, color: '#fff' }
              : { ...CARD, color: MUTED }}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg px-4 py-3 mb-4 text-sm"
             style={{ background: 'rgba(239,68,68,0.12)', border: `1px solid ${RED}`, color: RED }}>
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg px-4 py-3 mb-4 text-sm"
             style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid #22C55E', color: '#22C55E' }}>
          {notice}
        </div>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: MUTED }}>Loading compliance calendar…</p>
      ) : !data ? null : tab === 'calendar' ? (
        <>
          {/* ── Filters ───────────────────────────────────────────────────── */}
          <div className="rounded-xl p-4 mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" style={CARD}>
            <label className="text-xs uppercase tracking-widest" style={{ color: MUTED }}>
              Unit
              <select
                value={unitFilter}
                onChange={e => { setUnitFilter(e.target.value); if (e.target.value) setDriverFilter('') }}
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm normal-case tracking-normal"
                style={INPUT}
              >
                <option value="">All units</option>
                {data.units.map(u => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
              </select>
            </label>

            <label className="text-xs uppercase tracking-widest" style={{ color: MUTED }}>
              Driver
              <select
                value={driverFilter}
                onChange={e => { setDriverFilter(e.target.value); if (e.target.value) setUnitFilter('') }}
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm normal-case tracking-normal"
                style={INPUT}
              >
                <option value="">All drivers</option>
                {data.drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
              </select>
            </label>

            <label className="text-xs uppercase tracking-widest" style={{ color: MUTED }}>
              Type
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm normal-case tracking-normal"
                style={INPUT}
              >
                <option value="">All types</option>
                {COMPLIANCE_ITEM_TYPES.map(t => (
                  <option key={t} value={t}>{COMPLIANCE_TYPE_LABEL[t]}</option>
                ))}
              </select>
            </label>

            <label className="text-xs uppercase tracking-widest" style={{ color: MUTED }}>
              Status
              <select
                value={stateFilter}
                onChange={e => setStateFilter(e.target.value)}
                className="mt-1 w-full rounded-lg px-3 py-2 text-sm normal-case tracking-normal"
                style={INPUT}
              >
                <option value="">Any status</option>
                {STATE_ORDER.map(s => (
                  <option key={s} value={s}>{COMPLIANCE_STATE_LABEL[s]}</option>
                ))}
              </select>
            </label>

            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
                <input
                  type="checkbox"
                  checked={hideCurrent}
                  onChange={e => setHideCurrent(e.target.checked)}
                />
                Hide current
              </label>
              {anyFilter && (
                <button
                  onClick={() => { setUnitFilter(''); setDriverFilter(''); setTypeFilter(''); setStateFilter('') }}
                  className="text-sm underline"
                  style={{ color: NWI_BLUE }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* ── The calendar ──────────────────────────────────────────────── */}
          {months.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={CARD}>
              <p className="text-sm" style={{ color: MUTED }}>
                {items.length === 0
                  ? 'No compliance items yet. Add drivers and record expiration dates to fill the calendar.'
                  : 'Nothing matches those filters. Everything else is current.'}
              </p>
            </div>
          ) : months.map(([key, monthItems]) => (
            <section key={key || 'undated'} className="mb-5">
              <h2
                className="font-condensed font-bold text-lg tracking-wide mb-2"
                style={{ color: key ? '#fff' : RED }}
              >
                {monthLabel(key)}
                <span className="ml-2 text-xs font-sans font-normal" style={{ color: FAINT }}>
                  {monthItems.length} item{monthItems.length === 1 ? '' : 's'}
                </span>
              </h2>
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
                {monthItems.map(item => (
                  <ComplianceRow
                    key={item.key}
                    item={item}
                    canEdit={canEdit}
                    busy={busy === item.key}
                    onBusy={value => setBusy(value ? item.key : null)}
                    onError={setError}
                    onDone={async (message) => { flash(message); await load() }}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      ) : tab === 'drivers' ? (
        <DriversPanel
          drivers={drivers}
          canEdit={canEdit}
          onError={setError}
          onDone={async (message) => { flash(message); await load() }}
        />
      ) : (
        <CarrierPanel
          record={data.fleet_record}
          canEdit={canEdit}
          onError={setError}
          onDone={async (message) => { flash(message); await load() }}
        />
      )}
    </div>
  )
}

// ─── One calendar row ─────────────────────────────────────────────────────────

function ComplianceRow({
  item, canEdit, busy, onBusy, onError, onDone,
}: {
  item:    ComplianceItem
  canEdit: boolean
  busy:    boolean
  onBusy:  (value: boolean) => void
  onError: (message: string | null) => void
  onDone:  (message: string) => Promise<void>
}) {
  const [open, setOpen]   = useState(false)
  const [draft, setDraft] = useState(item.expires_on ?? '')
  const fileRef = useRef<HTMLInputElement>(null)

  const editableHere =
    DOC_DATE_TYPES.includes(item.type) || DRIVER_DATE_TYPES.includes(item.type)
  const uploadable = UPLOADABLE.includes(item.type)

  // Where a date that is NOT editable here actually lives. Saying so is better than
  // an inert row: the manager needs to know the field exists, just not on this screen.
  const elsewhere =
    item.type === 'registration' ? 'Registration is edited on the unit page.'
    : item.subject === 'fleet'   ? 'Edited under Carrier Filings.'
    : null

  /**
   * Ensure there is a document row to hang a date or a file on, and return its id.
   * Doc-backed item types (annual DOT inspection, IRP) have no row until the first
   * save, and a scan for a CDL or a plate needs one too.
   */
  async function ensureDoc(expiresOn: string | null): Promise<string> {
    if (item.doc_id) return item.doc_id
    const docType = item.type === 'registration' || DRIVER_DATE_TYPES.includes(item.type) || DOC_DATE_TYPES.includes(item.type)
      ? item.type
      : 'other'
    const res = await fetch('/api/fleet-pro/compliance/docs', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doc_type:   docType,
        unit_id:    item.subject === 'unit'   ? item.subject_id : null,
        driver_id:  item.subject === 'driver' ? item.subject_id : null,
        expires_on: expiresOn,
      }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Could not create the document record')
    return json.doc.id as string
  }

  async function saveDate() {
    const value = draft || null
    onBusy(true)
    onError(null)
    try {
      if (DRIVER_DATE_TYPES.includes(item.type)) {
        // CDL and medical card dates belong to the driver record, not to a document.
        const field = item.type === 'cdl' ? 'cdl_expires_on' : 'medical_card_expires_on'
        const res = await fetch(`/api/fleet-pro/drivers/${item.subject_id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ [field]: value }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Save failed')
      } else {
        const docId = await ensureDoc(value)
        const res = await fetch(`/api/fleet-pro/compliance/docs/${docId}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ expires_on: value }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Save failed')
      }
      setOpen(false)
      await onDone('Date saved.')
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      onBusy(false)
    }
  }

  async function upload(file: File) {
    if (file.size > COMPLIANCE_FILE_MAX_BYTES) {
      onError(`File must be ${Math.round(COMPLIANCE_FILE_MAX_BYTES / 1024 / 1024)} MB or smaller.`)
      return
    }
    onBusy(true)
    onError(null)
    try {
      const docId = await ensureDoc(item.expires_on)
      const form  = new FormData()
      form.append('file', file)
      const res  = await fetch(`/api/fleet-pro/compliance/docs/${docId}`, { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      await onDone('Document uploaded.')
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      onBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div style={{ background: '#111920', borderTop: '1px solid #1e3040' }}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        {/* The colour bar is the whole point of the row — it reads before the text. */}
        <span className="w-1.5 self-stretch rounded-full" style={{ background: item.color, minHeight: 34 }} />

        <div className="min-w-[9rem] flex-1">
          <p className="text-sm font-bold text-white">{item.subject_label}</p>
          <p className="text-xs" style={{ color: FAINT }}>{item.type_label}</p>
        </div>

        <div className="min-w-[10rem] flex-1">
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>{fmtDate(item.expires_on)}</p>
          {item.detail && <p className="text-xs" style={{ color: FAINT }}>{item.detail}</p>}
        </div>

        <div className="min-w-[8rem]">
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: item.color }}>
            {COMPLIANCE_STATE_LABEL[item.state]}
          </p>
          <p className="text-xs" style={{ color: FAINT }}>{item.label}</p>
        </div>

        <div className="flex items-center gap-3">
          {item.signed_url && (
            // Signed link, good for an hour — the bucket is private because these are
            // licence and medical-card scans.
            <a href={item.signed_url} target="_blank" rel="noopener noreferrer"
               className="text-xs underline" style={{ color: NWI_BLUE }}>
              View doc
            </a>
          )}
          {canEdit && (editableHere || uploadable) && (
            <button onClick={() => setOpen(o => !o)} className="text-xs underline" style={{ color: NWI_BLUE }}>
              {open ? 'Close' : 'Update'}
            </button>
          )}
        </div>
      </div>

      {open && canEdit && (
        <div className="px-4 pb-4 flex flex-wrap items-end gap-3" style={{ background: '#0e161d' }}>
          {editableHere ? (
            <>
              <label className="text-xs uppercase tracking-widest" style={{ color: MUTED }}>
                Expiration
                <input
                  type="date"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  className="mt-1 block rounded-lg px-3 py-2 text-sm"
                  style={INPUT}
                />
              </label>
              <button
                onClick={() => void saveDate()}
                disabled={busy}
                className="px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ background: NWI_BLUE, color: '#fff', opacity: busy ? 0.5 : 1 }}
              >
                {busy ? 'Saving…' : 'Save date'}
              </button>
            </>
          ) : (
            <p className="text-xs" style={{ color: MUTED }}>{elsewhere}</p>
          )}

          {uploadable && (
            <label className="text-xs uppercase tracking-widest" style={{ color: MUTED }}>
              {item.has_document ? 'Replace scan' : 'Upload scan'}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/heic,image/webp,application/pdf"
                disabled={busy}
                onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f) }}
                className="mt-1 block text-sm"
                style={{ color: MUTED }}
              />
            </label>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Drivers ──────────────────────────────────────────────────────────────────

const EMPTY_DRIVER = {
  full_name: '', cdl_number: '', cdl_state: '',
  cdl_expires_on: '', medical_card_expires_on: '', phone: '', email: '',
}

function DriversPanel({
  drivers, canEdit, onError, onDone,
}: {
  drivers: FleetProDriver[]
  canEdit: boolean
  onError: (message: string | null) => void
  onDone:  (message: string) => Promise<void>
}) {
  const [draft, setDraft] = useState({ ...EMPTY_DRIVER })
  const [busy,  setBusy]  = useState(false)

  async function add() {
    if (!draft.full_name.trim()) { onError('A driver needs a name.'); return }
    setBusy(true)
    onError(null)
    try {
      const res = await fetch('/api/fleet-pro/drivers', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(draft),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not add the driver')
      setDraft({ ...EMPTY_DRIVER })
      await onDone('Driver added.')
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not add the driver')
    } finally {
      setBusy(false)
    }
  }

  async function setActive(driver: FleetProDriver, active: boolean) {
    setBusy(true)
    onError(null)
    try {
      const res = await fetch(`/api/fleet-pro/drivers/${driver.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ active }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Update failed')
      await onDone(active ? 'Driver reactivated.' : 'Driver deactivated.')
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const th = 'px-4 py-3 text-left text-xs uppercase tracking-wider'

  return (
    <>
      {canEdit && (
        <div className="rounded-xl p-4 mb-4" style={CARD}>
          <p className="text-xs uppercase tracking-widest mb-3" style={{ color: MUTED }}>Add a driver</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ['full_name',               'Name',            'text', COMPLIANCE_LIMITS.full_name],
              ['cdl_number',              'CDL number',      'text', COMPLIANCE_LIMITS.cdl_number],
              ['cdl_state',               'CDL state',       'text', COMPLIANCE_LIMITS.cdl_state],
              ['cdl_expires_on',          'CDL expires',     'date', undefined],
              ['medical_card_expires_on', 'Medical card expires', 'date', undefined],
              ['phone',                   'Phone',           'tel',  COMPLIANCE_LIMITS.phone],
              ['email',                   'Email',           'email', COMPLIANCE_LIMITS.email],
            ] as const).map(([field, label, type, max]) => (
              <label key={field} className="text-xs uppercase tracking-widest" style={{ color: MUTED }}>
                {label}
                <input
                  type={type}
                  maxLength={max}
                  value={draft[field]}
                  onChange={e => setDraft(d => ({ ...d, [field]: e.target.value }))}
                  className="mt-1 w-full rounded-lg px-3 py-2 text-sm normal-case tracking-normal"
                  style={INPUT}
                />
              </label>
            ))}
          </div>
          <button
            onClick={() => void add()}
            disabled={busy}
            className="mt-3 px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ background: NWI_BLUE, color: '#fff', opacity: busy ? 0.5 : 1 }}
          >
            {busy ? 'Saving…' : 'Add driver'}
          </button>
        </div>
      )}

      {drivers.length === 0 ? (
        <div className="rounded-xl p-8 text-center" style={CARD}>
          <p className="text-sm" style={{ color: MUTED }}>
            No drivers on this fleet yet. CDL and medical card deadlines appear on the
            calendar once a driver is added.
          </p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ background: '#111920' }}>
              <thead style={{ background: '#162030' }}>
                <tr style={{ color: MUTED }}>
                  <th className={th}>Driver</th>
                  <th className={th}>CDL</th>
                  <th className={th}>CDL Expires</th>
                  <th className={th}>Medical Card</th>
                  <th className={th}>Contact</th>
                  {canEdit && <th className={th}>Status</th>}
                </tr>
              </thead>
              <tbody>
                {drivers.map(d => (
                  <tr key={d.id} style={{ borderTop: '1px solid #1e3040', opacity: d.active ? 1 : 0.5 }}>
                    {/* The name is the way into the driver's record — inspection and
                        fuel history, the incident log and the scorecard. The roster
                        stays the roster; everything about one person lives there. */}
                    <td className="px-4 py-3 font-bold">
                      <Link href={`/fleet-pro/drivers/${d.id}`} style={{ color: NWI_BLUE }}>
                        {d.full_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'rgba(255,255,255,0.7)' }}>
                      {d.cdl_number ?? '—'}
                      {d.cdl_state ? ` (${d.cdl_state})` : ''}
                      {/* Says so out loud rather than showing a mangled number with no
                          explanation — a viewer should know the field is withheld. */}
                      {d.cdl_masked && (
                        <span className="block text-xs" style={{ color: FAINT }}>hidden for your role</span>
                      )}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'rgba(255,255,255,0.7)' }}>{fmtDate(d.cdl_expires_on)}</td>
                    <td className="px-4 py-3" style={{ color: 'rgba(255,255,255,0.7)' }}>{fmtDate(d.medical_card_expires_on)}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: FAINT }}>
                      {d.phone ?? '—'}{d.email ? <><br />{d.email}</> : null}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <button
                          onClick={() => void setActive(d, !d.active)}
                          disabled={busy}
                          className="text-xs underline"
                          style={{ color: d.active ? RED : '#22C55E' }}
                        >
                          {d.active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-xs" style={{ background: '#0e161d', color: FAINT }}>
            Deactivated drivers stay on file for the record but drop off the compliance
            calendar — an expired licence for somebody who has left is not a compliance problem.
          </p>
        </div>
      )}
    </>
  )
}

// ─── Carrier filings ──────────────────────────────────────────────────────────

function CarrierPanel({
  record, canEdit, onError, onDone,
}: {
  record:  ComplianceCalendar['fleet_record']
  canEdit: boolean
  onError: (message: string | null) => void
  onDone:  (message: string) => Promise<void>
}) {
  const [form, setForm] = useState({
    insurance_carrier:       record?.insurance_carrier       ?? '',
    insurance_policy_number: record?.insurance_policy_number ?? '',
    insurance_expires_on:    record?.insurance_expires_on    ?? '',
    ifta_account_number:     record?.ifta_account_number     ?? '',
    ifta_filed_through:      record?.ifta_filed_through      ?? '',
    hut_2290_filed_for_year: record?.hut_2290_filed_for_year != null ? String(record.hut_2290_filed_for_year) : '',
  })
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    onError(null)
    try {
      const res = await fetch('/api/fleet-pro/compliance/fleet', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      await onDone('Carrier filings saved.')
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function uploadCoi(file: File) {
    if (file.size > COMPLIANCE_FILE_MAX_BYTES) {
      onError(`File must be ${Math.round(COMPLIANCE_FILE_MAX_BYTES / 1024 / 1024)} MB or smaller.`)
      return
    }
    setBusy(true)
    onError(null)
    try {
      const data = new FormData()
      data.append('file', file)
      const res  = await fetch('/api/fleet-pro/compliance/fleet', { method: 'POST', body: data })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      await onDone('Certificate uploaded.')
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  const field = (
    key: keyof typeof form,
    label: string,
    type: string,
    hint?: string,
    max?: number,
  ) => (
    <label className="text-xs uppercase tracking-widest block" style={{ color: MUTED }}>
      {label}
      <input
        type={type}
        maxLength={max}
        disabled={!canEdit}
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        className="mt-1 w-full rounded-lg px-3 py-2 text-sm normal-case tracking-normal"
        style={INPUT}
      />
      {hint && <span className="block mt-1 normal-case tracking-normal text-xs" style={{ color: FAINT }}>{hint}</span>}
    </label>
  )

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl p-4" style={CARD}>
        <p className="text-xs uppercase tracking-widest mb-3" style={{ color: MUTED }}>Insurance</p>
        <div className="grid gap-3">
          {field('insurance_carrier', 'Carrier', 'text', undefined, COMPLIANCE_LIMITS.insurance_carrier)}
          {field('insurance_policy_number', 'Policy number', 'text', undefined, COMPLIANCE_LIMITS.insurance_policy_number)}
          {field('insurance_expires_on', 'Certificate expires', 'date', 'Flagged 60 days out.')}
          {record?.insurance_signed_url && (
            <a href={record.insurance_signed_url} target="_blank" rel="noopener noreferrer"
               className="text-sm underline" style={{ color: NWI_BLUE }}>
              View certificate{record.insurance_doc_name ? ` — ${record.insurance_doc_name}` : ''}
            </a>
          )}
          {canEdit && (
            <label className="text-xs uppercase tracking-widest" style={{ color: MUTED }}>
              {record?.insurance_doc_url ? 'Replace certificate' : 'Upload certificate'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/heic,image/webp,application/pdf"
                disabled={busy}
                onChange={e => { const f = e.target.files?.[0]; if (f) void uploadCoi(f) }}
                className="mt-1 block text-sm"
                style={{ color: MUTED }}
              />
            </label>
          )}
        </div>
      </div>

      <div className="rounded-xl p-4" style={CARD}>
        <p className="text-xs uppercase tracking-widest mb-3" style={{ color: MUTED }}>IFTA &amp; Form 2290</p>
        <div className="grid gap-3">
          {field('ifta_account_number', 'IFTA account number', 'text', undefined, COMPLIANCE_LIMITS.ifta_account_number)}
          {field(
            'ifta_filed_through', 'IFTA filed through (period end)', 'date',
            'The last quarter you filed — Mar 31, Jun 30, Sep 30 or Dec 31. The calendar tracks the quarter close; the return itself is due the last day of the following month.',
          )}
          {field(
            'hut_2290_filed_for_year', 'Form 2290 filed for tax year', 'number',
            'The year the July–June tax period starts. Due August 31 each year.',
          )}
        </div>
        {canEdit && (
          <button
            onClick={() => void save()}
            disabled={busy}
            className="mt-4 px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ background: NWI_BLUE, color: '#fff', opacity: busy ? 0.5 : 1 }}
          >
            {busy ? 'Saving…' : 'Save carrier filings'}
          </button>
        )}
      </div>
    </div>
  )
}
