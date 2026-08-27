'use client'

// The first screen behind the QR sticker: who is holding the phone?
//
// One sticker, two jobs. At 5am it is a driver doing a walkaround. At 2pm it is a
// technician holding the paper invoice for the repair he just finished. Both scan the
// same code, so the page has to ask — once, with two targets big enough to hit in
// gloves — and then get out of the way.
//
// The pre-trip branch renders PretripClient completely unchanged, including its own
// header, which is why this component does NOT wrap it: PretripClient already draws
// the unit header, and wrapping it here would stack two of them. The chooser and the
// service-entry branch draw the header below instead, so every screen in the flow has
// the unit and the carrier's branding at the top.

import { useState } from 'react'
import { NWI_ORANGE } from '@/components/fleet-pro/brand'
import PretripClient from './PretripClient'
import TechServiceEntry from './TechServiceEntry'
import type { PretripUnitInfo } from '@/types/fleet-pro-partner'

// Kept in step with PretripClient — the two halves of this flow must not drift apart
// visually, or the second screen looks like a different app.
const BG     = '#0a0f14'
const CARD   = '#111920'
const BORDER = '#1e3040'
const MUTED  = 'rgba(255,255,255,0.55)'
const FAINT  = 'rgba(255,255,255,0.35)'

type Mode = 'choose' | 'pretrip' | 'service'

export default function EntryChooser({
  unitId,
  initialUnit,
}: {
  unitId:      string
  initialUnit: PretripUnitInfo | null
}) {
  const [mode, setMode] = useState<Mode>('choose')

  // Untouched pre-trip flow. Rendered bare so PretripClient owns the whole screen
  // exactly as it did before this chooser existed.
  if (mode === 'pretrip') {
    return <PretripClient unitId={unitId} initialUnit={initialUnit} />
  }

  return (
    <main style={pageStyle}>
      <UnitHeader
        unit={initialUnit}
        onBack={mode === 'service' ? () => setMode('choose') : null}
      />

      {mode === 'service' ? (
        <TechServiceEntry unitId={unitId} />
      ) : (
        <div style={{ flex: 1, padding: 16, maxWidth: 640, margin: '0 auto', width: '100%' }}>
          <p style={{ margin: '4px 0 16px', fontSize: 15, color: MUTED, lineHeight: 1.5 }}>
            What are you doing at this unit?
          </p>

          <ChoiceButton
            title="Driver Pre-Trip Inspection"
            detail="Daily walkaround. Works with no signal."
            onClick={() => setMode('pretrip')}
          />

          <ChoiceButton
            title="Technician Service Entry"
            detail="Photograph a repair invoice and log the work."
            onClick={() => setMode('service')}
          />

          <p style={{ margin: '18px 4px 0', fontSize: 13, color: FAINT, lineHeight: 1.5 }}>
            {initialUnit?.unit_number
              ? `Everything you file here is recorded against unit ${initialUnit.unit_number}.`
              : 'Everything you file here is recorded against the unit on this sticker.'}
          </p>
        </div>
      )}
    </main>
  )
}

/**
 * A full-width target, not a row in a list. These are pressed once per scan by someone
 * whose hands are cold and possibly gloved, so the whole card is the button and the
 * minimum height is well past the 44px floor.
 */
function ChoiceButton({
  title, detail, onClick,
}: {
  title:   string
  detail:  string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block', width: '100%', minHeight: 96, marginBottom: 14,
        padding: '18px 16px', textAlign: 'left', cursor: 'pointer',
        background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12,
        borderLeft: `4px solid ${NWI_ORANGE}`,
      }}
    >
      <span style={{ display: 'block', fontSize: 20, fontWeight: 800, color: '#fff', lineHeight: 1.25 }}>
        {title}
      </span>
      <span style={{ display: 'block', fontSize: 14, color: MUTED, marginTop: 6, lineHeight: 1.4 }}>
        {detail}
      </span>
    </button>
  )
}

/**
 * The same header PretripClient draws, minus the offline/queue pills (those belong to
 * the pre-trip queue, which this side of the flow does not use). Duplicated rather than
 * imported because PretripClient is deliberately not being modified.
 */
function UnitHeader({
  unit, onBack,
}: {
  unit:   PretripUnitInfo | null
  onBack: (() => void) | null
}) {
  const spec = unit
    ? [unit.year ? String(unit.year) : null, unit.manufacturer, unit.model].filter(Boolean).join(' ')
    : ''

  // brand_name is non-nullable and the loader fills it with 'Pre-Trip Inspection' for a
  // fleet that has no white-label branding. That is the right default on the driver's
  // screen but wrong above a chooser that also offers service entry, so the generic
  // value is treated here as "unbranded". Handled in this file rather than by changing
  // the loader, so the driver's header text is unaffected.
  const brand = unit && unit.brand_name && unit.brand_name !== 'Pre-Trip Inspection'
    ? unit.brand_name
    : 'Unit Record'

  return (
    <header style={{ borderBottom: `1px solid ${BORDER}`, background: '#0d151d' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* White-labelled: the tech sees the carrier's brand, not NWI's. Plain <img>
              so it renders straight from cache with no optimizer round-trip. */}
          {unit?.brand_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={unit.brand_logo_url}
              alt=""
              style={{ height: 32, maxWidth: 140, objectFit: 'contain' }}
            />
          ) : null}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13, color: MUTED, letterSpacing: '0.06em', textTransform: 'uppercase',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {brand}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', lineHeight: 1.15 }}>
              {unit?.unit_number ? `Unit ${unit.unit_number}` : 'Unit Record'}
            </div>
            {spec || unit?.serial_number ? (
              <div style={{ fontSize: 12, color: FAINT }}>
                {[spec, unit?.serial_number ? `S/N ${unit.serial_number}` : null].filter(Boolean).join(' · ')}
              </div>
            ) : null}
          </div>
          <div style={{ width: 4, alignSelf: 'stretch', background: NWI_ORANGE, borderRadius: 2 }} />
        </div>

        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            style={{
              marginTop: 10, minHeight: 44, padding: '0 14px', fontSize: 14, borderRadius: 8,
              background: 'transparent', border: `1px solid ${BORDER}`, color: MUTED, cursor: 'pointer',
            }}
          >
            ← Back
          </button>
        ) : null}
      </div>
    </header>
  )
}

const pageStyle: React.CSSProperties = {
  minHeight: '100dvh',
  background: BG,
  color: '#fff',
  // Self-contained: no app nav, no Fleet Pro shell. This page is the whole screen.
  display: 'flex',
  flexDirection: 'column',
}
