'use client'

import { useEffect, useState } from 'react'

// The road call and diagnostic fee inputs.
//
// "035.00": typing 35 into a road call field holding 0 left the leading zero on
// screen. The field was value={number}, and React compares a type="number" input's
// DOM text to the new value LOOSELY - "035" == 35 - so it never rewrote the field.
//
// So this keeps the TEXT the tech is typing as its own state, with leading zeros
// stripped as they type, and reports the number upward. Holding the text rather than
// re-deriving it from the number is what lets "35." survive long enough to become
// "35.50". A 0 shows as an empty field with a placeholder, the rule the diagnostic fee
// already used: a zero nobody typed reads as "I charge nothing".

export function stripLeadingZeros(raw: string): string {
  return raw.replace(/^0+(?=\d)/, '')
}

export function parseFee(raw: string): number {
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export default function FeeInput({
  value, onChange, disabled, style,
}: {
  value: number
  onChange: (n: number) => void
  disabled?: boolean
  style?: React.CSSProperties
}) {
  const [text, setText] = useState(value === 0 ? '' : String(value))

  // A value set from outside (the settings seed, an edit form loading) replaces the
  // text, but only when it is a different number - not on every keystroke's echo.
  useEffect(() => {
    setText(t => (parseFee(t) === value ? t : value === 0 ? '' : String(value)))
  }, [value])

  return (
    <input
      style={style}
      type="text"
      inputMode="decimal"
      value={text}
      placeholder="0.00"
      disabled={disabled}
      onChange={e => {
        // Digits and one point only, leading zeros gone.
        const cleaned = stripLeadingZeros(e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))
        setText(cleaned)
        onChange(parseFee(cleaned))
      }}
    />
  )
}
