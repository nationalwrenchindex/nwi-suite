'use client'

import { useMemo, useState } from 'react'
import { parseRange } from '@/lib/hd/audit-csv'
import {
  AUDIT_TEXT_KEYS, AUDIT_TEXT_DEFAULTS, AUDIT_TEXT_DESCRIPTIONS, TITLE_KEYS,
  MAX_TITLE_LEN, MAX_COLUMN_LEN, MAX_CATEGORY_LEN,
  SYNTHETIC_CATEGORY_KEYS, SYNTHETIC_CATEGORY_NAMES,
  type AuditLabels, type AuditTextKey,
} from '@/lib/hd/audit-labels'

const HD_ORANGE = '#E85D24'
const MUTED = { color: 'rgba(var(--hd-ink-rgb), 0.45)' }
const CARD = { background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }
const INPUT = { background: 'var(--hd-inner)', border: '1px solid var(--hd-border)' }

interface Props {
  initialFrom: string
  initialTo: string
  shopName: string | null
  labels: AuditLabels
  labelsAvailable: boolean
  categories: { id: string; name: string; isActive: boolean }[]
}

function DownloadLink({ href, label, disabled, testId, primary }: { href: string; label: string; disabled: boolean; testId: string; primary?: boolean }) {
  const style = primary
    ? { background: HD_ORANGE, color: 'var(--hd-text)' }
    : { border: `1px solid ${HD_ORANGE}`, color: HD_ORANGE }
  if (disabled) {
    return <span data-testid={testId} aria-disabled="true" className="px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ ...style, opacity: 0.5 }}>{label}</span>
  }
  return <a data-testid={testId} href={href} className="px-5 py-2.5 rounded-lg text-sm font-semibold" style={style}>{label}</a>
}

export default function AuditReportsClient({ initialFrom, initialTo, shopName, labels: initialLabels, labelsAvailable: initialAvailable, categories }: Props) {
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)

  const range = useMemo(() => parseRange(from, to, initialFrom), [from, to, initialFrom])
  const q = range.ok ? `from=${range.from}&to=${range.to}` : ''
  const disabled = !range.ok

  // ── labels ──
  const [available, setAvailable] = useState(initialAvailable)
  const [text, setText] = useState<Record<AuditTextKey, string>>(() => {
    const t = {} as Record<AuditTextKey, string>
    for (const k of AUDIT_TEXT_KEYS) t[k] = initialLabels.text[k] === AUDIT_TEXT_DEFAULTS[k] ? '' : initialLabels.text[k]
    return t
  })
  const [cats, setCats] = useState<Record<string, string>>(() => ({ ...initialLabels.categories }))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [open, setOpen] = useState(false)

  const categoryRows = [
    ...categories.map(c => ({ key: c.id, name: c.name + (c.isActive ? '' : ' (inactive)') })),
    ...SYNTHETIC_CATEGORY_KEYS.map(k => ({ key: k, name: SYNTHETIC_CATEGORY_NAMES[k] })),
  ]

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const body = {
        text: Object.fromEntries(AUDIT_TEXT_KEYS.map(k => [k, text[k].trim()])),
        categories: Object.fromEntries(categoryRows.map(r => [r.key, (cats[r.key] ?? '').trim()])),
      }
      const res = await fetch('/api/hd/reports/labels', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (res.status === 409) { setAvailable(false); throw new Error(json.error ?? 'Labels cannot be saved yet.') }
      if (!res.ok) throw new Error([json.error, ...(json.details ?? [])].filter(Boolean).join(' ') || 'Could not save labels.')
      setMessage({ ok: true, text: 'Labels saved. The next export uses them.' })
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Could not save labels.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* ── policy period and downloads ── */}
      <section className="rounded-xl p-5 space-y-4" style={CARD}>
        <div>
          <p className="font-condensed font-bold text-white text-lg tracking-wide">POLICY PERIOD</p>
          {shopName && <p className="text-xs mt-1" style={MUTED}>{shopName}</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="audit-from" className="text-xs mb-1 block" style={MUTED}>From</label>
            <input id="audit-from" name="from" type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm text-white" style={INPUT} />
          </div>
          <div>
            <label htmlFor="audit-to" className="text-xs mb-1 block" style={MUTED}>To</label>
            <input id="audit-to" name="to" type="date" value={to} onChange={e => setTo(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm text-white" style={INPUT} />
          </div>
        </div>
        {!range.ok && <p className="text-sm text-red-400">{range.error}</p>}

        <div className="space-y-2">
          <p className="text-sm font-semibold text-white">Equipment schedule</p>
          <p className="text-xs" style={MUTED}>
            Units, jobs, labor hours and total invoiced per equipment class, then every unit serviced in the period.
          </p>
          <div className="flex flex-wrap gap-3">
            <DownloadLink primary testId="audit-schedule-pdf" href={`/api/hd/reports/audit-schedule?${q}&format=pdf`} label="Schedule PDF" disabled={disabled} />
            <DownloadLink testId="audit-schedule-csv" href={`/api/hd/reports/audit-schedule?${q}&format=csv`} label="Schedule CSV" disabled={disabled} />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-white">Audit packet</p>
          <p className="text-xs" style={MUTED}>
            A cover summary (peak units in possession, peak value exposure, work orders with no recorded authorization),
            then one work order per page: unit, customer, dates, authorization record, approved quote, parts, labor, tech and invoice.
            NWI records no approver name for a quote approval, so &quot;Approved by&quot; prints as Not recorded.
          </p>
          <div className="flex flex-wrap gap-3">
            <DownloadLink primary testId="audit-packet-pdf" href={`/api/hd/reports/audit-packet?${q}&format=pdf`} label="Packet PDF" disabled={disabled} />
            <DownloadLink testId="audit-packet-csv" href={`/api/hd/reports/audit-packet?${q}&format=csv`} label="Packet CSV" disabled={disabled} />
          </div>
        </div>
      </section>

      {/* ── labels ── */}
      <section className="rounded-xl p-5 space-y-4" style={CARD} data-testid="audit-labels">
        <button type="button" onClick={() => setOpen(o => !o)} className="w-full text-left">
          <p className="font-condensed font-bold text-white text-lg tracking-wide">REPORT LABELS {open ? '−' : '+'}</p>
          <p className="text-xs mt-1" style={MUTED}>
            Match your insurer&apos;s wording. Leave a box empty to use the default shown.
          </p>
        </button>

        {!available && (
          <p className="text-sm" style={{ color: HD_ORANGE }} data-testid="audit-labels-unavailable">
            Labels cannot be saved yet: migration 162 has not been applied. The exports use the default labels.
          </p>
        )}

        {open && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {AUDIT_TEXT_KEYS.map(k => (
                <div key={k}>
                  <label htmlFor={`label-${k}`} className="text-xs mb-1 block" style={MUTED}>{AUDIT_TEXT_DESCRIPTIONS[k]}</label>
                  <input id={`label-${k}`} type="text" value={text[k]} placeholder={AUDIT_TEXT_DEFAULTS[k]}
                    maxLength={TITLE_KEYS.has(k) ? MAX_TITLE_LEN : MAX_COLUMN_LEN}
                    onChange={e => setText(t => ({ ...t, [k]: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg text-sm text-white" style={INPUT} />
                </div>
              ))}
            </div>

            <div>
              <p className="text-sm font-semibold text-white mb-2">Category names on reports</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {categoryRows.map(r => (
                  <div key={r.key}>
                    <label htmlFor={`cat-${r.key}`} className="text-xs mb-1 block" style={MUTED}>{r.name}</label>
                    <input id={`cat-${r.key}`} type="text" value={cats[r.key] ?? ''} placeholder={r.name.replace(/ \(inactive\)$/, '')}
                      maxLength={MAX_CATEGORY_LEN}
                      onChange={e => setCats(c => ({ ...c, [r.key]: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg text-sm text-white" style={INPUT} />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button type="button" onClick={save} disabled={saving || !available}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold"
                style={{ background: HD_ORANGE, color: 'var(--hd-text)', opacity: saving || !available ? 0.5 : 1 }}>
                {saving ? 'Saving…' : 'Save labels'}
              </button>
              {message && <p className={`text-sm ${message.ok ? 'text-green-400' : 'text-red-400'}`}>{message.text}</p>}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
