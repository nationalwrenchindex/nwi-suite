'use client'

import { useState } from 'react'
import { parseAddress, type ParsedAddress } from '@/lib/hd/address-parse'

// Single-line address entry for the HD document forms. A tech on a phone in a
// yard types (or pastes) the whole address once; this splits it into the fields
// the invoice actually stores.
//
// It deliberately does NOT replace the individual fields — those stay visible and
// editable directly underneath, because the parser is conservative and will leave
// a city blank rather than guess it. The "parsed from" hint below the input is
// what tells the tech which fields it actually filled, so a miss is obvious
// instead of silent.

const CARD   = '#FFFFFF'
const BORDER = '#E5E7EB'
const TEXT   = '#1A1A1A'
const MUTED  = '#6B7280'
const ORANGE = '#FF6600'

export interface AddressValue {
  address_line1: string
  address_line2: string
  city: string
  state: string
  zip: string
}

const inp = {
  width: '100%',
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 14,
  color: TEXT,
  background: CARD,
  outline: 'none',
  minHeight: 44,
} as React.CSSProperties

function toValue(p: ParsedAddress): AddressValue {
  return {
    address_line1: p.address_line1 ?? '',
    address_line2: p.address_line2 ?? '',
    city:          p.city          ?? '',
    state:         p.state         ?? '',
    zip:           p.zip           ?? '',
  }
}

export default function AddressAutofill({
  value,
  onChange,
  label = 'Type the whole address',
}: {
  value: AddressValue
  onChange: (next: AddressValue) => void
  label?: string
}) {
  const [raw, setRaw]   = useState('')
  const [hint, setHint] = useState<ParsedAddress | null>(null)

  function apply(text: string) {
    const trimmed = text.trim()
    if (!trimmed) { setHint(null); return }
    const parsed = parseAddress(trimmed)
    setHint(parsed)
    // The single-line box owns the whole address when it is used, so all five
    // fields are replaced together. Applying only the non-null ones would leave
    // a previous customer's city sitting under a new street.
    onChange(toValue(parsed))
  }

  // Parsing on paste as well as blur means the common case — copy an address out
  // of a text message, paste, done — fills the fields without a second gesture.
  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    if (!text) return
    e.preventDefault()
    setRaw(text)
    apply(text)
  }

  const missing = hint
    ? (['city', 'state', 'zip'] as const).filter(k => !hint[k])
    : []

  const current = [
    value.address_line1,
    value.address_line2,
    [value.city, value.state].filter(Boolean).join(', '),
    value.zip,
  ].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
        {label}
      </label>
      <input
        style={inp}
        value={raw}
        onChange={e => setRaw(e.target.value)}
        onBlur={e => apply(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); apply(raw) } }}
        placeholder="123 Main St Suite 4, Wauchula, FL 33873"
      />

      {hint ? (
        <div className="text-xs mt-0.5" style={{ color: MUTED }}>
          {missing.length === 3 && !hint.address_line2 ? (
            <span style={{ color: ORANGE }}>
              Couldn&apos;t read this one — the whole line went into Address Line 1. Split it by hand below.
            </span>
          ) : (
            <>
              <span>Parsed from what you typed → {current || '—'}</span>
              {missing.length > 0 && (
                <span className="block" style={{ color: ORANGE }}>
                  No {missing.join(' / ')} found — fill {missing.length === 1 ? 'it' : 'them'} in below.
                </span>
              )}
            </>
          )}
        </div>
      ) : (
        <p className="text-xs mt-0.5" style={{ color: MUTED }}>
          Paste or type the full address — it fills the fields below. Check them before saving.
        </p>
      )}
    </div>
  )
}
