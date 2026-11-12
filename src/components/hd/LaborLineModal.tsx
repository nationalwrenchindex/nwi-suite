'use client'

// ADD LABOR LINE - one modal for the HD quote, work order and invoice (Nov 12).
//
// This was the quote form's own modal (library and guide search, the card's midpoint
// pre-fill, the separate refrigeration service line, save to my library). The work
// order added a blank row and both invoice forms had a bare description + hours box,
// so a line typed there could not come from a labor card at all. Moved here whole; the
// quote's behaviour is unchanged.
//
// What differs by document:
//   allowRange   true on a quote only. "+ add a range" and the 1.5-2.5 hr recovery
//                add-on are estimating spreads; a work order and an invoice record one
//                number. A guide entry with a spread pre-fills its midpoint there.
//   docName      the words "quote" / "work order" / "invoice" in the notes.
//   laborRate    null when the document has none: the math line says so, and the line
//                is added with no amount rather than a made-up rate.
//
// Every line Add produces carries repair_item_id while it still has the picked card's
// name, so the work order records which labor card each line was (migration 187).

import { useEffect, useState } from 'react'
import { LABOR_GUIDE, type LaborGuideItem } from '@/lib/hd/labor-guide'
import {
  billedHighFromLibrary, billedHoursFromLibrary, cardBilledPrefill, shopReferenceText, trimmedNotice,
} from '@/lib/hd/labor-library'
import { hoursText, sameOperationName } from '@/lib/hd/labor-cards'
import { billedHours, buildLaborLines, rangeMidpoint, type LaborLinePick } from '@/lib/hd/labor-line-build'
import { money } from '@/lib/format'

export type { LaborLinePick } from '@/lib/hd/labor-line-build'

const ORANGE     = '#FF6600'
const BLUE       = '#2969B0'
const D_BG       = 'var(--hd-sunken)'
const D_BORDER   = 'var(--hd-border)'
const D_INPUT_BG = 'var(--hd-inner)'

const dInp = {
  width: '100%',
  border: `1px solid ${D_BORDER}`,
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 14,
  color: 'var(--hd-text)',
  background: D_INPUT_BG,
  outline: 'none',
  minHeight: 44,
} as React.CSSProperties

// A row from the personal labor library (hd_repair_items)
interface LibraryItem {
  id: string
  labor_code: string | null
  description: string
  category: string | null
  mobile_hours: number | string | null
  mobile_hours_high: number | string | null
  shop_hours: number | string | null
  shop_hours_high: number | string | null
  requires_refrigeration: boolean
  refrigeration_service: string | null
  refrigeration_hours: number | string | null
  is_master: boolean
}

interface LaborSearch {
  term:  string
  items: LibraryItem[]
  total: number
  // The shop's own card named exactly the search text, for the duplicate hint.
  exact: { id: string; labor_code: string | null; description: string } | null
}
const NO_LABOR_SEARCH: LaborSearch = { term: '', items: [], total: 0, exact: null }
const LIBRARY_PICKER_LIMIT = 8
const GUIDE_PICKER_LIMIT   = 8

function fmtHrs(min: number, max: number, shopOnly = false): string {
  if (shopOnly) return 'Shop only'
  if (Math.abs(min - max) < 0.01) return `${min} hrs`
  return `${min} to ${max} hrs`
}

const libNum = (v: number | string | null): number | null =>
  v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v)

export default function LaborLineModal({
  open, onClose, onAdd, onToast, laborRate, categories, allowRange, docName,
}: {
  open: boolean
  onClose: () => void
  /** The lines to put on the document. The modal closes itself after. */
  onAdd: (lines: LaborLinePick[]) => void
  onToast: (message: string) => void
  laborRate: number | null
  /** The unit-type filter for the library search, or null for none. */
  categories: string[] | null
  allowRange: boolean
  docName: 'quote' | 'work order' | 'invoice'
}) {
  // ===========================================================================
  // ONE BILLABLE NUMBER
  // ===========================================================================
  //
  // laborMobileMin is the billable number. While laborRange is false the single input
  // writes BOTH min and max. BOOK HOURS ARE REFERENCE ONLY and have no input: they are
  // set from the library or guide item that was picked. The default is EMPTY, not
  // '1.0': a hand-typed job has no book time.
  const [laborDesc, setLaborDesc]           = useState('')
  const [laborBookMin, setLaborBookMin]     = useState('')
  const [laborBookMax, setLaborBookMax]     = useState('')
  const [laborMobileMin, setLaborMobileMin] = useState('1.5')
  const [laborMobileMax, setLaborMobileMax] = useState('1.5')
  // False = one number. Never true where no range is allowed.
  const [laborRange, setLaborRange]         = useState(false)
  const [laborRecharge, setLaborRecharge]   = useState(false)
  // Off by default (Oct 24).
  const [saveToLibrary, setSaveToLibrary]   = useState(false)
  const [laborSearch, setLaborSearch]       = useState<LaborSearch>(NO_LABOR_SEARCH)
  // The library card this line was picked from. While the name is unchanged the line
  // IS that card: it is counted by id when added, never re-saved, and carries its id.
  const [laborPicked, setLaborPicked]       = useState<LibraryItem | null>(null)
  // What a card pick put in Hours (billed), and from what - shown while the box still
  // holds exactly that, so a pre-filled figure never reads as this job's settled hours.
  const [laborPrefill, setLaborPrefill]     = useState<{ value: string; from: string } | null>(null)
  const [laborSelectedKey, setLaborSelectedKey] = useState('')
  // Set only when a library item carries explicit refrigeration_hours - its recovery
  // time becomes a SEPARATE labor line.
  const [laborRefrig, setLaborRefrig] = useState<{ hours: number; service: string | null } | null>(null)
  const [adding, setAdding] = useState(false)

  const rangeOn    = allowRange && laborRange
  const rechargeOn = allowRange && laborRecharge
  const laborTerm  = laborDesc.trim().toLowerCase()
  const categoriesKey = categories ? categories.join(',') : ''

  // The search runs on the server: description or labor code, the unit-type category
  // filter, own rows first and most used at the top. A newer keystroke cancels an older
  // request so results never arrive out of order.
  useEffect(() => {
    if (!open) return
    const term = laborDesc.trim()
    if (!term) { setLaborSearch(NO_LABOR_SEARCH); return }
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const sp = new URLSearchParams({ q: term, limit: String(LIBRARY_PICKER_LIMIT) })
        if (categoriesKey) sp.set('categories', categoriesKey)
        const res  = await fetch(`/api/hd/repair-items?${sp}`, { signal: ctl.signal })
        const data = await res.json()
        if (!res.ok) return
        const items = (data.items ?? []) as LibraryItem[]
        setLaborSearch({ term, items, total: Number(data.total ?? items.length), exact: data.exact ?? null })
      } catch { /* aborted or offline: keep the last results */ }
    }, 200)
    return () => { clearTimeout(t); ctl.abort() }
  }, [open, laborDesc, categoriesKey])

  if (!open) return null

  // Personal library first (own items then master), then LABOR_GUIDE fallbacks.
  const libMatches   = laborTerm ? laborSearch.items : []
  const libTrimmed   = laborTerm ? trimmedNotice(libMatches.length, laborSearch.total) : ''
  const guideAll     = laborTerm ? LABOR_GUIDE.filter(i => i.label.toLowerCase().includes(laborTerm)) : []
  const guideMatches = guideAll.slice(0, GUIDE_PICKER_LIMIT)
  const guideTrimmed = trimmedNotice(guideMatches.length, guideAll.length)
  const showLaborResults = laborTerm.length > 0 && (libMatches.length > 0 || guideMatches.length > 0)

  // While the name is the picked card's, the line is that card.
  const pickedUnchanged = laborPicked != null && sameOperationName(laborDesc, laborPicked.description)
  // Display only: the shop already has a card by this name. Never blocks, never merges.
  const sameNameCard = !pickedUnchanged && laborSearch.exact && sameOperationName(laborSearch.exact.description, laborDesc)
    ? laborSearch.exact : null
  // A picked card with no field time: billed hours are left blank on purpose.
  const pickedShopOnly = laborPicked != null && !billedHoursFromLibrary(laborPicked.mobile_hours)
  const pickedShopLo   = laborPicked ? libNum(laborPicked.shop_hours) : null
  const pickedShopHi   = laborPicked ? billedHighFromLibrary(laborPicked.shop_hours, laborPicked.shop_hours_high) : ''
  const pickedShopText = pickedShopLo != null && pickedShopLo > 0
    ? (pickedShopHi ? `${pickedShopLo} to ${pickedShopHi} hr` : `${pickedShopLo} hr`) : ''

  // "Bill shop time": fills the billed field from the shop figure, only when pressed.
  // Where no range is allowed, a shop spread bills its midpoint.
  function billShopTime() {
    if (pickedShopLo == null || pickedShopLo <= 0) return
    if (!allowRange && pickedShopHi) {
      const mid = String(rangeMidpoint(pickedShopLo, Number(pickedShopHi)))
      setLaborMobileMin(mid); setLaborMobileMax(mid); setLaborRange(false)
      return
    }
    setLaborMobileMin(String(pickedShopLo))
    setLaborMobileMax(pickedShopHi || String(pickedShopLo))
    setLaborRange(!!pickedShopHi)
  }

  function selectLibraryItem(i: LibraryItem) {
    // A card that records no shop hours has no book time: the reference stays empty.
    const book   = libNum(i.shop_hours)
    const bookOk = book != null && book > 0
    const bookHi = billedHighFromLibrary(i.shop_hours, i.shop_hours_high)
    // BILLED HOURS COME FROM FIELD TIME ONLY. A card with only shop time leaves the
    // field BLANK and offers "Bill shop time"; Add refuses a blank.
    setLaborDesc(i.description)
    setLaborBookMin(bookOk ? String(book) : '')
    setLaborBookMax(bookOk ? (bookHi || String(book)) : '')
    // A field RANGE pre-fills its MIDPOINT, to the quarter hour (cardBilledPrefill).
    const pre = cardBilledPrefill(i.mobile_hours, i.mobile_hours_high)
    setLaborRange(false)
    setLaborMobileMin(pre.value); setLaborMobileMax(pre.value)
    setLaborPrefill(pre.value ? pre : null)
    setLaborPicked(i)
    const refrigHrs = libNum(i.refrigeration_hours)
    if (i.requires_refrigeration && refrigHrs && refrigHrs > 0) {
      // Explicit refrigeration service -> its own separate line; base hours stay as-is.
      setLaborRefrig({ hours: refrigHrs, service: i.refrigeration_service ?? null })
      setLaborRecharge(false)
    } else {
      // Library items store complete hours - never auto-add the fixed recovery.
      setLaborRefrig(null)
      setLaborRecharge(false)
    }
    setLaborSelectedKey(`lib:${i.id}`)
  }

  function selectGuideItem(item: LaborGuideItem) {
    setLaborDesc(item.label)
    setLaborBookMin(String(item.book_min)); setLaborBookMax(String(item.book_max))
    const spread = Math.abs(item.mobile_max - item.mobile_min) > 0.01
    if (allowRange) {
      setLaborMobileMin(String(item.mobile_min)); setLaborMobileMax(String(item.mobile_max))
      // The mode follows the data: a spread shows the range, one number shows one field.
      setLaborRange(spread)
      setLaborRecharge(item.requires_refrigeration)
      setLaborPrefill(null)
    } else {
      // One number where no range is allowed: the spread's midpoint, said so under the box.
      const v = spread ? String(rangeMidpoint(item.mobile_min, item.mobile_max)) : String(item.mobile_min)
      setLaborMobileMin(v); setLaborMobileMax(v)
      setLaborRange(false)
      setLaborRecharge(false)
      setLaborPrefill(spread ? { value: v, from: `midpoint of the labor guide's ${item.mobile_min} to ${item.mobile_max} hr` } : null)
    }
    setLaborRefrig(null)
    setLaborSelectedKey(`guide:${item.label}`)
    setLaborPicked(null)
  }

  function reset() {
    setLaborDesc('')
    setLaborBookMin('');      setLaborBookMax('')
    setLaborMobileMin('1.5'); setLaborMobileMax('1.5')
    setLaborRange(false)
    setLaborRecharge(false)
    setLaborRefrig(null)
    setSaveToLibrary(false)
    setLaborSelectedKey('')
    setLaborPicked(null)
    setLaborPrefill(null)
    setLaborSearch(NO_LABOR_SEARCH)
    setAdding(false)
  }
  function close() { reset(); onClose() }

  // Always a new card (the route never merges). book is NULL when there was no book
  // figure. Resolves to the new card's id, or null.
  async function saveLaborToLibrary(description: string, book: number | null, mobile: number, refrig: boolean): Promise<string | null> {
    try {
      const res = await fetch('/api/hd/repair-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, shop_hours: book, mobile_hours: mobile, requires_refrigeration: refrig, source: 'manual' }),
      })
      if (!res.ok) return null
      const j = await res.json().catch(() => ({}))
      return typeof j?.item?.id === 'string' ? j.item.id : null
    } catch { return null }
  }

  // A picked card went onto the document: count it, by id. Own cards only - the route
  // refuses a catalog row - and never the hours.
  function countLibraryUse(i: LibraryItem) {
    if (i.is_master) return
    fetch(`/api/hd/repair-items/${i.id}/used`, { method: 'POST' }).catch(() => {})
  }

  const rate          = laborRate
  const { min: totalMobileMin, max: totalMobileMax } = billedHours({
    mobileMin: laborMobileMin, mobileMax: laborMobileMax, range: laborRange, recharge: laborRecharge, allowRange })
  const baseMobileMin = parseFloat(laborMobileMin) || 0
  const laborIsSpread = Math.abs(totalMobileMax - totalMobileMin) > 0.01

  // Book time as reference text, or '' when the job has none.
  const bookRefMin = parseFloat(laborBookMin)
  const bookRefMax = parseFloat(laborBookMax)
  const bookRefText = laborPicked
    ? shopReferenceText(laborBookMin, laborBookMax)
    : Number.isFinite(bookRefMin) && bookRefMin > 0
      ? (Number.isFinite(bookRefMax) && Math.abs(bookRefMax - bookRefMin) > 0.01
          ? `book: ${bookRefMin} to ${bookRefMax} hr`
          : `book: ${bookRefMin} hr`)
      : ''

  // The arithmetic, spelled out: "1.5 hrs x $135.00/hr = $202.50", at the real cent.
  function laborMath(): string {
    if (rate == null) {
      return laborIsSpread
        ? `${totalMobileMin} to ${totalMobileMax} hrs - no labor rate on this ${docName}, so no amount yet`
        : `${totalMobileMin} hrs - no labor rate on this ${docName}, so no amount yet`
    }
    const r = money(rate)
    if (laborIsSpread) {
      return `${totalMobileMin} to ${totalMobileMax} hrs x ${r}/hr = ${money(totalMobileMin * rate)} to ${money(totalMobileMax * rate)}`
    }
    return `${totalMobileMin} hrs x ${r}/hr = ${money(totalMobileMin * rate)}`
  }

  async function addLaborItem() {
    if (adding) return
    const description = laborDesc.trim()
    let cardId: string | null = pickedUnchanged && laborPicked ? laborPicked.id : null
    // A NEW card, only when ticked, and never with 0 billable hours (the route refuses
    // it too). Saved first so the line can carry the new card's id.
    const wantsSave = !(pickedUnchanged && laborPicked) && saveToLibrary
    const built = buildLaborLines({
      description, bookMin: laborBookMin, bookMax: laborBookMax,
      mobileMin: laborMobileMin, mobileMax: laborMobileMax, range: laborRange, recharge: laborRecharge,
      refrig: laborRefrig, rate, cardId, allowRange,
    })
    if ('error' in built) { onToast(built.error); return }
    setAdding(true)
    if (pickedUnchanged && laborPicked) {
      countLibraryUse(laborPicked)
    } else if (wantsSave && baseMobileMin > 0) {
      const book = laborBookMin.trim() ? (parseFloat(laborBookMin) || 0) : null
      cardId = await saveLaborToLibrary(description, book, baseMobileMin, rechargeOn || laborRefrig != null)
      if (cardId) built.lines[0] = { ...built.lines[0], repair_item_id: cardId }
    } else if (wantsSave) {
      onToast(`Added to the ${docName}. Not saved to your library - it has no billable hours.`)
    }
    onAdd(built.lines)
    close()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      data-testid="labor-line-modal"
    >
      <div
        style={{
          background: D_BG,
          border: `1px solid ${D_BORDER}`,
          borderRadius: '12px 12px 0 0',
          width: '100%',
          maxWidth: 540,
          maxHeight: '90dvh',
          display: 'flex',
          flexDirection: 'column',
        }}
        className="sm:rounded-xl"
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0" style={{ borderBottom: `1px solid ${D_BORDER}` }}>
          <h3 className="font-condensed font-bold text-xl" style={{ color: 'var(--hd-text)' }}>ADD LABOR LINE</h3>
          <button type="button" onClick={close} aria-label="Close" style={{ color: 'var(--hd-text-muted)' }}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="px-5 py-4 flex flex-col gap-4" style={{ overflowY: 'auto' }}>

          {/* Free-text description + live library/catalog results */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--hd-text-muted)' }}>Labor Description</label>
            <input
              autoFocus
              style={dInp}
              placeholder="Type a description or search your library below"
              value={laborDesc}
              onChange={e => { setLaborDesc(e.target.value); setLaborSelectedKey(''); setLaborRefrig(null) }}
            />

            {showLaborResults && (
              <div
                className="mt-1"
                style={{ border: `1px solid ${D_BORDER}`, borderRadius: 8, overflow: 'hidden', maxHeight: 240, overflowY: 'auto' }}
              >
                {/* Personal library first */}
                {libMatches.map(i => {
                  const key = `lib:${i.id}`
                  const isSel = laborSelectedKey === key
                  const fieldT = hoursText(i.mobile_hours, i.mobile_hours_high)
                  const shopT  = hoursText(i.shop_hours, i.shop_hours_high)
                  return (
                    <button
                      type="button"
                      key={key}
                      onClick={() => selectLibraryItem(i)}
                      className="w-full text-left px-4 py-2.5 flex items-center gap-3"
                      style={{
                        background: isSel ? 'var(--hd-inner)' : 'transparent',
                        borderLeft: isSel ? `3px solid ${ORANGE}` : '3px solid transparent',
                        borderBottom: `1px solid ${D_BORDER}`,
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: isSel ? 'var(--paper-accent)' : 'var(--hd-text)' }}>
                          {i.labor_code && <span className="font-mono text-xs mr-2" style={{ color: 'var(--hd-text-muted)' }}>{i.labor_code}</span>}
                          {i.description}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--hd-text-muted)' }}>
                          {`Field: ${fieldT || '—'}`} &nbsp;&bull;&nbsp; {`Shop: ${shopT || '—'}`}
                        </p>
                      </div>
                      {/* Only tech's own saved items get the badge; master items look native */}
                      {!i.is_master && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-semibold shrink-0 text-on-fill" style={{ background: BLUE }}>saved</span>
                      )}
                    </button>
                  )
                })}

                {libTrimmed && (
                  <p className="px-4 py-2 text-xs" style={{ color: 'var(--hd-warn)', borderBottom: `1px solid ${D_BORDER}` }}>
                    {`Your library: ${libTrimmed}`}
                  </p>
                )}

                {/* LABOR_GUIDE fallback suggestions */}
                {guideMatches.map(item => {
                  const key = `guide:${item.label}`
                  const isSel = laborSelectedKey === key
                  return (
                    <button
                      type="button"
                      key={key}
                      onClick={() => selectGuideItem(item)}
                      className="w-full text-left px-4 py-2.5 flex items-center gap-3"
                      style={{
                        background: isSel ? 'var(--hd-inner)' : 'transparent',
                        borderLeft: isSel ? `3px solid ${ORANGE}` : '3px solid transparent',
                        borderBottom: `1px solid ${D_BORDER}`,
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: isSel ? 'var(--paper-accent)' : 'var(--hd-text)' }}>{item.label}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--hd-text-muted)' }}>
                          Book: {fmtHrs(item.book_min, item.book_max, item.shop_only)}
                          &nbsp;&bull;&nbsp;
                          Mobile: {fmtHrs(item.mobile_min, item.mobile_max, item.shop_only)}
                          {item.requires_refrigeration && (
                            <span className="ml-2 font-semibold" style={{ color: 'var(--hd-info)' }}>❄ Refrig.</span>
                          )}
                        </p>
                      </div>
                    </button>
                  )
                })}
                {guideTrimmed && (
                  <p className="px-4 py-2 text-xs" style={{ color: 'var(--hd-warn)' }}>
                    {`Labor guide: ${guideTrimmed}`}
                  </p>
                )}
              </div>
            )}
            {sameNameCard && (
              <p className="text-xs mt-1" style={{ color: 'var(--hd-warn)' }}>
                {`You already have a card named this (${sameNameCard.labor_code ?? 'no code'}).`}
              </p>
            )}
          </div>

          {/* ONE BILLABLE NUMBER. Book time is reference, not an input. "+ add a range"
              is for the quote's jobs that genuinely have a spread. */}
          <div className="flex flex-col gap-1">
            <div className="flex items-end justify-between gap-3">
              <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--hd-text-muted)' }}>
                Hours (billed)
              </label>
              {/* Quote only. Hidden while the recharge add-on is on: it forces a range. */}
              {allowRange && !laborRecharge && (
                <button
                  type="button"
                  onClick={() => {
                    // Collapsing keeps the number the tech can SEE - the min.
                    setLaborMobileMax(laborMobileMin)
                    setLaborRange(!laborRange)
                  }}
                  className="text-xs font-semibold"
                  style={{ color: 'var(--hd-info)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  {laborRange ? 'use one number' : '+ add a range'}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={0.25}
                value={laborMobileMin}
                onChange={e => {
                  const v = e.target.value
                  setLaborMobileMin(v)
                  // Single-number mode keeps the two ends together.
                  if (!rangeOn) setLaborMobileMax(v)
                }}
                style={{ ...dInp, textAlign: 'center', maxWidth: 110 }}
                data-testid="labor-hours-billed"
              />
              {rangeOn && (
                <>
                  <span style={{ color: 'var(--hd-text-muted)', fontSize: 12 }}>to</span>
                  <input
                    type="number"
                    min={0}
                    step={0.25}
                    value={laborMobileMax}
                    onChange={e => setLaborMobileMax(e.target.value)}
                    style={{ ...dInp, textAlign: 'center', maxWidth: 110 }}
                  />
                </>
              )}
              <span className="text-xs" style={{ color: 'var(--hd-text-muted)' }}>
                hrs
                {bookRefText && <span className="ml-2" style={{ color: 'var(--hd-text-faint)' }}>{bookRefText}</span>}
              </span>
            </div>
            {laborPrefill && !rangeOn && laborMobileMin === laborPrefill.value && (
              <p className="text-xs mt-1" data-testid="labor-hours-prefill" style={{ color: 'var(--hd-warn)' }}>
                {`PRE-FILLED, NOT ON THE ${docName.toUpperCase()} YET: ${laborPrefill.value} hr, the ${laborPrefill.from}. Change it if this job differs - Add puts it on the ${docName}.`}
              </p>
            )}
            {pickedShopOnly && (
              <div className="flex flex-wrap items-center gap-2 mt-1 px-3 py-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--hd-warn) 14%, var(--hd-card))', border: '1px solid #6b5417' }}>
                <p className="text-xs flex-1 min-w-[200px]" style={{ color: 'var(--hd-warn)' }}>
                  {pickedShopText
                    ? `This card has no field time. Shop time is ${pickedShopText}; field work usually takes longer. Enter the billed hours.`
                    : 'This card has no field time and no shop time. Enter the billed hours.'}
                </p>
                {pickedShopText && (
                  <button type="button" onClick={billShopTime}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                    style={{ color: 'var(--hd-warn)', border: '1px solid #6b5417', background: 'transparent', cursor: 'pointer' }}>
                    {`Bill shop time (${pickedShopText})`}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Refrigeration: explicit service (separate line) vs the quote's recovery add-on */}
          {laborRefrig ? (
            <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--hd-info) 14%, var(--hd-card))', border: `1px solid ${D_BORDER}` }}>
              <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="#93C5FD" strokeWidth={2} viewBox="0 0 24 24">
                <line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1"/>
              </svg>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--hd-info)' }}>
                  Separate refrigeration service line will be added
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--hd-text-muted)' }}>
                  Refrigeration Service{laborRefrig.service ? ` ${laborRefrig.service}` : ''} — {laborRefrig.hours} hrs, billed as its own line (not added to base hours)
                </p>
              </div>
            </div>
          ) : allowRange ? (
            <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer" style={{ background: 'color-mix(in srgb, var(--hd-info) 14%, var(--hd-card))', border: `1px solid ${D_BORDER}` }}>
              <input
                type="checkbox"
                checked={laborRecharge}
                onChange={e => {
                  setLaborRecharge(e.target.checked)
                  // The add-on is 1.5 TO 2.5 hrs, so the billable figure becomes a range.
                  if (e.target.checked) setLaborRange(true)
                }}
                className="mt-0.5 w-4 h-4"
                style={{ accentColor: BLUE }}
              />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--hd-info)' }}>Add refrigeration recovery &amp; recharge</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--hd-text-muted)' }}>Adds 1.5 to 2.5 hrs to mobile field time</p>
              </div>
            </label>
          ) : null}

          {/* Filter drier reminder */}
          {(rechargeOn || laborRefrig) && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'color-mix(in srgb, var(--hd-warn) 14%, var(--hd-card))', border: '1px solid #6b5417' }}>
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="#F59E0B" strokeWidth={2} viewBox="0 0 24 24">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <p className="text-xs font-semibold" style={{ color: 'var(--hd-warn)' }}>Remember to add filter drier to the parts list.</p>
            </div>
          )}

          {/* Save to library - not offered for a card picked from it, unchanged: that
              line is the card, and saving it again would make a copy. */}
          {pickedUnchanged && laborPicked ? (
            <p className="text-sm" style={{ color: 'rgba(var(--hd-ink-rgb), 0.85)' }} data-testid="labor-line-from-card">
              {laborPicked.is_master
                ? `From the NWI labor catalog, ${laborPicked.labor_code ?? 'no code'}`
                : `From your library, ${laborPicked.labor_code ?? 'no code'}`}
            </p>
          ) : (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={saveToLibrary}
                onChange={e => setSaveToLibrary(e.target.checked)}
                className="w-4 h-4 rounded"
                style={{ accentColor: ORANGE }}
              />
              <span className="text-sm" style={{ color: 'rgba(var(--hd-ink-rgb), 0.85)' }}>Save to my labor library as a new card</span>
            </label>
          )}

          {/* THE ARITHMETIC, NOT A BARE TOTAL: hours x rate = amount, at the real cent. */}
          <div className="p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--hd-info) 14%, var(--hd-card))', border: `1px solid ${D_BORDER}` }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--paper-accent)' }}>
              {laborMath()}
            </p>
            {rechargeOn && (
              <p className="text-xs mt-1" style={{ color: 'var(--hd-text-muted)' }}>
                includes the refrigeration recovery &amp; recharge add-on
                ({baseMobileMin} hrs + 1.5 to 2.5)
              </p>
            )}
            {bookRefText && (
              <p className="text-xs mt-1" style={{ color: 'var(--hd-text-faint)' }}>
                {bookRefText} — reference only, nothing bills from it
              </p>
            )}
            {laborRefrig && (
              <p className="text-xs mt-1" style={{ color: 'var(--hd-info)' }}>
                + Refrigeration Service{laborRefrig.service ? ` ${laborRefrig.service}` : ''} — {laborRefrig.hours} hrs
                {rate != null && <>{' '}&times; {money(rate)}/hr = {money(laborRefrig.hours * rate)}</>} (separate line)
              </p>
            )}
          </div>
        </div>

        {/* Footer buttons */}
        <div className="flex gap-3 px-5 pb-5 pt-3 shrink-0" style={{ borderTop: `1px solid ${D_BORDER}` }}>
          <button
            type="button"
            onClick={close}
            className="flex-1 py-2.5 rounded-lg font-semibold text-sm"
            style={{ background: D_INPUT_BG, color: 'rgba(var(--hd-ink-rgb), 0.85)', border: `1px solid ${D_BORDER}` }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={addLaborItem}
            disabled={!laborDesc.trim() || adding}
            className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-on-accent disabled:opacity-40"
            style={{ background: ORANGE }}
          >
            Add Line
          </button>
        </div>
      </div>
    </div>
  )
}
