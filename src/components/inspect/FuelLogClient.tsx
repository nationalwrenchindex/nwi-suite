'use client'

// Log Fuel — the third branch behind the QR sticker.
//
// Four steps, in the order the driver is physically standing there:
//   capture  → point the phone at the pump display
//   reading  → the model transcribes it
//   review   → every figure editable, who he is, and the hub odometer
//   saved    → what his tank actually did
//
// DESIGNED FOR A COLD HAND AT A FUEL ISLAND. Every target is past the 44px floor,
// every numeric box opens the number pad, and no step can dead-end: a failed read
// drops straight onto the same review screen with empty boxes and the pump still lit
// in front of him. The photo is a shortcut for typing, never a requirement.
//
// Matches TechServiceEntry's structure deliberately — the two branches of this flow
// must not look like different apps to someone who uses both.

import { useCallback, useEffect, useRef, useState } from 'react'
import { NWI_ORANGE } from '@/components/fleet-pro/brand'
import {
  EMPTY_FUEL_EXTRACTION,
  FUEL_IMAGE_TYPES,
  FUEL_FIELD_LABELS,
  MAX_DRIVER_NAME_CHARS,
  MAX_FUEL_IMAGE_BYTES,
  MAX_PLAUSIBLE_MPG,
  type ExtractedFuel,
  type FuelFieldKey,
  type FuelRosterDriver,
} from '@/types/fleet-pro-fuel'

const CARD   = '#111920'
const BORDER = '#1e3040'
const MUTED  = 'rgba(255,255,255,0.55)'
const FAINT  = 'rgba(255,255,255,0.35)'
const RED    = '#ef4444'
const GREEN  = '#22C55E'

type Step = 'capture' | 'reading' | 'review' | 'saved'

interface Draft {
  gallons:          string
  total_cost:       string
  price_per_gallon: string
  odometer_end:     string
  driver_name:      string
}

const BLANK_DRAFT: Draft = {
  gallons:          '',
  total_cost:       '',
  price_per_gallon: '',
  odometer_end:     '',
  driver_name:      '',
}

/** Model output → editable strings. null becomes '' so an unread field shows as an
 *  empty box rather than the word "null". */
function draftFrom(extracted: ExtractedFuel, keepName: string, keepOdo: string): Draft {
  return {
    gallons:          extracted.gallons          === null ? '' : String(extracted.gallons),
    total_cost:       extracted.total_cost       === null ? '' : String(extracted.total_cost),
    price_per_gallon: extracted.price_per_gallon === null ? '' : String(extracted.price_per_gallon),
    odometer_end:     keepOdo,
    driver_name:      keepName,
  }
}

/** '' -> null so an empty box is never posted as 0. */
function num(value: string): number | null {
  const trimmed = value.replace(/[$,\s]/g, '')
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export default function FuelLogClient({ unitId }: { unitId: string }) {
  const [step, setStep] = useState<Step>('capture')

  const [preview, setPreview] = useState<string | null>(null)
  const fileRef  = useRef<File | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [draft, setDraft]   = useState<Draft>(BLANK_DRAFT)
  const [unread, setUnread] = useState<FuelFieldKey[]>([])

  // Roster + previous odometer, fetched on mount from the same public route the page
  // already uses. Fetched client-side rather than threaded through the server render
  // so this branch is entirely self-contained and the pre-trip path is untouched.
  const [roster, setRoster]       = useState<FuelRosterDriver[]>([])
  const [driverId, setDriverId]   = useState<string>('')
  const [offRoster, setOffRoster] = useState(false)
  const [prevOdo, setPrevOdo]     = useState<number | null>(null)

  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [result, setResult] = useState<{ mpg: number | null; miles: number | null; duplicate: boolean } | null>(null)

  // Minted ONCE, when the driver first reaches the review screen, and reused by every
  // retry after that. The server treats a duplicate as success, so a phone on one bar
  // at a truck stop cannot file the same tank twice.
  const clientUuid = useRef<string | null>(null)

  // Object URLs leak until revoked, and a driver may retake the photo several times.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  useEffect(() => {
    let cancelled = false

    async function loadContext() {
      try {
        const res = await fetch(`/api/inspect/${unitId}`, { credentials: 'omit' })
        if (!res.ok) return
        const json = await res.json() as { roster?: FuelRosterDriver[]; last_odometer?: number | null }
        if (cancelled) return
        setRoster(json.roster ?? [])
        setPrevOdo(json.last_odometer ?? null)
        // A fleet with nobody on the roster gets the free-text box immediately rather
        // than an empty dropdown that looks broken.
        if ((json.roster ?? []).length === 0) setOffRoster(true)
      } catch {
        // Offline or unreachable: the driver types his name. Not worth an error.
        if (!cancelled) setOffRoster(true)
      }
    }

    loadContext()
    return () => { cancelled = true }
  }, [unitId])

  const startReview = useCallback((extracted: ExtractedFuel, unreadKeys: FuelFieldKey[]) => {
    if (!clientUuid.current) clientUuid.current = crypto.randomUUID()
    setDraft(prev => draftFrom(extracted, prev.driver_name, prev.odometer_end))
    setUnread(unreadKeys)
    setStep('review')
  }, [])

  function pickFile(file: File | null) {
    setError(null)
    setNotice(null)
    if (!file) return

    // Checked again on the server; this copy exists so the driver is told at the
    // moment he picks the photo rather than after a 5MB upload on a truck-stop signal.
    if (!(FUEL_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setError('Use your phone camera — that file is not a JPEG or PNG photo.')
      return
    }
    if (file.size > MAX_FUEL_IMAGE_BYTES) {
      setError('That photo is too large. Take it again at normal quality.')
      return
    }

    if (preview) URL.revokeObjectURL(preview)
    fileRef.current = file
    setPreview(URL.createObjectURL(file))
  }

  async function readPump() {
    const file = fileRef.current
    if (!file || busy) return

    setBusy(true)
    setError(null)
    setStep('reading')

    try {
      const form = new FormData()
      form.append('unit_id', unitId)
      form.append('image', file)

      const res  = await fetch('/api/inspect/fuel-extract', {
        method: 'POST', body: form, credentials: 'omit',
      })
      const json = await res.json() as {
        ok?: boolean
        error?: string
        extracted?: ExtractedFuel
        unread?: FuelFieldKey[]
      }

      if (!res.ok || !json.ok || !json.extracted) {
        // A failed read is not a dead end — the pump is still lit in front of him.
        setNotice(json.error ?? 'Could not read that photo. Type the numbers in.')
        startReview(EMPTY_FUEL_EXTRACTION, [])
        return
      }

      startReview(json.extracted, json.unread ?? [])
      setNotice('Check every number against the pump before you save.')
    } catch {
      setNotice('No signal for the pump reader. Type the numbers in — it still saves.')
      startReview(EMPTY_FUEL_EXTRACTION, [])
    } finally {
      setBusy(false)
    }
  }

  function skipPhoto() {
    setNotice('Type the numbers off the pump.')
    startReview(EMPTY_FUEL_EXTRACTION, [])
  }

  async function submit() {
    if (busy) return

    const odometer = num(draft.odometer_end)
    // Caught here so the driver is not told about it after an upload. The server
    // re-checks against its own record of the previous reading — the client's copy is
    // display only and is not trusted.
    if (odometer !== null && prevOdo !== null && odometer < prevOdo) {
      setError(`That odometer is lower than this unit's last reading (${prevOdo.toLocaleString()}). Check the hub meter.`)
      return
    }

    setBusy(true)
    setError(null)

    try {
      const form = new FormData()
      form.append('unit_id', unitId)
      if (clientUuid.current) form.append('client_uuid', clientUuid.current)
      if (fileRef.current) form.append('image', fileRef.current)

      if (draft.gallons)          form.append('gallons', draft.gallons)
      if (draft.total_cost)       form.append('total_cost', draft.total_cost)
      if (draft.price_per_gallon) form.append('price_per_gallon', draft.price_per_gallon)
      if (draft.odometer_end)     form.append('odometer_end', draft.odometer_end)

      // driver_id only when he picked himself; the name always goes, because it is the
      // only identity an off-roster driver has.
      if (!offRoster && driverId) form.append('driver_id', driverId)
      const chosen = roster.find(d => d.id === driverId)
      const name   = offRoster ? draft.driver_name : (chosen?.full_name ?? draft.driver_name)
      if (name) form.append('driver_name', name)

      const res  = await fetch('/api/inspect/fuel-log', {
        method: 'POST', body: form, credentials: 'omit',
      })
      const json = await res.json() as {
        ok?: boolean; error?: string; duplicate?: boolean
        mpg?: number | null; miles?: number | null
      }

      if (!res.ok || !json.ok) {
        setError(json.error ?? 'Could not save the fuel log. Try again.')
        return
      }

      setResult({
        mpg:       json.mpg ?? null,
        miles:     json.miles ?? null,
        duplicate: json.duplicate === true,
      })
      setStep('saved')
    } catch {
      setError('No signal. Stay on this screen and tap Save again when you have a bar.')
    } finally {
      setBusy(false)
    }
  }

  const set = (key: keyof Draft) => (value: string) =>
    setDraft(prev => ({ ...prev, [key]: value }))

  // ── capture ─────────────────────────────────────────────────────────────────
  if (step === 'capture') {
    return (
      <div style={wrap}>
        <h2 style={h2}>Log Fuel</h2>
        <p style={{ ...body, marginBottom: 18 }}>
          Point your camera at the pump display and take a clear photo.
        </p>

        <p style={{ ...hint, marginBottom: 18 }}>
          Get the gallons, the price and the total in frame. If the glare beats it, you
          can type the numbers in instead — nothing here is required.
        </p>

        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="Pump display"
            style={{
              width: '100%', borderRadius: 12, border: `1px solid ${BORDER}`,
              marginBottom: 14, maxHeight: 340, objectFit: 'contain', background: '#000',
            }}
          />
        ) : null}

        {/* accept + capture together: a phone opens the rear camera straight away
            rather than a file browser. */}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={e => {
            pickFile(e.target.files?.[0] ?? null)
            // Reset so retaking the SAME file still fires onChange.
            e.target.value = ''
          }}
        />

        {error ? <p style={errorText}>{error}</p> : null}

        <button type="button" style={primaryBtn} onClick={() => inputRef.current?.click()}>
          {preview ? 'Retake photo' : 'Open camera'}
        </button>

        {preview ? (
          <button type="button" style={primaryBtn} onClick={readPump} disabled={busy}>
            Read the pump
          </button>
        ) : null}

        <button type="button" style={secondaryBtn} onClick={skipPhoto}>
          Skip the photo — type it in
        </button>
      </div>
    )
  }

  // ── reading ─────────────────────────────────────────────────────────────────
  if (step === 'reading') {
    return (
      <div style={{ ...wrap, textAlign: 'center', paddingTop: 48 }}>
        <p style={{ ...h2, marginBottom: 8 }}>Reading the pump…</p>
        <p style={hint}>A few seconds. You can correct anything it gets wrong.</p>
      </div>
    )
  }

  // ── saved ───────────────────────────────────────────────────────────────────
  if (step === 'saved' && result) {
    return (
      <div style={wrap}>
        <div style={{
          background: CARD, border: `1px solid ${GREEN}55`, borderLeft: `4px solid ${GREEN}`,
          borderRadius: 12, padding: 18, marginBottom: 16,
        }}>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#fff' }}>
            {result.duplicate ? 'Already saved' : 'Fuel logged'}
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: MUTED, lineHeight: 1.5 }}>
            {result.duplicate
              ? 'This fillup was already on file — nothing was duplicated.'
              : 'Recorded against this unit.'}
          </p>
        </div>

        {result.mpg !== null ? (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18, marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 13, color: FAINT, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              This tank
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 34, fontWeight: 800, color: NWI_ORANGE, lineHeight: 1.1 }}>
              {result.mpg.toFixed(2)} <span style={{ fontSize: 16, color: MUTED }}>mpg</span>
            </p>
            {result.miles !== null ? (
              <p style={{ margin: '6px 0 0', fontSize: 14, color: MUTED }}>
                {result.miles.toLocaleString()} miles since the last reading.
              </p>
            ) : null}
          </div>
        ) : (
          // Explained in words rather than shown as a dash. A driver who sees a blank
          // assumes the app lost his entry.
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 18, marginBottom: 16 }}>
            <p style={{ margin: 0, fontSize: 14, color: MUTED, lineHeight: 1.5 }}>
              No miles-per-gallon this time — there is no earlier odometer on this unit
              to measure from, or the gallons were left blank. The next fillup will have one.
            </p>
          </div>
        )}

        <p style={hint}>You can close this page.</p>
      </div>
    )
  }

  // ── review ──────────────────────────────────────────────────────────────────
  const flagged = (key: FuelFieldKey) => unread.includes(key)
  const odometerNow = num(draft.odometer_end)
  const milesPreview = odometerNow !== null && prevOdo !== null && odometerNow >= prevOdo
    ? odometerNow - prevOdo
    : null
  const gallonsNow = num(draft.gallons)
  const mpgPreview = milesPreview !== null && gallonsNow !== null && gallonsNow > 0
    ? milesPreview / gallonsNow
    : null

  return (
    <div style={wrap}>
      <h2 style={h2}>Check these numbers</h2>

      {notice ? <p style={{ ...hint, marginBottom: 14 }}>{notice}</p> : null}
      {unread.length > 0 ? (
        <p style={{ ...hint, color: NWI_ORANGE, marginBottom: 14 }}>
          Could not read: {unread.map(k => FUEL_FIELD_LABELS[k]).join(', ')}. Type{' '}
          {unread.length === 1 ? 'it' : 'them'} in.
        </p>
      ) : null}

      <Field label="Gallons" value={draft.gallons} onChange={set('gallons')}
             inputMode="decimal" flagged={flagged('gallons')} />
      <Field label="Total cost ($)" value={draft.total_cost} onChange={set('total_cost')}
             inputMode="decimal" flagged={flagged('total_cost')} />
      <Field label="Price per gallon ($)" value={draft.price_per_gallon} onChange={set('price_per_gallon')}
             inputMode="decimal" flagged={flagged('price_per_gallon')} />

      {/* ── who ──────────────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 18, marginBottom: 6 }}>
        <label style={labelStyle}>Who are you?</label>
        {!offRoster && roster.length > 0 ? (
          <>
            <select
              value={driverId}
              onChange={e => setDriverId(e.target.value)}
              style={inputStyle}
            >
              <option value="">Select your name…</option>
              {roster.map(d => (
                <option key={d.id} value={d.id}>{d.full_name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => { setOffRoster(true); setDriverId('') }}
              style={{ ...linkBtn, marginTop: 8 }}
            >
              Not listed — type my name
            </button>
          </>
        ) : (
          <>
            <input
              type="text"
              value={draft.driver_name}
              onChange={e => set('driver_name')(e.target.value)}
              maxLength={MAX_DRIVER_NAME_CHARS}
              placeholder="Your name"
              style={inputStyle}
            />
            {roster.length > 0 ? (
              <button
                type="button"
                onClick={() => setOffRoster(false)}
                style={{ ...linkBtn, marginTop: 8 }}
              >
                ← Pick from the list instead
              </button>
            ) : null}
          </>
        )}
      </div>

      {/* ── odometer ─────────────────────────────────────────────────────────── */}
      <Field
        label="Odometer now (hub miles)"
        value={draft.odometer_end}
        onChange={set('odometer_end')}
        inputMode="numeric"
        flagged={false}
      />
      {prevOdo !== null ? (
        <p style={{ ...hint, marginTop: -6, marginBottom: 12 }}>
          Last reading on this unit: <strong style={{ color: MUTED }}>{prevOdo.toLocaleString()}</strong>
        </p>
      ) : (
        <p style={{ ...hint, marginTop: -6, marginBottom: 12 }}>
          No earlier reading on this unit yet — this one becomes the baseline.
        </p>
      )}

      {/* Live arithmetic, so a mis-keyed odometer is obvious BEFORE it is saved. An
          implausible mpg here is nearly always trip miles typed instead of hub miles. */}
      {milesPreview !== null ? (
        <div style={{
          background: CARD, border: `1px solid ${mpgPreview !== null && mpgPreview > MAX_PLAUSIBLE_MPG ? RED : BORDER}`,
          borderRadius: 10, padding: 12, marginBottom: 14,
        }}>
          <p style={{ margin: 0, fontSize: 13, color: MUTED }}>
            {milesPreview.toLocaleString()} miles since the last reading
            {mpgPreview !== null ? ` · ${mpgPreview.toFixed(2)} mpg` : ''}
          </p>
          {mpgPreview !== null && mpgPreview > MAX_PLAUSIBLE_MPG ? (
            <p style={{ margin: '6px 0 0', fontSize: 13, color: RED, lineHeight: 1.45 }}>
              That is higher than a truck can do. Check you entered the hub odometer,
              not the trip meter — it will save, but without an mpg figure.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? <p style={errorText}>{error}</p> : null}

      <button type="button" style={primaryBtn} onClick={submit} disabled={busy}>
        {busy ? 'Saving…' : 'Save fuel log'}
      </button>

      <p style={{ ...hint, marginTop: 12 }}>
        Anything you leave blank is simply not recorded. Nothing here is guessed for you.
      </p>
    </div>
  )
}

/** A labelled box. Flagged fields get the orange rule so the driver's eye lands on
 *  what the machine could not read rather than on the whole form. */
function Field({
  label, value, onChange, inputMode, flagged,
}: {
  label:     string
  value:     string
  onChange:  (value: string) => void
  inputMode: 'decimal' | 'numeric' | 'text'
  flagged:   boolean
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>
        {label}
        {flagged ? <span style={{ color: NWI_ORANGE, marginLeft: 6 }}>• not read</span> : null}
      </label>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          ...inputStyle,
          borderColor: flagged ? `${NWI_ORANGE}88` : BORDER,
        }}
      />
    </div>
  )
}

const wrap: React.CSSProperties = {
  flex: 1, padding: 16, maxWidth: 640, margin: '0 auto', width: '100%',
}

const h2: React.CSSProperties = {
  margin: '4px 0 10px', fontSize: 24, fontWeight: 800, color: '#fff', lineHeight: 1.2,
}

const body: React.CSSProperties = {
  margin: 0, fontSize: 16, color: MUTED, lineHeight: 1.5,
}

const hint: React.CSSProperties = {
  margin: 0, fontSize: 13, color: FAINT, lineHeight: 1.5,
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 13, color: MUTED, marginBottom: 6,
}

const inputStyle: React.CSSProperties = {
  width: '100%', minHeight: 52, padding: '0 14px', fontSize: 18,
  background: '#0d151d', color: '#fff',
  border: `1px solid ${BORDER}`, borderRadius: 10,
}

const primaryBtn: React.CSSProperties = {
  display: 'block', width: '100%', minHeight: 56, marginBottom: 12,
  fontSize: 17, fontWeight: 800, color: '#fff', cursor: 'pointer',
  background: NWI_ORANGE, border: 'none', borderRadius: 12,
}

const secondaryBtn: React.CSSProperties = {
  display: 'block', width: '100%', minHeight: 52, marginBottom: 12,
  fontSize: 15, fontWeight: 600, color: MUTED, cursor: 'pointer',
  background: 'transparent', border: `1px solid ${BORDER}`, borderRadius: 12,
}

const linkBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: NWI_ORANGE,
  fontSize: 14, cursor: 'pointer', padding: '6px 0', textAlign: 'left',
}

const errorText: React.CSSProperties = {
  margin: '0 0 12px', fontSize: 14, color: RED, lineHeight: 1.45,
}
