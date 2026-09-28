'use client'

// ─── The one extra question a FAIL opens ──────────────────────────────────────
// Shared by every inspection form in both products, so the wording and the rules are
// identical on a DOT annual, a crane frequent and an LD multi-point.
//
// Pass / Fail / N-A is untouched. This is not a fourth grade — it is a follow-up on
// one answer, which is how the trade already works: 49 CFR 396.11 asks the mechanic to
// certify whether a defect "would affect the safety of operation", and CVSA
// out-of-service criteria are a separate standard from "something is wrong".
//
// THE NOTE IS REQUIRED EITHER WAY. Deadlining a machine needs a reason, and so does
// choosing not to — that second one is the mechanic's certification, and it is the
// whole audit value of splitting the two decisions.

import { defaultOosFor, type OosCapableItem } from '@/lib/inspections/out-of-service'

export default function OosPrompt({
  item,
  outOfService,
  oosNote,
  onChange,
  disabled = false,
  tone = 'hd',
}: {
  item:         OosCapableItem
  outOfService: boolean | null | undefined
  oosNote:      string | null | undefined
  onChange:     (patch: { outOfService?: boolean; oosNote?: string }) => void
  disabled?:    boolean
  /** hd = dark inspection cards; ld = the nwi-* utility classes. */
  tone?:        'hd' | 'ld'
}) {
  const auto      = defaultOosFor(item)
  const answered  = outOfService === true || outOfService === false
  const noteGiven = String(oosNote ?? '').trim().length > 0
  // A checkpoint that defaults to Yes and was answered No is a deliberate override,
  // and the form says so rather than leaving the print-out to reveal it.
  const overridden = auto && outOfService === false

  const faint = tone === 'hd' ? 'rgba(var(--hd-ink-rgb), 0.5)' : 'rgba(255,255,255,0.45)'
  const text  = tone === 'hd' ? 'rgba(var(--hd-ink-rgb), 0.85)' : '#ffffff'

  return (
    <div
      className="px-4 py-3 space-y-2"
      style={{ background: '#1a0505', borderTop: '1px solid #EF444440' }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold" style={{ color: text }}>
          Out of service?
        </span>
        {([true, false] as const).map(value => {
          const active = outOfService === value
          return (
            <button
              key={String(value)}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ outOfService: value })}
              className="px-3 py-1 rounded text-xs font-bold transition-colors"
              style={{
                background: active ? (value ? '#EF4444' : '#F59E0B') : 'transparent',
                color:      active ? '#ffffff' : faint,
                border:     `1px solid ${active ? (value ? '#EF4444' : '#F59E0B') : '#EF444440'}`,
              }}
            >
              {value ? 'Yes' : 'No'}
            </button>
          )
        })}
        {auto && !answered && (
          <span className="text-[10px] font-semibold" style={{ color: '#EF4444' }}>
            defaults to Yes on this checkpoint
          </span>
        )}
        {overridden && (
          <span className="text-[10px] font-semibold" style={{ color: '#F59E0B' }}>
            overridden — this checkpoint normally goes out of service
          </span>
        )}
      </div>

      <input
        className="nwi-input text-sm w-full"
        placeholder={
          outOfService === true
            ? 'Why is this out of service? (required)'
            : outOfService === false
              ? 'Why can it stay in service? (required)'
              : 'Reason (required)'
        }
        value={oosNote ?? ''}
        disabled={disabled}
        onChange={e => onChange({ oosNote: e.target.value })}
      />

      {answered && !noteGiven && (
        <p className="text-[11px]" style={{ color: '#EF4444' }}>
          A note is required on this decision.
        </p>
      )}
      {!answered && (
        <p className="text-[11px]" style={{ color: faint }}>
          {auto
            ? 'Brakes, structural welds, steering, tires, ROPS and coupling devices default to Yes — you can still answer No with a reason.'
            : 'A failed item does not take the unit out of service by itself.'}
        </p>
      )}
    </div>
  )
}
