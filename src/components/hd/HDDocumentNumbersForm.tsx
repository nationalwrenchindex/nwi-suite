'use client'

// Settings > Document numbers: the next number each HD document type will get, each
// its own counter and its own save. Forward only - the server refuses a number at or
// below one already issued and says which (lib/hd/document-number-start).

import { useState } from 'react'

export interface DocNumberRow {
  kind: 'hd_invoice' | 'hd_quote' | 'hd_work_order'
  next: number
  next_formatted: string
}

const LABEL: Record<DocNumberRow['kind'], { label: string; noun: string; prefix: string }> = {
  hd_invoice:    { label: 'Next invoice number',    noun: 'invoice',    prefix: 'INV' },
  hd_quote:      { label: 'Next quote number',      noun: 'quote',      prefix: 'Q' },
  hd_work_order: { label: 'Next work order number', noun: 'work order', prefix: 'WO' },
}

const pad = (n: number) => String(n).padStart(4, '0')

function NumberRow({ row, year }: { row: DocNumberRow; year: number }) {
  const meta = LABEL[row.kind]
  const [current, setCurrent] = useState(row.next)
  const [value, setValue] = useState(pad(row.next))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  async function save() {
    setSaving(true); setError(null); setSaved(null)
    try {
      const res = await fetch('/api/hd/settings/document-numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: row.kind, next: value }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(String(json.error ?? `Could not save (${res.status}).`)); return }
      const n = Number(json.number?.next)
      setCurrent(n); setValue(pad(n))
      setSaved(`Saved. Your next ${meta.noun} will be ${String(json.number?.next_formatted ?? '')}.`)
    } catch {
      setError('Could not reach the server. Nothing was saved.')
    } finally {
      setSaving(false)
    }
  }

  const id = `docnum-${row.kind}`
  return (
    <div className="py-3 border-b" style={{ borderColor: 'var(--hd-border)' }} data-testid={id}>
      <label htmlFor={id} className="block text-sm font-semibold text-white mb-1">{meta.label}</label>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm" style={{ color: 'var(--hd-text-muted)' }}>{meta.prefix}-{year}-</span>
        <input
          id={id}
          name={id}
          inputMode="numeric"
          maxLength={4}
          value={value}
          onChange={e => { setValue(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(null); setSaved(null) }}
          onBlur={() => { if (/^\d+$/.test(value)) setValue(pad(Number(value))) }}
          className="w-24 px-3 py-2 rounded-lg font-mono text-white"
          style={{ background: 'var(--hd-inner)', border: '1px solid var(--hd-border)', minHeight: 44 }}
        />
        <button
          type="button"
          onClick={save}
          disabled={saving || value === pad(current)}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: '#FF6600', minHeight: 44 }}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
      {error && <p className="text-xs mt-2" style={{ color: 'var(--hd-negative)' }} role="alert">{error}</p>}
      {saved && <p className="text-xs mt-2" style={{ color: 'var(--hd-positive)' }}>{saved}</p>}
    </div>
  )
}

export default function HDDocumentNumbersForm({ rows, year }: { rows: DocNumberRow[]; year: number }) {
  return <div>{rows.map(r => <NumberRow key={r.kind} row={r} year={year} />)}</div>
}
