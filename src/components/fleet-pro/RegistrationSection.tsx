'use client'

// ─── Fleet Pro — registration / plate card ────────────────────────────────────
// Self-contained: fetches its own data from /api/fleet-pro/units/[id]/registration
// so it drops onto the unit page with a single line and owns its own loading,
// error and save states. Nothing above it needs to know the endpoint exists.

import { useCallback, useEffect, useState } from 'react'
import { NWI_ORANGE } from './brand'
import {
  REGISTRATION_COLOR,
  REGISTRATION_LABEL,
  type RegistrationState,
} from '@/lib/fleet-pro/registration'
import { REGISTRATION_LIMITS } from '@/types/fleet-pro-registration'
import type { UnitRegistrationPayload } from '@/types/fleet-pro-registration'

const ACCENT = NWI_ORANGE
const CARD   = '#111920'
const STRIP  = '#162030'
const BORDER = '#1e3040'

const DIM  = 'rgba(255,255,255,0.4)'
const DIM2 = 'rgba(255,255,255,0.55)'

interface FormState {
  license_plate: string
  jurisdiction:  string
  expires_on:    string
  annual_cost:   string
  notes:         string
}

const EMPTY_FORM: FormState = {
  license_plate: '',
  jurisdiction:  '',
  expires_on:    '',
  annual_cost:   '',
  notes:         '',
}

function fmtDate(value: string | null) {
  if (!value) return '—'
  const d = new Date(`${value}T12:00:00`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMoney(value: number | null) {
  if (value == null) return '—'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function StatePill({ state }: { state: RegistrationState }) {
  const color = REGISTRATION_COLOR[state]
  return (
    <span
      className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
      style={{ background: `${color}20`, color }}
    >
      {REGISTRATION_LABEL[state]}
    </span>
  )
}

function Field({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: DIM }}>{label}</p>
      <p className="text-sm truncate" style={{ color: color ?? '#ffffff' }}>{value}</p>
    </div>
  )
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
  maxLength,
  placeholder,
  min,
  step,
}: {
  label:        string
  value:        string
  onChange:     (next: string) => void
  type?:        string
  maxLength?:   number
  placeholder?: string
  min?:         string
  step?:        string
}) {
  return (
    <label className="block min-w-0">
      <span className="block text-[10px] uppercase tracking-widest mb-1" style={{ color: DIM }}>{label}</span>
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        min={min}
        step={step}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none"
        style={{ background: STRIP, border: `1px solid ${BORDER}` }}
      />
    </label>
  )
}

export default function RegistrationSection({
  unitId,
  canEdit,
}: {
  unitId:  string
  canEdit: boolean
}) {
  const [data,    setData]    = useState<UnitRegistrationPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [form,    setForm]    = useState<FormState>(EMPTY_FORM)
  const [saving,  setSaving]  = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/fleet-pro/units/${unitId}/registration`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((json as { error?: string }).error ?? 'Could not load registration')
        setData(null)
        return
      }
      setData(json as UnitRegistrationPayload)
    } catch {
      setError('Could not load registration')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [unitId])

  useEffect(() => {
    void load()
  }, [load])

  // The server's can_edit is authoritative — it is what the PUT actually enforces.
  // The prop is the page's hint, used only until the first response lands so the
  // card does not flash a read-only state at a manager.
  const editable = data ? data.can_edit : canEdit

  function beginEdit() {
    const r = data?.registration
    setForm({
      license_plate: r?.license_plate ?? '',
      jurisdiction:  r?.jurisdiction ?? '',
      expires_on:    r?.expires_on ?? '',
      annual_cost:   r?.annual_cost == null ? '' : String(r.annual_cost),
      notes:         r?.notes ?? '',
    })
    setSaveErr(null)
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    setSaveErr(null)
    try {
      const res = await fetch(`/api/fleet-pro/units/${unitId}/registration`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          license_plate: form.license_plate.trim() || null,
          jurisdiction:  form.jurisdiction.trim().toUpperCase() || null,
          expires_on:    form.expires_on || null,
          annual_cost:   form.annual_cost.trim() === '' ? null : form.annual_cost.trim(),
          notes:         form.notes.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveErr((json as { error?: string }).error ?? 'Could not save registration')
        return
      }
      // The PUT returns the same payload shape as the GET, recomputed state
      // included, so the card refreshes without a second round trip.
      setData(json as UnitRegistrationPayload)
      setEditing(false)
    } catch {
      setSaveErr('Could not save registration')
    } finally {
      setSaving(false)
    }
  }

  const heading = (
    <h2 className="font-condensed font-bold text-xl text-white tracking-wide mb-3">REGISTRATION</h2>
  )

  if (loading) {
    return (
      <>
        {heading}
        <div className="rounded-xl px-4 py-6 mb-6" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <p className="text-sm" style={{ color: DIM2 }}>Loading&hellip;</p>
        </div>
      </>
    )
  }

  if (error || !data) {
    return (
      <>
        {heading}
        <div className="rounded-xl px-4 py-6 mb-6" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <p className="text-sm" style={{ color: DIM2 }}>{error ?? 'Could not load registration'}</p>
          <button
            type="button"
            onClick={() => { void load() }}
            className="mt-3 text-sm font-semibold"
            style={{ color: ACCENT }}
          >
            Try again
          </button>
        </div>
      </>
    )
  }

  const reg = data.registration

  return (
    <>
      {heading}
      <div className="rounded-xl overflow-hidden mb-6" style={{ border: `1px solid ${BORDER}` }}>
        {/* ── Status strip. Missing and expired share the same red — an unknown
               expiry grounds a truck exactly as hard as a dead one. ───────────── */}
        <div
          className="flex flex-wrap items-center gap-3 px-4 py-3"
          style={{ background: STRIP }}
        >
          <StatePill state={data.state} />
          <span className="text-sm" style={{ color: DIM2 }}>{data.label}</span>
          {editable && !editing && (
            <button
              type="button"
              onClick={beginEdit}
              className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap"
              style={{ border: `1px solid ${ACCENT}`, color: ACCENT }}
            >
              {reg ? 'Edit' : 'Add Registration'}
            </button>
          )}
        </div>

        {editing ? (
          <div className="px-4 py-4" style={{ background: CARD }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Input
                label="License Plate"
                value={form.license_plate}
                onChange={v => setForm(f => ({ ...f, license_plate: v }))}
                maxLength={REGISTRATION_LIMITS.license_plate}
                placeholder="ABC-1234"
              />
              {/* Free text, not a state dropdown: Canadian provinces and IRP base
                  jurisdictions are as real on this ground as Ohio. */}
              <Input
                label="Jurisdiction"
                value={form.jurisdiction}
                onChange={v => setForm(f => ({ ...f, jurisdiction: v }))}
                maxLength={REGISTRATION_LIMITS.jurisdiction}
                placeholder="OH / ON / IRP"
              />
              <Input
                label="Expires"
                type="date"
                value={form.expires_on}
                onChange={v => setForm(f => ({ ...f, expires_on: v }))}
              />
              <Input
                label="Annual Cost"
                type="number"
                min="0"
                step="0.01"
                value={form.annual_cost}
                onChange={v => setForm(f => ({ ...f, annual_cost: v }))}
                placeholder="0.00"
              />
            </div>

            <label className="block mt-3">
              <span className="block text-[10px] uppercase tracking-widest mb-1" style={{ color: DIM }}>Notes</span>
              <textarea
                value={form.notes}
                maxLength={REGISTRATION_LIMITS.notes}
                rows={3}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full rounded-lg px-3 py-2 text-sm text-white outline-none resize-y"
                style={{ background: STRIP, border: `1px solid ${BORDER}` }}
              />
            </label>

            {saveErr && <p className="text-sm mt-3" style={{ color: '#ef4444' }}>{saveErr}</p>}

            <div className="flex items-center gap-3 mt-4">
              <button
                type="button"
                onClick={() => { void save() }}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
                style={{ background: ACCENT, color: '#0b0f14' }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => { setEditing(false); setSaveErr(null) }}
                disabled={saving}
                className="text-sm font-semibold disabled:opacity-50"
                style={{ color: DIM2 }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 py-4" style={{ background: CARD }}>
            {reg ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Field label="Plate"        value={reg.license_plate ?? '—'} />
                  <Field label="Jurisdiction" value={reg.jurisdiction ?? '—'} />
                  <Field
                    label="Expires"
                    value={fmtDate(reg.expires_on)}
                    color={reg.expires_on ? REGISTRATION_COLOR[data.state] : DIM}
                  />
                  <Field label="Annual Cost"  value={fmtMoney(reg.annual_cost)} />
                </div>
                {reg.notes && (
                  <p className="text-sm mt-4 whitespace-pre-wrap" style={{ color: DIM2 }}>{reg.notes}</p>
                )}
              </>
            ) : (
              <p className="text-sm" style={{ color: DIM2 }}>
                No registration on file for this unit.
                {editable ? ' Add the plate and expiration to start tracking renewals.' : ''}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  )
}
