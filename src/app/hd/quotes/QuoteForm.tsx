'use client'

import { useState, useEffect } from 'react'
import { useExtrasSettingsState } from '@/lib/use-extras-settings'
import { ExtrasInputs } from '@/components/shared/ExtrasFields'
import {
  computeExtras, extrasColumns, extrasDisplayRows, extrasDelta, extrasAgree,
} from '@/lib/billable-extras'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { LABOR_GUIDE, type LaborGuideItem } from '@/lib/hd/labor-guide'
import {
  billedHighFromLibrary, billedHoursFromLibrary, shopReferenceText, trimmedNotice,
} from '@/lib/hd/labor-library'
import { hoursText, sameOperationName } from '@/lib/hd/labor-cards'
import FeeInput from '@/components/hd/FeeInput'
import { useTaxSettings } from '@/lib/use-tax-settings'
import { useHdFeeSettings } from '@/lib/hd/use-fee-settings'
import { computeTax, taxDisplayRows, mergeBreakdowns, parseBreakdown } from '@/lib/tax'
import { parseAddress } from '@/lib/hd/address-parse'
import { DEFAULT_HD_PARTS_MARKUP, sellPrice, lineAmount } from '@/lib/hd/parts-pricing'
import AddressAutofill from '@/components/hd/AddressAutofill'
import { money } from '@/lib/format'
import PaymentTermsSelect from '@/components/hd/PaymentTermsSelect'
import { documentExtras } from '@/lib/document-money'
import { discountPrintLabel, parseDiscount } from '@/lib/document-discount'
import { hdApplyDiscount } from '@/lib/hd/hd-discount'
import {
  DiscountEditor, draftFrom, discountFromDraft, type DiscountDraft,
} from '@/components/shared/DiscountEditor'

const ORANGE  = '#FF6600'
const BLUE    = '#2969B0'
const BG      = '#F4F5F7'
const CARD    = '#FFFFFF'
const BORDER  = '#E5E7EB'
const TEXT    = '#1A1A1A'
const MUTED   = '#6B7280'

// HD Suite dark theme — used by the labor modal
const D_BG       = 'var(--hd-sunken)'
const D_BORDER   = 'var(--hd-border)'
const D_INPUT_BG = 'var(--hd-inner)'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LineItem {
  id: string
  type: 'labor' | 'parts'
  description: string
  // labor — supports time ranges
  book_hours: number
  book_hours_max: number
  mobile_hours: number
  mobile_hours_max: number
  requires_refrigeration: boolean
  recharge_added: boolean
  // parts — unit_cost is the SELL price (cost + markup). The quote document and
  // the converted invoice both print it beside the amount, so the tech's own cost
  // never goes in this field; it is carried alongside for their records.
  part_number: string
  quantity: number
  unit_cost: number
  unit_cost_base?: number
  markup_percent?: number
  // billing amount uses mobile_hours (lower); amount_max for display
  amount: number
  amount_max: number
}

interface PartsDraft {
  part_number: string
  description: string
  quantity: string
  unit_cost: string
  markup: string
}

interface PartResult {
  part_number: string
  description: string
  category: string
}

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

// ─────────────────────────────────────────────────────────────────────────────
// THE PICKER SEARCHES BOTH INTEL HUBS
// ─────────────────────────────────────────────────────────────────────────────
//
// There are two, and this form only ever asked one of them:
//
//   /intel      (LD nav)  customers + vehicles
//   /hd/intel   (HD nav)  hd_fleet_accounts + hd_units
//
// This picker is labelled "Link Intel Hub Customer" and called GET /api/customers,
// which is the LD table. A fleet account entered in HD's own Intel Hub - the Intel
// Hub an HD tech actually opens - could not be selected on an HD quote at all. The
// ones that did appear were there by accident: logHDCustomer writes a `customers`
// row every time an HD quote or invoice is SAVED, so customers born of HD paperwork
// turned up and anything entered deliberately did not.
//
// Both sources are searched now and each hit says which it came from.
type HitSource = 'customer' | 'fleet'

interface PickerHit {
  source: HitSource
  id: string
  /** What the tech reads: a person's name, or the fleet's name. */
  label: string
  /** Phone, email, address - whatever identifies it. */
  sublabel: string
  phone: string | null
  email: string | null
  /** The company, when the record has one. */
  company: string | null
  /** hd_fleet_accounts.address is ONE free-text line, not line1/city/state/zip. */
  addressLine: string | null
}

/** One unit on a fleet account, for the "which unit?" step. */
interface FleetUnitHit {
  id: string
  unit_number: string | null
  manufacturer: string | null
  model: string | null
  serial_number: string | null
  year: number | null
}

// One Gemini-suggested labor line
interface LaborSuggestion {
  description: string
  mobile_hours: number
  book_hours: number
  category: string
}

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

// Subtle inline-edit input for existing labor line rows (light row style)
const lineInp = {
  width: '100%',
  border: '1px solid transparent',
  borderBottom: `1px solid ${BORDER}`,
  borderRadius: 4,
  padding: '4px 6px',
  fontSize: 14,
  color: TEXT,
  background: 'transparent',
  outline: 'none',
} as React.CSSProperties

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtHrs(min: number, max: number, shopOnly = false): string {
  if (shopOnly) return 'Shop only'
  if (Math.abs(min - max) < 0.01) return `${min} hrs`
  return `${min} to ${max} hrs`
}

// fmtAmtRange was here. It rounded to whole dollars - `$${min.toFixed(0)}` turned
// 202.50 into "$203" - and the labor modal's preview was its only caller, so the one
// figure a tech checked before adding a line was the one figure that did not match
// the line. Replaced by laborMath(), which prints the arithmetic at the real cent.

// ─── Sub-components ──────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>{label}</label>
      {children}
    </div>
  )
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

const cardStyle = {
  background: CARD,
  borderRadius: 12,
  border: `1px solid ${BORDER}`,
  padding: 24,
  marginBottom: 20,
} as React.CSSProperties

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-condensed font-bold text-xl mb-4" style={{ color: TEXT, letterSpacing: '0.5px' }}>
      {children}
    </h2>
  )
}

// ─── Editing a saved quote ───────────────────────────────────────────────────
//
// ONE FORM FOR NEW AND EDIT. Kurt built five work orders from quotes, made mistakes,
// and had to delete and rebuild all five because nothing could be edited. A DRAFT or
// SENT quote now opens in this same form, seeded from its row; an APPROVED one stays
// locked (see /hd/quotes/[id]/edit), because the customer agreed to those numbers.
//
// THE QUOTE'S RECORDED TERMS SEED THE FORM, NOT CURRENT SETTINGS. The settings-seeding
// effects below are skipped when editing - they would overwrite a stored fee of 0 or a
// stored tax rate of 0 - and the tax flags and extras rates come off the quote's own
// tax_breakdown and extras columns, the same rule EditInvoiceForm follows.

/** The blank form, overlaid with whatever the saved quote recorded for each field. */
function withQuote<T extends Record<string, unknown>>(q: Record<string, unknown> | null, blank: T): T {
  if (!q) return blank
  const out: Record<string, unknown> = { ...blank }
  for (const k of Object.keys(blank)) {
    const v = q[k]
    if (v == null) continue
    const b = blank[k]
    out[k] = typeof b === 'number'
      ? (Number.isFinite(Number(v)) ? Number(v) : b)
      : typeof b === 'boolean' ? Boolean(v) : String(v)
  }
  // A stored fee is an included fee; a zero one was not charged.
  out.include_diagnostic = Number(q.diagnostic_fee ?? 0) > 0
  out.include_road_call  = Number(q.road_call_fee ?? 0) > 0
  // hd_quotes.tax_rate is the PARTS rate (it is form.tax_rate on save); the labor rate
  // lives only in the stored breakdown. A legacy quote has none - one rate for both.
  const tb = parseBreakdown(q.tax_breakdown)
  out.tax_rate_labor = tb?.labor?.rate ?? Number(q.tax_rate ?? 0)
  return out as T
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function QuoteForm({ initial = null }: { initial?: Record<string, unknown> | null }) {
  const router = useRouter()
  const editing = initial != null
  const quoteId = editing ? String(initial.id) : null
  const editingStatus = editing ? String(initial.status ?? 'draft') : null
  // What THIS quote taxed, off its own breakdown. NULL for a new quote or a legacy one,
  // which then follows the shop's settings exactly as before.
  const storedTax = editing ? parseBreakdown(initial.tax_breakdown) : null

  const [saving, setSaving]               = useState(false)
  // HD gets the same three extras as LD, same tax treatment, same cap. Hours and
  // miles are the only inputs; the percentage is never a question.
  const { settings: currentExtras, loaded: currentExtrasLoaded } = useExtrasSettingsState()
  // A SAVED quote bills exactly the extras it recorded, at the rates it recorded - the
  // same reader LD's editors use. A supplies percentage (or a travel or mileage rate)
  // it never recorded stays off on edit; it does not pick up today's setting. A new
  // quote uses the shop's settings.
  const docExtras      = editing ? documentExtras(initial) : null
  const extrasSettings = docExtras ? docExtras.settings : currentExtras
  const extrasLoaded   = docExtras ? true : currentExtrasLoaded
  // The discount this quote recorded (migration 168). Its amounts are re-derived from
  // the lines on every render, exactly like the tax.
  const [discountDraft, setDiscountDraft] = useState<DiscountDraft>(() =>
    draftFrom(editing ? parseDiscount(initial.discount) : null))
  const [travelHours,  setTravelHours]  = useState(editing ? Number(initial.travel_hours ?? 0) || 0 : 0)
  const [mileageMiles, setMileageMiles] = useState(editing ? Number(initial.mileage_miles ?? 0) || 0 : 0)
  const [toast, setToast]                 = useState('')
  const [customerToast, setCustomerToast] = useState(false)
  const [laborModal, setLaborModal]       = useState(false)
  const [partsModal, setPartsModal]       = useState(false)
  const [lineItems, setLineItems]         = useState<LineItem[]>(() =>
    editing && Array.isArray(initial.line_items) ? initial.line_items as LineItem[] : [])
  const [qwAvailable, setQwAvailable]     = useState(false)
  const [qwPulledNote, setQwPulledNote]   = useState('')
  const [partsResults, setPartsResults]   = useState<PartResult[]>([])
  const [partsSearching, setPartsSearching] = useState(false)

  // ===========================================================================
  // LABOR MODAL STATE — ONE BILLABLE NUMBER
  // ===========================================================================
  //
  // This asked for FOUR numbers - book min, book max, mobile min, mobile max - to
  // answer one question, and a tech on a straightforward job typed the same value
  // twice in two of them. Only the mobile hours ever billed; book time never entered
  // the arithmetic. Then the preview printed "Mobile: 1.5 hrs", "Book: 1 hrs flat
  // rate" and "$203" with nothing saying which number produced the $203.
  //
  // Now: ONE field, with book time as reference text beside it.
  //
  // laborMobileMin is the billable number. While laborRange is false the single input
  // writes BOTH min and max, so every figure downstream and every column stored is
  // identical to what this form produced before - nothing about how labor is stored
  // has changed.
  //
  // BOOK HOURS ARE REFERENCE ONLY and have no input at all now. They are set from the
  // library or guide item that was picked and are still written to book_hours /
  // book_hours_max exactly as before. The default is EMPTY, not '1.0': a hand-typed
  // job has no book time, and inventing 1.0 for it was how the old form made the tech
  // wonder whether he had billed for both numbers. The line items grid still lets him
  // type a book figure if he wants one.
  const [laborDesc, setLaborDesc]           = useState('')
  const [laborBookMin, setLaborBookMin]     = useState('')
  const [laborBookMax, setLaborBookMax]     = useState('')
  const [laborMobileMin, setLaborMobileMin] = useState('1.5')
  const [laborMobileMax, setLaborMobileMax] = useState('1.5')
  // False = one number. The range exists for the refrigeration recovery add-on, which
  // genuinely adds 1.5 to 2.5 hrs, so ticking that switches this on by itself.
  const [laborRange, setLaborRange]         = useState(false)
  const [laborRecharge, setLaborRecharge]   = useState(false)
  // Off by default (Oct 24). Ticked by default, every line added from the modal became
  // a library card whether the tech wanted one or not.
  const [saveToLibrary, setSaveToLibrary]   = useState(false)
  // The library picker searches on the server (GET /api/hd/repair-items?q=), never a
  // capped list held here. total says how many matched in all, so a trimmed list says so.
  const [laborSearch, setLaborSearch]       = useState<LaborSearch>(NO_LABOR_SEARCH)
  // The library card this line was picked from, if any. While the name is unchanged
  // the line IS that card: it is counted by id when added and never re-saved.
  const [laborPicked, setLaborPicked]       = useState<LibraryItem | null>(null)
  const [laborSelectedKey, setLaborSelectedKey] = useState('')
  // Set only when a library item carries explicit refrigeration_hours — its
  // recovery time becomes a SEPARATE labor line (matches buildRepairLines()).
  const [laborRefrig, setLaborRefrig] = useState<{ hours: number; service: string | null } | null>(null)

  const [parts, setParts] = useState<PartsDraft>({ part_number: '', description: '', quantity: '1', unit_cost: '0.00', markup: String(DEFAULT_HD_PARTS_MARKUP) })
  const [partsMarkupDefault, setPartsMarkupDefault] = useState(DEFAULT_HD_PARTS_MARKUP)

  const [form, setForm] = useState(() => withQuote(initial, {
    company_name: '',
    customer_name: '', customer_phone: '', customer_email: '',
    customer_id: '',
    // The HD Intel Hub records this quote is for. Both stay '' for a customers-table
    // pick or a typed-in customer: there is no fleet account or hd_units row then.
    fleet_account_id: '', unit_id: '',
    // Billing + optional corporate/service address (auto-filled from Intel Hub).
    address_line1: '', address_line2: '', city: '', state: '', zip: '',
    corp_address_line1: '', corp_address_line2: '', corp_city: '', corp_state: '', corp_zip: '',
    has_corp_address: false,
    payment_terms: 'net30',
    unit_number: '', unit_manufacturer: '', unit_model: '', unit_serial: '', unit_year: '',
    truck_make: '', truck_model: '', truck_year: '', vin: '',
    complaint: '', diagnosis: '',
    // include_diagnostic STARTS OFF, and diagnostic_fee starts at 0.
    //
    // It used to default ON at $125 - a fee nobody configured, switched on before the
    // tech touched anything, on every quote. A charge the shop never agreed to should
    // not be the default. It turns on by itself only once hd_diagnostic_fee is set in
    // HD Settings, at that value: see the seeding effect below.
    labor_rate: 125, diagnostic_fee: 0, include_diagnostic: false,
    road_call_fee: 0, include_road_call: false,
    tax_rate: 0, tax_rate_labor: 0, notes: '', valid_until: '',
    // The customer's own PO, when they give one. Travels to the work order and the
    // invoice; see the field in Notes & Validity.
    customer_po_number: '',
    // Who is doing the work. Optional; carried to the work order and the invoice.
    tech_name: '',
  }))

  // ===========================================================================
  // THE SHOP'S OWN LABOR RATE AND FEES (migration 156)
  // ===========================================================================
  //
  // This form opened at labor_rate 125, diagnostic_fee 125, road_call_fee 0 for every
  // shop, and include_diagnostic defaults ON - so $125 of someone else's diagnostic
  // fee was on the quote before the tech touched anything. There was nowhere to put
  // the right figure: profiles had hd_labor_rate but no fee columns at all.
  //
  // Each field is only seeded while it still holds the fallback it started on, so a
  // number typed while the fetch was in flight survives. NULL from settings means the
  // shop never set that fee, and nothing is filled in for it - NOT read as zero,
  // because a shop that charges nothing to diagnose and a shop that never answered are
  // different, and neither wants $125 put on the quote by default.
  //
  // A CONFIGURED DIAGNOSTIC FEE ALSO TICKS THE BOX. That is the whole difference
  // between the two states: a shop that has said "I charge $150 to diagnose" means it
  // on every job and should not re-tick it each time, while a shop that has said
  // nothing gets no charge it never agreed to. The road call fee does NOT auto-tick -
  // whether a job was a road call is a fact about that job, not a standing policy.
  const feeSettings = useHdFeeSettings()
  useEffect(() => {
    // Never over a saved quote: its fees are what it recorded, including a 0.
    if (editing || !feeSettings.loaded) return
    setForm(f => {
      const next = { ...f }
      if (feeSettings.laborRate != null && f.labor_rate === 125) next.labor_rate = feeSettings.laborRate
      if (feeSettings.diagnosticFee != null && f.diagnostic_fee === 0) {
        next.diagnostic_fee = feeSettings.diagnosticFee
        next.include_diagnostic = true
      }
      if (feeSettings.roadCallFee != null && f.road_call_fee === 0) next.road_call_fee = feeSettings.roadCallFee
      return next
    })
  }, [feeSettings])

  // Seed the tax rate from the tech's saved default. A converted quote carries its
  // tax_rate onto the invoice, so this is what keeps quote-sourced invoices taxed.
  const taxSettings = useTaxSettings()
  useEffect(() => {
    // Never over a saved quote: a stored tax rate of 0 is a rate, not a blank.
    if (editing || taxSettings == null) return
    // Prefill BOTH rates, and only while the tech has not typed one.
    setForm(f => (f.tax_rate === 0
      ? { ...f, tax_rate: taxSettings.tax_rate_parts, tax_rate_labor: taxSettings.tax_rate_labor }
      : f))
  }, [taxSettings])

  // Seed the parts markup from the subscriber's saved HD default (migration 121).
  // Deliberately hd_parts_markup_percent and not default_parts_markup_percent: the
  // latter is the LD default, LD bills from it, and reading it here handed 20% to
  // every subscriber who had ever opened LD Settings even though HD's number is 30.
  // A quote converts straight into an invoice, so both forms must seed identically
  // or the same job reprices itself on conversion.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user/profile')
        if (!res.ok) return
        const json = await res.json()
        const n = Number(json.hd_parts_markup_percent)
        if (cancelled || !Number.isFinite(n)) return
        setPartsMarkupDefault(n)
        // Only reseed a draft still showing the fallback, so a markup typed while
        // the fetch was in flight is not overwritten.
        setParts(d => (d.markup === String(DEFAULT_HD_PARTS_MARKUP) ? { ...d, markup: String(n) } : d))
      } catch {
        // Leave DEFAULT_HD_PARTS_MARKUP in place rather than blocking the tech.
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ── Intel Hub customer picker ──
  const [customerSearch, setCustomerSearch]       = useState('')
  const [customerResults, setCustomerResults]     = useState<PickerHit[]>([])
  const [showCustomerResults, setShowCustomerResults] = useState(false)
  // Units on a linked fleet account, when there is more than one to choose from.
  const [fleetUnits, setFleetUnits]               = useState<FleetUnitHit[]>([])
  // What the link did, said out loud: which account, and whether it filled the unit.
  const [fleetNote, setFleetNote]                 = useState('')
  // Which picker source did not answer on the last search, or ''.
  const [pickerFailure, setPickerFailure]         = useState('')

  // ── Gemini labor suggestions ──
  const [suggestLoading, setSuggestLoading]   = useState(false)
  const [suggestions, setSuggestions]         = useState<LaborSuggestion[]>([])
  const [suggestNote, setSuggestNote]         = useState('')

  useEffect(() => {
    try {
      const raw = localStorage.getItem('hd_last_quickwrench_result')
      if (raw) {
        const stored = JSON.parse(raw) as { timestamp: string }
        const age = Date.now() - new Date(stored.timestamp).getTime()
        setQwAvailable(age < 24 * 60 * 60 * 1000)
      }
    } catch {}
  }, [])

  useEffect(() => {
    // A QuickWrench handoff is for a NEW quote; it must not land on a saved one.
    if (editing) return
    try {
      const raw = localStorage.getItem('hd_guided_diagnostic_prefill')
      if (!raw) return
      localStorage.removeItem('hd_guided_diagnostic_prefill')
      const prefill = JSON.parse(raw) as {
        complaint?: string
        diagnosis?: string
        notes?: string
        labor_rate?: number
        unit_manufacturer?: string; unit_model?: string; unit_serial?: string; unit_year?: string
        truck_make?: string; truck_model?: string; truck_year?: string; vin?: string
        lineItems?: Array<{
          description: string
          book_hours: number; book_hours_max: number
          mobile_hours: number; mobile_hours_max: number
        }>
      }
      // QuickWrench sends the tech's configured rate; fall back to the form default.
      const rate = Number.isFinite(prefill.labor_rate) && (prefill.labor_rate as number) > 0
        ? prefill.labor_rate as number
        : 125
      setForm(f => ({
        ...f,
        ...(prefill.complaint ? { complaint:  prefill.complaint  } : {}),
        ...(prefill.diagnosis ? { diagnosis:  prefill.diagnosis  } : {}),
        ...(prefill.notes     ? { notes:      prefill.notes      } : {}),
        ...(prefill.unit_manufacturer ? { unit_manufacturer: prefill.unit_manufacturer } : {}),
        ...(prefill.unit_model  ? { unit_model:  prefill.unit_model  } : {}),
        ...(prefill.unit_serial ? { unit_serial: prefill.unit_serial } : {}),
        ...(prefill.unit_year   ? { unit_year:   prefill.unit_year   } : {}),
        ...(prefill.truck_make  ? { truck_make:  prefill.truck_make  } : {}),
        ...(prefill.truck_model ? { truck_model: prefill.truck_model } : {}),
        ...(prefill.truck_year  ? { truck_year:  prefill.truck_year  } : {}),
        ...(prefill.vin         ? { vin:         prefill.vin         } : {}),
        labor_rate: rate,
      }))
      if (prefill.lineItems?.length) {
        setLineItems(prefill.lineItems.map(li => ({
          id:                     crypto.randomUUID(),
          type:                   'labor' as const,
          description:            li.description,
          book_hours:             li.book_hours,
          book_hours_max:         li.book_hours_max,
          mobile_hours:           li.mobile_hours,
          mobile_hours_max:       li.mobile_hours_max,
          requires_refrigeration: false,
          recharge_added:         false,
          part_number: '', quantity: 0, unit_cost: 0,
          amount:     parseFloat((li.mobile_hours     * rate).toFixed(2)),
          amount_max: parseFloat((li.mobile_hours_max * rate).toFixed(2)),
        })))
      }
    } catch {}
  }, [])


  function pullFromQW() {
    try {
      const raw = localStorage.getItem('hd_last_quickwrench_result')
      if (!raw) {
        setToast('No recent QuickWrench results — run a diagnosis first.')
        return
      }
      const stored = JSON.parse(raw) as { analysis: string; timestamp: string; model?: string }
      const age = Date.now() - new Date(stored.timestamp).getTime()
      if (age >= 24 * 60 * 60 * 1000) {
        setToast('No recent QuickWrench results — run a diagnosis first.')
        setQwAvailable(false)
        return
      }
      setForm(f => ({ ...f, diagnosis: stored.analysis }))
      const ts = new Date(stored.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      setQwPulledNote(`Pulled from QuickWrench — ${stored.model ?? ''} at ${ts}`)
    } catch {
      setToast('No recent QuickWrench results — run a diagnosis first.')
    }
  }

  function setField(k: string, v: string | number | boolean) {
    setForm(f => ({ ...f, [k]: v }))
  }

  // ── Intel Hub picker: BOTH sources, in parallel ───────────────────────────
  useEffect(() => {
    const q = customerSearch.trim()
    if (q.length < 2) { setCustomerResults([]); return }
    const t = setTimeout(async () => {
      const term = encodeURIComponent(q)
      // Promise.allSettled, not all: HD's fleet endpoint is tier-gated and answers
      // 403 on a Starter plan. One source being unavailable must not blank the other.
      const [custRes, fleetRes] = await Promise.allSettled([
        fetch(`/api/customers?search=${term}&limit=8`),
        fetch(`/api/hd/fleet-accounts?search=${term}&limit=8`),
      ])

      const hits: PickerHit[] = []
      // A source that failed is NAMED, never dropped. A silent half-result reads as
      // "that fleet does not exist" when it means "fleet accounts did not answer".
      const failed: string[] = []
      if (!(custRes.status === 'fulfilled' && custRes.value.ok)) {
        failed.push(`customers (${custRes.status === 'fulfilled' ? custRes.value.status : 'network error'})`)
      }
      if (!(fleetRes.status === 'fulfilled' && fleetRes.value.ok)) {
        const code = fleetRes.status === 'fulfilled' ? fleetRes.value.status : 0
        failed.push(code === 403
          ? 'fleet accounts (not included in this plan)'
          : `fleet accounts (${code || 'network error'})`)
      }

      if (custRes.status === 'fulfilled' && custRes.value.ok) {
        try {
          const data = await custRes.value.json() as {
            customers?: Array<Record<string, unknown>>
          }
          for (const c of data.customers ?? []) {
            const person = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()
            const company = (c.company_name as string | null) ?? null
            hits.push({
              source:  'customer',
              id:      String(c.id),
              // The company leads when there is one: a fleet is known by the name on
              // the truck, not by whoever happened to answer the phone.
              label:   company || person || '(no name)',
              sublabel: [company && person ? person : null, c.phone, c.email]
                .filter(Boolean).join(' - '),
              phone:   (c.phone as string | null) ?? null,
              email:   (c.email as string | null) ?? null,
              company,
              addressLine: null,
            })
          }
        } catch { /* a malformed page from one source is not a reason to show none */ }
      }

      if (fleetRes.status === 'fulfilled' && fleetRes.value.ok) {
        try {
          const data = await fleetRes.value.json() as {
            fleet_accounts?: Array<Record<string, unknown>>
          }
          for (const a of data.fleet_accounts ?? []) {
            hits.push({
              source:  'fleet',
              id:      String(a.id),
              label:   String(a.fleet_name ?? '(unnamed fleet)'),
              sublabel: [a.contact_name, a.contact_phone, a.address]
                .filter(Boolean).join(' - '),
              phone:   (a.contact_phone as string | null) ?? null,
              email:   (a.contact_email as string | null) ?? null,
              company: String(a.fleet_name ?? '') || null,
              addressLine: (a.address as string | null) ?? null,
            })
          }
        } catch { /* ditto */ }
      }

      // Fleet accounts FIRST. Saving an HD quote writes a customers row with the same
      // name, so a fleet soon has a Customer twin listed above it - and picking the
      // twin fills the name and loses the units, which looked like a regression.
      setCustomerResults([...hits.filter(h => h.source === 'fleet'), ...hits.filter(h => h.source !== 'fleet')])
      setPickerFailure(failed.length ? `Could not search ${failed.join(' or ')}.` : '')
      setShowCustomerResults(true)
    }, 300)
    return () => clearTimeout(t)
  }, [customerSearch])

  async function pickCustomer(hit: PickerHit) {
    // Immediately fill from the search hit so name/phone/email populate even before the
    // full-record fetch resolves (and even if it fails).
    setShowCustomerResults(false)
    setCustomerResults([])
    setCustomerSearch(hit.label)

    // ── A FLEET ACCOUNT from HD's Intel Hub ─────────────────────────────────
    //
    // customer_id is deliberately NOT set: it is a `customers` foreign key and a
    // fleet account id is not one. Writing it would hand the quote route an id that
    // does not resolve, and logHDCustomer will create or match the real customers
    // row on save anyway.
    if (hit.source === 'fleet') {
      const parsed = hit.addressLine ? parseAddress(hit.addressLine) : null
      setForm(f => ({
        ...f,
        customer_id:    '',
        // The link itself. It was thrown away here: the fields filled and the work
        // order showed Fleet as a dash.
        fleet_account_id: hit.id,
        unit_id:          '',
        customer_name:  hit.label,
        company_name:   hit.company ?? hit.label,
        customer_phone: hit.phone ?? '',
        customer_email: hit.email ?? '',
        // hd_fleet_accounts stores the address as one line. parseAddress is the same
        // conservative splitter the address field above uses - it leaves a city blank
        // rather than guess, and every field stays editable underneath.
        address_line1:  parsed?.address_line1 ?? '',
        address_line2:  parsed?.address_line2 ?? '',
        city:           parsed?.city ?? '',
        state:          parsed?.state ?? '',
        zip:            parsed?.zip ?? '',
      }))
      setFleetNote(hit.addressLine && !parsed?.city
        ? `Linked ${hit.label}. The address on file is one line - check the city and state.`
        : `Linked ${hit.label} from HD Intel Hub.`)
      await loadFleetUnits(hit.id)
      return
    }

    setForm(f => ({
      ...f,
      customer_id:    hit.id,
      // A customers row is not a fleet account; a link left over from an earlier
      // pick would carry the wrong fleet onto the work order.
      fleet_account_id: '',
      unit_id:          '',
      customer_name:  hit.label,
      customer_phone: hit.phone ?? '',
      customer_email: hit.email ?? '',
    }))

    // Then fetch the full record to fill address + payment terms.
    try {
      const res  = await fetch(`/api/customers/${hit.id}`)
      if (!res.ok) return
      const data = await res.json()
      const c = data.customer
      if (!c) return
      const person = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()
      // The company leads, same as in the dropdown, so what the tech picked and what
      // lands in the field are the same words.
      const fullName = (c.company_name as string | null) || person || hit.label
      setForm(f => ({
        ...f,
        customer_id:    c.id ?? hit.id,
        customer_name:  fullName || f.customer_name,
        ...(c.company_name ? { company_name: String(c.company_name) } : {}),
        customer_phone: c.phone ?? hit.phone ?? '',
        customer_email: c.email ?? hit.email ?? '',
        address_line1:  c.address_line1 ?? '',
        address_line2:  c.address_line2 ?? '',
        city:           c.city ?? '',
        state:          c.state ?? '',
        zip:            c.zip ?? '',
        has_corp_address:   !!c.has_corp_address,
        corp_address_line1: c.corp_address_line1 ?? '',
        corp_address_line2: c.corp_address_line2 ?? '',
        corp_city:          c.corp_city ?? '',
        corp_state:         c.corp_state ?? '',
        corp_zip:           c.corp_zip ?? '',
        payment_terms:      c.payment_terms ?? 'net30',
      }))
    } catch {
      // Search-hit fields are already applied above; nothing more to do.
    }
  }

  /**
   * The units on a fleet account, loaded when one is linked.
   *
   * ONE unit fills the machine straight away - that is the whole point of linking a
   * customer who has one. SEVERAL are offered as a choice rather than guessed,
   * because picking the wrong reefer puts the wrong serial on a quote the customer
   * approves. NONE leaves the fields alone and says so.
   */
  async function loadFleetUnits(fleetAccountId: string) {
    setFleetUnits([])
    try {
      const res = await fetch(`/api/hd/fleet-units?fleet_account_id=${encodeURIComponent(fleetAccountId)}&limit=50`)
      if (!res.ok) return
      const data = await res.json() as { units?: FleetUnitHit[] }
      const units = data.units ?? []
      if (units.length === 1) {
        applyFleetUnit(units[0])
        setFleetNote(`Linked, and filled the unit from HD Intel Hub.`)
        return
      }
      if (units.length > 1) {
        setFleetUnits(units)
        setFleetNote(`${units.length} units on this account - pick the one this quote is for.`)
      }
      // Zero units: whatever the link already said stands. The unit fields are
      // required below, so an unlinked machine cannot slip through silently.
    } catch { /* the link itself already succeeded; the units are a bonus */ }
  }

  function applyFleetUnit(u: FleetUnitHit) {
    setForm(f => ({
      ...f,
      unit_id:           u.id,
      unit_number:       u.unit_number ?? f.unit_number,
      unit_manufacturer: u.manufacturer ?? f.unit_manufacturer,
      unit_model:        u.model ?? f.unit_model,
      unit_serial:       u.serial_number ?? f.unit_serial,
      unit_year:         u.year != null ? String(u.year) : f.unit_year,
    }))
    setFleetUnits([])
  }

  function clearCustomerLink() {
    setCustomerSearch('')
    setCustomerResults([])
    setFleetUnits([])
    setFleetNote('')
    setForm(f => ({
      ...f,
      customer_id: '', fleet_account_id: '', unit_id: '', address_line1: '', address_line2: '', city: '', state: '', zip: '',
      has_corp_address: false, corp_address_line1: '', corp_address_line2: '', corp_city: '', corp_state: '', corp_zip: '',
    }))
  }

  const billingAddr = [form.address_line1, form.address_line2, [form.city, form.state].filter(Boolean).join(', '), form.zip].filter(Boolean).join(', ')
  const serviceAddr = [form.corp_address_line1, form.corp_address_line2, [form.corp_city, form.corp_state].filter(Boolean).join(', '), form.corp_zip].filter(Boolean).join(', ')

  // ── Gemini labor suggestions ───────────────────────────────────────────────
  const isTruckUnit = !!(form.truck_make.trim() || form.truck_model.trim() || form.truck_year.trim() || (form.vin.trim() && !form.unit_manufacturer.trim()))

  async function getLaborSuggestions() {
    if (!form.complaint.trim() && !form.diagnosis.trim()) { setToast('Enter a complaint or diagnosis first.'); return }
    setSuggestLoading(true); setSuggestNote(''); setSuggestions([])
    try {
      const res = await fetch('/api/hd/labor-suggestions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          complaint: form.complaint, diagnosis: form.diagnosis, vin: form.vin,
          unit_manufacturer: form.unit_manufacturer, unit_model: form.unit_model, unit_year: form.unit_year,
          truck_make: form.truck_make, truck_model: form.truck_model, truck_year: form.truck_year,
          is_truck: isTruckUnit,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setToast(data.error ?? 'Suggestions failed'); return }
      const list = (data.suggestions ?? []) as LaborSuggestion[]
      setSuggestions(list)
      setSuggestNote(list.length ? `${list.length} suggestion${list.length === 1 ? '' : 's'} from AI — tap to add` : 'No suggestions returned. Try adding more detail.')
    } catch {
      setToast('Suggestions failed — check your connection.')
    } finally {
      setSuggestLoading(false)
    }
  }

  function addSuggestion(s: LaborSuggestion) {
    const mobile = Math.max(0, s.mobile_hours || 0)
    const book   = Math.max(0, s.book_hours || mobile)
    setLineItems(l => [...l, {
      id: crypto.randomUUID(),
      type: 'labor',
      description: s.description,
      book_hours: book, book_hours_max: book,
      mobile_hours: mobile, mobile_hours_max: mobile,
      requires_refrigeration: false, recharge_added: false,
      part_number: '', quantity: 0, unit_cost: 0,
      amount:     parseFloat((mobile * form.labor_rate).toFixed(2)),
      amount_max: parseFloat((mobile * form.labor_rate).toFixed(2)),
    }])
    // Remove the card once added so the tech sees what's left.
    setSuggestions(prev => prev.filter(x => x !== s))
  }

  // Derived totals
  const subtotalLabor = lineItems.filter(i => i.type === 'labor').reduce((s, i) => s + i.amount, 0)
  const subtotalParts = lineItems.filter(i => i.type === 'parts').reduce((s, i) => s + i.amount, 0)
  const diagFee       = form.include_diagnostic ? form.diagnostic_fee : 0
  const roadFee       = form.include_road_call  ? form.road_call_fee  : 0
  const taxBase       = subtotalLabor + subtotalParts + diagFee + roadFee

  // Whether parts and labor are taxed: the saved quote's own record when editing, the
  // shop's settings for a new one.
  const taxedPartsFlag = storedTax?.parts ? storedTax.parts.taxed : (taxSettings?.tax_parts ?? true)
  const taxedLaborFlag = storedTax?.labor ? storedTax.labor.taxed : (taxSettings?.tax_labor ?? true)

  // THE DIAGNOSTIC FEE AND THE ROAD CALL FEE ARE LABOR. Leaving them on the parts
  // side would have moved the bug instead of fixing it: a shop in a state that
  // exempts labor would still have been taxing its own call-out.
  const tax = computeTax(
    { parts: subtotalParts, labor: subtotalLabor + diagFee + roadFee },
    {
      tax_parts:      taxedPartsFlag,
      tax_labor:      taxedLaborFlag,
      tax_rate_parts: form.tax_rate,
      tax_rate_labor: form.tax_rate_labor,
    },
  )
  const taxAmount     = tax.taxAmount
  const total         = taxBase + taxAmount

  // ── Billable extras ──────────────────────────────────────────────────────
  // Supplies is a percentage of the PARTS subtotal only - never labour, and never
  // the diagnostic or road-call fee, both of which are labour. Travel is taxed as
  // labour, mileage is not taxed, supplies is taxed as parts. extrasDelta does the
  // per-bucket rounding; nothing is re-derived from the document total.
  const extrasResult = computeExtras(
    subtotalParts,
    {
      travelHours,
      mileageMiles,
      // A saved quote's recorded extras rates win over current settings - and over
      // the "bills nothing" useExtrasSettings reports before its fetch resolves.
      ...(docExtras ? {
        travelRateOverride:          docExtras.input.travelRateOverride,
        mileageRateOverride:         docExtras.input.mileageRateOverride,
        shopSuppliesPercentOverride: docExtras.input.shopSuppliesPercentOverride,
        shopSuppliesCapOverride:     docExtras.input.shopSuppliesCapOverride,
      } : {}),
    },
    extrasSettings,
    Number(form.labor_rate ?? 0),
  )
  const extras = extrasDelta(extrasResult, {
    tax_parts:      taxedPartsFlag,
    tax_labor:      taxedLaborFlag,
    tax_rate_parts: form.tax_rate,
    tax_rate_labor: form.tax_rate_labor,
  })
  const subtotalWithExtras = parseFloat((taxBase + extras.subtotalDelta).toFixed(2))
  const taxWithExtras      = parseFloat((taxAmount + extras.taxDelta).toFixed(2))
  const totalWithExtras    = parseFloat((total + extras.totalDelta).toFixed(2))
  // An HD invoice must not display a charge outside its total either.
  const extrasMismatch = extrasAgree(extrasResult, subtotalWithExtras, taxBase)

  // ── Discount (migration 168) ─────────────────────────────────────────────
  // Off the labor and parts LINES only; travel, mileage, supplies and the fees ride in
  // the subtotal and are never discounted. The tax is the merged split above, reduced
  // per bucket on the discounted base - the shared engine, not a copy of it.
  const preDiscountBreakdown = mergeBreakdowns([tax.breakdown, extras.breakdown])
  const disc = hdApplyDiscount({
    discount:   discountFromDraft(discountDraft),
    laborLines: parseFloat(subtotalLabor.toFixed(2)),
    partsLines: parseFloat(subtotalParts.toFixed(2)),
    subtotal:   subtotalWithExtras,
    breakdown:  preDiscountBreakdown,
    taxAmount:  taxWithExtras,
    taxRatePct: form.tax_rate,
  })
  const discountApplied = disc.ok ? disc.discount : null
  const discountError   = disc.ok ? null : disc.error
  const taxFinal        = disc.ok ? disc.taxAmount : taxWithExtras
  const totalFinal      = disc.ok ? disc.grandTotal : totalWithExtras
  const breakdownFinal  = disc.ok ? disc.breakdown : preDiscountBreakdown


  function fmt(n: number) { return `${money(n)}` }

  // ── Labor modal helpers ──────────────────────────────────────────────────

  const libNum = (v: number | string | null): number | null =>
    v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v)

  const laborTerm = laborDesc.trim().toLowerCase()
  // Filter the labor library by unit type. Reefer is primary when both are present.
  // Items with no category are treated as universal so a tech's own saves never vanish.
  const activeCategories = form.unit_manufacturer.trim()
    ? ['refrigeration', 'electrical', 'mechanical', 'sensors']
    : (form.truck_make.trim() || form.truck_model.trim())
      ? ['engine', 'fuel', 'electrical', 'brakes', 'suspension', 'cooling']
      : null
  const categoriesKey = activeCategories ? activeCategories.join(',') : ''

  // The search runs on the server: description or labor code, the unit-type category
  // filter (rows with no category always pass, so a tech's own saves never vanish),
  // own rows first and most used at the top. A short pause after typing, and a newer
  // keystroke cancels an older request so results never arrive out of order.
  useEffect(() => {
    if (!laborModal) return
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
  }, [laborModal, laborDesc, categoriesKey])

  // Personal library first (own items then master), then LABOR_GUIDE fallbacks.
  const libMatches   = laborTerm ? laborSearch.items : []
  const libTrimmed   = laborTerm ? trimmedNotice(libMatches.length, laborSearch.total) : ''
  const guideAll     = laborTerm ? LABOR_GUIDE.filter(i => i.label.toLowerCase().includes(laborTerm)) : []
  const guideMatches = guideAll.slice(0, GUIDE_PICKER_LIMIT)
  const guideTrimmed = trimmedNotice(guideMatches.length, guideAll.length)
  const showLaborResults = laborTerm.length > 0 && (libMatches.length > 0 || guideMatches.length > 0)

  // While the name is the picked card's, the line is that card. Rename it and it is a
  // new operation the tech may save as a card of its own.
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
  function billShopTime() {
    if (pickedShopLo == null || pickedShopLo <= 0) return
    setLaborMobileMin(String(pickedShopLo))
    setLaborMobileMax(pickedShopHi || String(pickedShopLo))
    setLaborRange(!!pickedShopHi)
  }

  function selectLibraryItem(i: LibraryItem) {
    // No `?? 1.0` on the book hours any more. A library item that records no shop
    // hours has no book time, and saying so is the point - the reference slot stays
    // empty rather than showing a 1.0 nobody looked up. A 0 is empty too.
    const book   = libNum(i.shop_hours)
    const bookOk = book != null && book > 0
    const bookHi = billedHighFromLibrary(i.shop_hours, i.shop_hours_high)
    // BILLED HOURS COME FROM FIELD TIME ONLY - both ends when the card has a field
    // range. A card with only shop time leaves the field BLANK: the quote bills field
    // time, and filling a bay figure in underbills a job done in a lot. The modal says
    // so and offers "Bill shop time", which fills it only when pressed. addLaborItem
    // refuses a blank, so the tech has to decide.
    setLaborDesc(i.description)
    setLaborBookMin(bookOk ? String(book) : '')
    setLaborBookMax(bookOk ? (bookHi || String(book)) : '')
    const billed   = billedHoursFromLibrary(i.mobile_hours)
    const billedHi = billedHighFromLibrary(i.mobile_hours, i.mobile_hours_high)
    setLaborRange(!!billedHi)
    setLaborMobileMin(billed); setLaborMobileMax(billedHi || billed)
    setLaborPicked(i)
    const refrigHrs = libNum(i.refrigeration_hours)
    if (i.requires_refrigeration && refrigHrs && refrigHrs > 0) {
      // Explicit refrigeration service → its own separate line; base mobile stays as-is.
      setLaborRefrig({ hours: refrigHrs, service: i.refrigeration_service ?? null })
      setLaborRecharge(false)
    } else {
      // Library items store complete mobile_hours — never auto-add fixed recovery
      // (e.g. "Service Refrigeration A" is 2.6 hrs on its own, not 2.6 + 1.5). The
      // recovery checkbox stays available below for manual opt-in. The fixed-recovery
      // checkbox auto-fires only for old LABOR_GUIDE items (see selectGuideItem).
      setLaborRefrig(null)
      setLaborRecharge(false)
    }
    setLaborSelectedKey(`lib:${i.id}`)
  }

  function selectGuideItem(item: LaborGuideItem) {
    setLaborDesc(item.label)
    setLaborBookMin(String(item.book_min));     setLaborBookMax(String(item.book_max))
    setLaborMobileMin(String(item.mobile_min)); setLaborMobileMax(String(item.mobile_max))
    // A guide entry CAN be a genuine spread (1.5 to 2.5 on an R&R). Show the range
    // when it has one, and one field when it does not - the mode follows the data
    // rather than making the tech notice.
    setLaborRange(Math.abs(item.mobile_max - item.mobile_min) > 0.01)
    setLaborRefrig(null)
    setLaborRecharge(item.requires_refrigeration)
    setLaborSelectedKey(`guide:${item.label}`)
    setLaborPicked(null)
  }

  function closeLaborModal() {
    setLaborModal(false)
    setLaborDesc('')
    // Empty, not '1.0'. See the state block: book time is reference only now, and a
    // job nobody looked up has none.
    setLaborBookMin('');      setLaborBookMax('')
    setLaborMobileMin('1.5'); setLaborMobileMax('1.5')
    setLaborRange(false)
    setLaborRecharge(false)
    setLaborRefrig(null)
    setSaveToLibrary(false)
    setLaborSelectedKey('')
    setLaborPicked(null)
    setLaborSearch(NO_LABOR_SEARCH)
  }

  // Always a new card (the route never merges). book is NULL when the modal had no book
  // figure - it used to send 0, which reads as "no time at all" on the labor cards screen.
  async function saveLaborToLibrary(description: string, book: number | null, mobile: number, refrig: boolean) {
    try {
      await fetch('/api/hd/repair-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          shop_hours: book,
          mobile_hours: mobile,
          requires_refrigeration: refrig,
          source: 'manual',
        }),
      })
    } catch {}
  }

  // A picked card went onto the quote: count it, by id. Own cards only - the route
  // refuses a catalog row - and never the hours.
  function countLibraryUse(i: LibraryItem) {
    if (i.is_master) return
    fetch(`/api/hd/repair-items/${i.id}/used`, { method: 'POST' }).catch(() => {})
  }

  const rechargeAddMin  = laborRecharge ? 1.5 : 0
  const rechargeAddMax  = laborRecharge ? 2.5 : 0
  const baseMobileMin   = parseFloat(laborMobileMin) || 0
  // In single-number mode the max IS the min. Reading laborMobileMax here would use a
  // value the tech cannot see, which is exactly the confusion being removed.
  const baseMobileMax   = laborRange ? (parseFloat(laborMobileMax) || baseMobileMin) : baseMobileMin
  const totalMobileMin  = baseMobileMin + rechargeAddMin
  const totalMobileMax  = baseMobileMax + rechargeAddMax
  const previewAmtMin   = totalMobileMin * form.labor_rate
  const previewAmtMax   = totalMobileMax * form.labor_rate
  // True when the two ends differ enough to be worth printing as a spread.
  const laborIsSpread   = Math.abs(totalMobileMax - totalMobileMin) > 0.01

  // Book time as reference text, or '' when the job has none. Deliberately empty
  // rather than "book: 0" - a hand-typed job was never looked up in a book, and
  // printing a zero for it reads as a quoted figure.
  const bookRefMin = parseFloat(laborBookMin)
  const bookRefMax = parseFloat(laborBookMax)
  // A library card's figure is its SHOP time and says so; a guide entry's is book time.
  const bookRefText = laborPicked
    ? shopReferenceText(laborBookMin, laborBookMax)
    : Number.isFinite(bookRefMin) && bookRefMin > 0
      ? (Number.isFinite(bookRefMax) && Math.abs(bookRefMax - bookRefMin) > 0.01
          ? `book: ${bookRefMin} to ${bookRefMax} hr`
          : `book: ${bookRefMin} hr`)
      : ''

  /**
   * The arithmetic, spelled out: "1.5 hrs x $135.00/hr = $202.50".
   *
   * The preview used to print a bare "$203" from fmtAmtRange, which rounded to whole
   * dollars - so the figure on screen was not the figure on the line, and the tech had
   * to reverse-engineer which of the four hour fields produced it. money() throughout,
   * no rounding.
   */
  function laborMath(): string {
    const rate = money(form.labor_rate)
    if (laborIsSpread) {
      return `${totalMobileMin} to ${totalMobileMax} hrs x ${rate}/hr = ${money(previewAmtMin)} to ${money(previewAmtMax)}`
    }
    return `${totalMobileMin} hrs x ${rate}/hr = ${money(previewAmtMin)}`
  }

  function addLaborItem() {
    const description = laborDesc.trim()
    if (!description) { setToast('Enter a labor description.'); return }
    // An EMPTY hours field is refused, not read as 0. It is what a library pick with
    // no hours leaves behind, and adding it would be a $0.00 labor line. A typed 0 is
    // still allowed on the quote - a no-charge line is a real thing - but it is never
    // saved to the library (below).
    if (!laborMobileMin.trim()) { setToast('Enter the billable hours for this job.'); return }
    const bookMin = parseFloat(laborBookMin) || 0
    const bookMax = parseFloat(laborBookMax) || bookMin
    const newLines: LineItem[] = []

    // Base repair line. When an explicit refrigeration service applies (laborRefrig),
    // its recovery time is a SEPARATE line below — never folded into base mobile hrs.
    // (With laborRefrig set, laborRecharge is false so totalMobile == base mobile.)
    newLines.push({
      id: crypto.randomUUID(),
      type: 'labor',
      description,
      book_hours: bookMin,
      book_hours_max: bookMax,
      mobile_hours: parseFloat(totalMobileMin.toFixed(2)),
      mobile_hours_max: parseFloat(totalMobileMax.toFixed(2)),
      requires_refrigeration: laborRecharge || laborRefrig != null,
      recharge_added: laborRecharge,
      part_number: '', quantity: 0, unit_cost: 0,
      amount: parseFloat((totalMobileMin * form.labor_rate).toFixed(2)),
      amount_max: parseFloat((totalMobileMax * form.labor_rate).toFixed(2)),
    })

    // Separate refrigeration service line (matches quickwrench buildRepairLines()).
    if (laborRefrig) {
      const rh  = laborRefrig.hours
      const svc = laborRefrig.service ? ` ${laborRefrig.service}` : ''
      const amt = parseFloat((rh * form.labor_rate).toFixed(2))
      newLines.push({
        id: crypto.randomUUID(),
        type: 'labor',
        description: `Refrigeration Service${svc} — recover, evacuate & charge`.replace(/\s+/g, ' ').trim(),
        book_hours: rh, book_hours_max: rh,
        mobile_hours: rh, mobile_hours_max: rh,
        requires_refrigeration: true,
        recharge_added: true,
        part_number: '', quantity: 0, unit_cost: 0,
        amount: amt, amount_max: amt,
      })
    }

    setLineItems(l => [...l, ...newLines])
    // A line picked from the library, name unchanged, IS that card: count the use and
    // save nothing. Changing only its hours on this quote leaves the card alone.
    // Otherwise store the base labor (without the situational recovery add) as a NEW
    // card, only when ticked, and never with 0 billable hours: a card saved that way
    // pre-fills a $0.00 line every time it is picked. The route refuses it too.
    if (pickedUnchanged && laborPicked) {
      countLibraryUse(laborPicked)
    } else if (saveToLibrary && baseMobileMin > 0) {
      const book = laborBookMin.trim() ? (parseFloat(laborBookMin) || 0) : null
      saveLaborToLibrary(description, book, baseMobileMin, laborRecharge || laborRefrig != null)
    } else if (saveToLibrary) {
      setToast('Added to the quote. Not saved to your library - it has no billable hours.')
    }
    closeLaborModal()
  }

  // ── Inline editing of existing labor line items ──────────────────────────
  function updateLineDescription(id: string, value: string) {
    setLineItems(l => l.map(i => i.id === id ? { ...i, description: value } : i))
  }

  function updateLineHours(id: string, field: 'book' | 'mobile', raw: string) {
    const n = Math.max(0, parseFloat(raw) || 0)
    setLineItems(l => l.map(i => {
      if (i.id !== id) return i
      if (field === 'book') {
        return { ...i, book_hours: n, book_hours_max: n }
      }
      return {
        ...i,
        mobile_hours: n,
        mobile_hours_max: n,
        amount: parseFloat((n * form.labor_rate).toFixed(2)),
        amount_max: parseFloat((n * form.labor_rate).toFixed(2)),
      }
    }))
  }

  // ── Parts modal ──
  async function searchParts() {
    const q = parts.part_number.trim() || parts.description.trim()
    if (!q) return
    setPartsSearching(true)
    try {
      const res  = await fetch(`/api/hd/parts?search=${encodeURIComponent(q)}&manufacturer=${encodeURIComponent(form.unit_manufacturer)}`)
      const data = await res.json()
      setPartsResults((data.parts ?? []).slice(0, 6) as PartResult[])
    } finally {
      setPartsSearching(false)
    }
  }

  function selectPartResult(p: PartResult) {
    setParts(d => ({ ...d, part_number: p.part_number, description: p.description }))
    setPartsResults([])
  }

  function addPartsItem() {
    const qty    = parseFloat(parts.quantity)  || 1
    const cost   = parseFloat(parts.unit_cost) || 0
    const markup = parseFloat(parts.markup)    || 0
    if (!parts.description.trim()) { setToast('Enter a part description.'); return }
    const amount = lineAmount(qty, cost, markup)
    const item: LineItem = {
      id: crypto.randomUUID(),
      type: 'parts',
      description: parts.description.trim(),
      book_hours: 0, book_hours_max: 0,
      mobile_hours: 0, mobile_hours_max: 0,
      requires_refrigeration: false, recharge_added: false,
      part_number: parts.part_number.trim(),
      quantity: qty,
      unit_cost: sellPrice(cost, markup),
      unit_cost_base: cost,
      markup_percent: markup,
      // Parts carry no hours range, so min and max are the same figure.
      amount,
      amount_max: amount,
    }
    setLineItems(l => [...l, item])
    setParts({ part_number: '', description: '', quantity: '1', unit_cost: '0.00', markup: String(partsMarkupDefault) })
    setPartsResults([])
    setPartsModal(false)
  }

  function removeItem(id: string) {
    setLineItems(l => l.filter(i => i.id !== id))
  }

  // ── Save ──
  async function save(status: 'draft' | 'sent') {
    if (!form.customer_name.trim()) { setToast('Customer name is required.'); return }

    // ===========================================================================
    // THE MACHINE HAS TO BE IDENTIFIED.
    // ===========================================================================
    //
    // Manufacturer and model were both optional, so a reefer quote could be saved,
    // sent, approved and converted without ever saying what the job was on. That
    // work order reaches a tech with no machine named on it and reaches an invoice
    // the customer cannot match to a unit in their yard.
    //
    // A TRUCK job is identified by its truck fields instead, so this asks for one or
    // the other rather than insisting on a reefer that is not there. isTruckUnit is
    // the same test the labor suggestions already use.
    if (!isTruckUnit && !(form.unit_manufacturer.trim() && form.unit_model.trim())) {
      setToast('Unit manufacturer and model are required - or fill in the truck details if this is a truck job.')
      return
    }

    // Refuse rather than bill a figure that does not add up. Loud on purpose.
    if (extrasMismatch) { setToast('Cannot save: ' + extrasMismatch); return }
    if (discountError) { setToast('Cannot save: ' + discountError); return }
    setSaving(true)
    try {
      const body = {
        company_name:      form.company_name || null,
        customer_name:     form.customer_name,
        customer_phone:    form.customer_phone || null,
        customer_email:    form.customer_email || null,
        customer_id:       form.customer_id || null,
        fleet_account_id:  form.fleet_account_id || null,
        unit_id:           form.unit_id || null,
        address_line1:     form.address_line1 || null,
        address_line2:     form.address_line2 || null,
        city:              form.city || null,
        state:             form.state || null,
        zip:               form.zip || null,
        has_corp_address:  form.has_corp_address,
        corp_address_line1: form.has_corp_address ? (form.corp_address_line1 || null) : null,
        corp_address_line2: form.has_corp_address ? (form.corp_address_line2 || null) : null,
        corp_city:         form.has_corp_address ? (form.corp_city || null) : null,
        corp_state:        form.has_corp_address ? (form.corp_state || null) : null,
        corp_zip:          form.has_corp_address ? (form.corp_zip || null) : null,
        payment_terms:     form.payment_terms || 'net30',
        unit_number:       form.unit_number.trim() || null,
        unit_manufacturer: form.unit_manufacturer || null,
        unit_model:        form.unit_model || null,
        unit_serial:       form.unit_serial || null,
        unit_year:         form.unit_year || null,
        truck_make:        form.truck_make || null,
        truck_model:       form.truck_model || null,
        truck_year:        form.truck_year || null,
        vin:               form.vin || null,
        complaint:         form.complaint || null,
        diagnosis:         form.diagnosis || null,
        line_items:        lineItems,
        labor_rate:        form.labor_rate,
        subtotal_labor:    parseFloat(subtotalLabor.toFixed(2)),
        subtotal_parts:    parseFloat(subtotalParts.toFixed(2)),
        diagnostic_fee:    parseFloat(diagFee.toFixed(2)),
        road_call_fee:     parseFloat(roadFee.toFixed(2)),
        tax_rate:          form.tax_rate,
        // What was actually taxed, so the customer copy can say so and no later
        // reader has to guess the split back out of a blended subtotal.
        // MERGED, so the stored breakdown sums to the stored tax_amount.
        //
        // This stored tax.breakdown alone, which covers parts and labor and NOT the
        // tax on travel and shop supplies - while tax_amount below is taxWithExtras
        // and includes it. Any reader totalling the breakdown therefore came up short
        // of the figure the customer was charged, and the detail screen now prints
        // those buckets as the tax lines.
        //
        // mergeBreakdowns SUMS already-rounded bucket amounts rather than recomputing
        // over the merged bases - the two disagree by a cent, and the agreed figure
        // is the one that wins. See breakdownTaxTotal in lib/tax.ts.
        //
        // AFTER THE DISCOUNT, when there is one: the record below holds the split and
        // the tax as they stood before it.
        tax_breakdown:     breakdownFinal,
        // With the extras in. taxWithExtras / totalWithExtras include travel and
        // supplies tax; mileage adds to the subtotal and attracts none.
        tax_amount:        taxFinal,
        total:             totalFinal,
        // NULL clears it. The route refuses a record whose parts do not add up.
        discount:          discountApplied,
        // Computed, stored with the rate in force so a reopen cannot re-price them.
        ...extrasColumns(extrasResult),
        notes:             form.notes || null,
        valid_until:       form.valid_until || null,
        // Trimmed to null rather than saved as '': a blank PO must read as absent,
        // because the invoice prints a PO row only when there is one.
        customer_po_number: form.customer_po_number.trim() || null,
        tech_name:         form.tech_name.trim() || null,
        status,
      }
      if (editing) {
        // PUT, not POST: the same quote, same number, same customer link. A SENT quote
        // stays sent - its token is never rotated (see the route) - and the tech is
        // offered the re-send rather than having it happen behind their back.
        const keepStatus = editingStatus === 'sent' ? 'sent' : status
        const res  = await fetch(`/api/hd/quotes/${quoteId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, status: keepStatus }),
        })
        const data = await res.json()
        if (!res.ok || !data.quote?.id) { setToast(data.error ?? 'Save failed'); return }
        const resend = keepStatus === 'sent' && editingStatus === 'sent' && window.confirm(
          'Saved. The customer already has a link to this quote, and it now shows the changes.\n\n' +
          'Send it to them again so they know it changed?',
        )
        router.push(`/hd/quotes/${quoteId}${resend ? '?resend=1' : ''}`)
        return
      }
      const res  = await fetch('/api/hd/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (data.quote?.id) {
        if (data.customer_id) {
          // Green confirmation that the customer was logged; auto-dismiss at 3s.
          setCustomerToast(true)
          setTimeout(() => setCustomerToast(false), 3000)
          setTimeout(() => router.push(`/hd/quotes/${data.quote.id}`), 1200)
        } else {
          router.push(`/hd/quotes/${data.quote.id}`)
        }
      } else {
        setToast(data.error ?? 'Save failed')
      }
    } finally {
      setSaving(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ background: BG, minHeight: '100dvh', padding: '24px 20px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Page header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href={editing ? `/hd/quotes/${quoteId}` : '/hd/quotes'} style={{ color: MUTED, fontSize: 13 }}>
            {editing ? '← Quote' : '← Quotes'}
          </Link>
          <span style={{ color: BORDER }}>/</span>
          <span className="font-condensed font-bold text-2xl" style={{ color: TEXT }}>
            {editing ? `EDIT QUOTE ${String(initial.quote_number ?? '')}` : 'NEW QUOTE'}
          </span>
        </div>
        {editingStatus === 'sent' && (
          <p className="text-sm mb-4" style={{ color: '#B45309' }}>
            This quote has been sent. Saving keeps the same customer link, which will show the changes.
          </p>
        )}

        {/* ─ Section 1: Customer & Unit ─ */}
        <div style={cardStyle}>
          <SectionTitle>Customer &amp; Unit Info</SectionTitle>

          {/* Link an Intel Hub customer — auto-fills contact, address, and payment terms */}
          <div className="mb-4" style={{ position: 'relative' }}>
            <Field label="Link Intel Hub Customer (optional)">
              <div style={{ position: 'relative' }}>
                <input
                  style={inp}
                  value={customerSearch}
                  onChange={e => { setCustomerSearch(e.target.value); if (form.customer_id) setField('customer_id', '') }}
                  onFocus={() => { if (customerResults.length) setShowCustomerResults(true) }}
                  placeholder="Search customers and fleet accounts by name, company, or phone"
                />
                {form.customer_id && (
                  <button
                    type="button"
                    onClick={clearCustomerLink}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold px-2 py-1 rounded"
                    style={{ background: '#F3F4F6', color: MUTED }}
                  >
                    Unlink
                  </button>
                )}
              </div>
            </Field>
            {showCustomerResults && customerResults.length > 0 && !form.customer_id && (
              <div style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, marginTop: 4, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', maxHeight: 240, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                {customerResults.map(hit => (
                  <button
                    key={hit.id}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); pickCustomer(hit) }}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-50"
                    style={{ borderBottom: `1px solid #F9FAFB` }}
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium" style={{ color: TEXT }}>{hit.label}</p>
                      {/* WHICH Intel Hub this came from. Two customers can have the
                          same name in the two tables, and a tech choosing between
                          them needs to know which record he is attaching. */}
                      <span
                        className="text-xs px-1.5 py-0.5 rounded font-semibold"
                        style={hit.source === 'fleet'
                          ? { background: '#FFF7ED', color: ORANGE }
                          : { background: '#EBF5FF', color: BLUE }}
                      >
                        {hit.source === 'fleet' ? 'Fleet' : 'Customer'}
                      </span>
                    </div>
                    <p className="text-xs" style={{ color: MUTED }}>{hit.sublabel || '—'}</p>
                  </button>
                ))}
              </div>
            )}

            {pickerFailure && customerSearch.trim().length >= 2 && (
              <p className="text-xs mt-2" style={{ color: '#B45309' }}>{pickerFailure}</p>
            )}

            {fleetNote && (
              <p className="text-xs mt-2" style={{ color: MUTED }}>{fleetNote}</p>
            )}

            {/* More than one unit on the account. Offered, never guessed - the wrong
                serial on an approved quote is the wrong machine on the invoice. */}
            {fleetUnits.length > 1 && (
              <div className="mt-2" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
                {fleetUnits.map(u => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => applyFleetUnit(u)}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-50"
                    style={{ borderBottom: `1px solid #F9FAFB`, background: CARD }}
                  >
                    <p className="text-sm font-medium" style={{ color: TEXT }}>
                      {[u.unit_number, u.manufacturer, u.model].filter(Boolean).join(' / ') || '(unnamed unit)'}
                    </p>
                    {u.serial_number && (
                      <p className="text-xs" style={{ color: MUTED }}>Serial {u.serial_number}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mb-4">
            <Field label="Business Name">
              <input style={inp} value={form.company_name} onChange={e => setField('company_name', e.target.value)} placeholder="Fleet company or business name (optional)" />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="sm:col-span-1">
              <Field label="Customer Name *">
                <input style={inp} value={form.customer_name} onChange={e => setField('customer_name', e.target.value)} placeholder="Fleet name or customer" />
              </Field>
            </div>
            <Field label="Phone">
              <input style={inp} value={form.customer_phone} onChange={e => setField('customer_phone', e.target.value)} placeholder="(555) 000-0000" />
            </Field>
            <Field label="Email">
              <input style={inp} value={form.customer_email} onChange={e => setField('customer_email', e.target.value)} placeholder="customer@email.com" type="email" />
            </Field>
          </div>

          {/* Billing address. Auto-filled when an Intel Hub customer is linked, but the
              fields are always editable — the address on file is often not where this
              quote needs to go, and the single-line parser above is deliberately
              conservative about what it fills in. */}
          <div className="mb-4">
            <AddressAutofill
              value={{ address_line1: form.address_line1, address_line2: form.address_line2, city: form.city, state: form.state, zip: form.zip }}
              onChange={a => setForm(f => ({ ...f, ...a }))}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <Field label="Address Line 1">
              <input style={inp} value={form.address_line1} onChange={e => setField('address_line1', e.target.value)} placeholder="123 Main St" />
            </Field>
            <Field label="Address Line 2">
              <input style={inp} value={form.address_line2} onChange={e => setField('address_line2', e.target.value)} placeholder="Suite / Unit (optional)" />
            </Field>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div className="col-span-2">
              <Field label="City">
                <input style={inp} value={form.city} onChange={e => setField('city', e.target.value)} placeholder="Wauchula" />
              </Field>
            </div>
            <Field label="State">
              <input style={inp} value={form.state} onChange={e => setField('state', e.target.value)} placeholder="FL" maxLength={2} />
            </Field>
            <Field label="Zip">
              <input style={inp} value={form.zip} onChange={e => setField('zip', e.target.value)} placeholder="33873" inputMode="numeric" />
            </Field>
          </div>

          {/* Auto-filled address + terms from the linked Intel Hub customer */}
          {(billingAddr || form.customer_id) && (
            <div className="mb-6 p-3 rounded-lg text-sm" style={{ background: '#F9FAFB', border: `1px solid ${BORDER}` }}>
              {billingAddr && (
                <p style={{ color: TEXT }}>
                  {form.has_corp_address && <span style={{ color: MUTED }}>Billing: </span>}📍 {billingAddr}
                </p>
              )}
              {form.has_corp_address && serviceAddr && (
                <p className="mt-1" style={{ color: TEXT }}>
                  <span style={{ color: MUTED }}>Service: </span>🏢 {serviceAddr}
                </p>
              )}
              <p className="mt-1 text-xs" style={{ color: MUTED }}>
                Payment Terms: <strong style={{ color: TEXT }}>{form.payment_terms.replace('net', 'Net ')}</strong>
                {!billingAddr && ' · no address on file for this customer'}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            {/* REQUIRED unless this is a truck job - a reefer quote with no machine
                named reaches a tech with nothing to work on and a customer with
                nothing to match it to. The serial is NOT required: it is often not in
                hand on the phone, and the work order carries a flag for that instead
                of the quote refusing to save. */}
            {/* The fleet's own number for the trailer. A tech in a yard reads this off
                the side of the box, not the serial off the data plate. */}
            <Field label="Unit Number">
              <input style={inp} value={form.unit_number} onChange={e => setField('unit_number', e.target.value)} placeholder="e.g. 53169" />
            </Field>
            <Field label={isTruckUnit ? 'Manufacturer' : 'Manufacturer *'}>
              <select style={inp} value={form.unit_manufacturer} onChange={e => setField('unit_manufacturer', e.target.value)}>
                <option value="">Select...</option>
                <option>Thermo King</option>
                <option>Carrier Transicold</option>
              </select>
            </Field>
            <Field label={isTruckUnit ? 'Unit Model' : 'Unit Model *'}>
              <input style={inp} value={form.unit_model} onChange={e => setField('unit_model', e.target.value)} placeholder="e.g. S-600" />
            </Field>
            <Field label="Serial Number">
              <input style={inp} value={form.unit_serial} onChange={e => setForm(f => ({ ...f, unit_serial: e.target.value, unit_id: '' }))} placeholder="10-digit serial" />
            </Field>
            <Field label="Unit Year">
              <input style={inp} value={form.unit_year} onChange={e => setField('unit_year', e.target.value)} placeholder="e.g. 2018" />
            </Field>
            {/* Said at the point of entry, not only after conversion. The work order
                carries the same flag, so this is a heads-up rather than the record. */}
            {!isTruckUnit && !form.unit_serial.trim() && (
              <p className="col-span-2 sm:col-span-4 text-xs" style={{ color: '#B45309' }}>
                No serial number. This will save, and the work order will be flagged
                &quot;unit not identified&quot; so it is not forgotten.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Field label="Truck Make">
              <input style={inp} value={form.truck_make} onChange={e => setField('truck_make', e.target.value)} placeholder="e.g. Freightliner" />
            </Field>
            <Field label="Truck Model">
              <input style={inp} value={form.truck_model} onChange={e => setField('truck_model', e.target.value)} placeholder="e.g. Cascadia" />
            </Field>
            <Field label="Truck Year">
              <input style={inp} value={form.truck_year} onChange={e => setField('truck_year', e.target.value)} placeholder="e.g. 2020" />
            </Field>
            <Field label="VIN">
              <input style={inp} value={form.vin} onChange={e => setField('vin', e.target.value)} placeholder="17-digit VIN" />
            </Field>
          </div>
        </div>

        {/* ─ Section 2: Complaint & Diagnosis ─ */}
        <div style={cardStyle}>
          <SectionTitle>Complaint &amp; Diagnosis</SectionTitle>
          <div className="grid grid-cols-1 gap-4">
            <Field label="Complaint">
              <textarea
                style={{ ...inp, minHeight: 80, resize: 'vertical' }}
                value={form.complaint}
                onChange={e => setField('complaint', e.target.value)}
                placeholder="What is the customer reporting?"
              />
            </Field>
            <Field label="Diagnosis">
              <textarea
                style={{ ...inp, minHeight: 100, resize: 'vertical' }}
                value={form.diagnosis}
                onChange={e => setField('diagnosis', e.target.value)}
                placeholder="Technician diagnosis and findings..."
              />
            </Field>
            <div>
              <button
                onClick={pullFromQW}
                className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg"
                style={{ background: qwAvailable ? '#EBF5FF' : '#F3F4F6', color: qwAvailable ? BLUE : MUTED, border: `1px solid ${qwAvailable ? '#BFDBFE' : BORDER}`, minHeight: 44 }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                </svg>
                Pull from QuickWrench
              </button>
              {qwPulledNote ? (
                <p className="text-xs mt-1.5 font-medium" style={{ color: BLUE }}>{qwPulledNote}</p>
              ) : (
                <p className="text-xs mt-1.5" style={{ color: MUTED }}>
                  {qwAvailable ? 'Recent QuickWrench result available (within 24 hrs).' : 'No recent QuickWrench results — run a diagnosis first.'}
                </p>
              )}
            </div>
          </div>

          {/* ─ Gemini labor suggestions ─ */}
          {(form.complaint.trim() || form.diagnosis.trim()) && (
            <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${BORDER}` }}>
              <button
                onClick={getLaborSuggestions}
                disabled={suggestLoading}
                className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-60"
                style={{ background: BLUE, minHeight: 44 }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" />
                </svg>
                {suggestLoading ? 'Thinking…' : 'Get Labor Suggestions'}
              </button>
              {suggestNote && <p className="text-xs mt-2" style={{ color: MUTED }}>{suggestNote}</p>}

              {suggestions.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  {suggestions.map((s, i) => (
                    <div key={`${s.description}-${i}`} className="p-3 rounded-lg flex flex-col gap-2" style={{ background: '#F9FAFB', border: `1px solid ${BORDER}` }}>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: TEXT }}>{s.description}</p>
                        <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                          {s.mobile_hours} hrs mobile &nbsp;•&nbsp; {fmt(s.mobile_hours * form.labor_rate)}
                          {s.category && <span className="ml-1" style={{ color: '#9CA3AF' }}>· {s.category}</span>}
                        </p>
                      </div>
                      <button
                        onClick={() => addSuggestion(s)}
                        className="self-start text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
                        style={{ background: ORANGE }}
                      >
                        + Add to Quote
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─ Section 3: Labor Rate Settings ─ */}
        <div style={cardStyle}>
          <SectionTitle>Labor Rate Settings</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Labor Rate / Hour">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: MUTED }}>$</span>
                <input
                  style={{ ...inp, paddingLeft: 24 }}
                  type="number"
                  min={0}
                  value={form.labor_rate}
                  onChange={e => setField('labor_rate', parseFloat(e.target.value) || 0)}
                />
              </div>
            </Field>
            <div>
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.include_diagnostic}
                  onChange={e => setField('include_diagnostic', e.target.checked)}
                  className="w-4 h-4 rounded"
                  style={{ accentColor: ORANGE }}
                />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Include Diagnostic Fee</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: MUTED }}>$</span>
                {/* Blank rather than a 0 the tech did not type, leading zeros
                    stripped as they type. See FeeInput. */}
                <FeeInput
                  style={{ ...inp, paddingLeft: 24, opacity: form.include_diagnostic ? 1 : 0.4 }}
                  value={form.diagnostic_fee}
                  disabled={!form.include_diagnostic}
                  onChange={n => setField('diagnostic_fee', n)}
                />
              </div>
              {/* Only while the shop has no configured fee. Once HD Settings holds one
                  the box ticks itself at that value and this note is wrong, so it goes.
                  feesAvailable is false when migration 156 has not been applied, and
                  pointing at a Settings field that cannot save would be worse than
                  saying nothing. */}
              {feeSettings.loaded && feeSettings.diagnosticFee == null && (
                <p className="text-xs mt-1" style={{ color: MUTED }}>
                  {feeSettings.feesAvailable
                    ? 'No diagnostic fee set — add one in HD Settings to have it default on.'
                    : 'No diagnostic fee set.'}
                </p>
              )}
            </div>
            <div>
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.include_road_call}
                  onChange={e => setField('include_road_call', e.target.checked)}
                  className="w-4 h-4 rounded"
                  style={{ accentColor: ORANGE }}
                />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Include Road Call Fee</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: MUTED }}>$</span>
                {/* A number-typed input left "035.00" on screen after 35 was typed
                    over the 0. See FeeInput. */}
                <FeeInput
                  style={{ ...inp, paddingLeft: 24, opacity: form.include_road_call ? 1 : 0.4 }}
                  value={form.road_call_fee}
                  disabled={!form.include_road_call}
                  onChange={n => setField('road_call_fee', n)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ─ Section 4: Line Items ─ */}
        <div style={cardStyle}>
          <SectionTitle>Line Items</SectionTitle>

          <div className="flex gap-3 mb-4">
            <button
              onClick={() => setLaborModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ background: ORANGE, minHeight: 44 }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Labor
            </button>
            <button
              onClick={() => setPartsModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ background: '#EBF5FF', color: BLUE, border: `1px solid #BFDBFE`, minHeight: 44 }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Parts
            </button>
          </div>

          {/* Line items table */}
          {lineItems.length > 0 ? (
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
              <div
                className="grid grid-cols-[1fr_110px_80px_90px_28px] md:grid-cols-[1fr_90px_110px_80px_90px_28px] text-xs font-semibold uppercase tracking-wide px-4 py-2.5"
                style={{ gap: 8, background: '#F9FAFB', color: MUTED, borderBottom: `1px solid ${BORDER}` }}
              >
                <span>Description</span>
                <span className="text-right hidden md:block">Book</span>
                <span className="text-right">Mobile</span>
                <span className="text-right">Rate</span>
                <span className="text-right">Amount</span>
                <span />
              </div>
              {lineItems.map(item => (
                <div
                  key={item.id}
                  className="grid grid-cols-[1fr_110px_80px_90px_28px] md:grid-cols-[1fr_90px_110px_80px_90px_28px] items-center px-4 py-3 gap-2"
                  style={{ borderBottom: `1px solid #F9FAFB` }}
                >
                  {item.type === 'labor' ? (
                    <>
                      {/* Editable description */}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-1.5 py-0.5 rounded font-semibold shrink-0" style={{ background: '#FFF7ED', color: ORANGE }}>LAB</span>
                          <input
                            value={item.description}
                            onChange={e => updateLineDescription(item.id, e.target.value)}
                            style={{ ...lineInp }}
                            aria-label="Labor description"
                          />
                        </div>
                        {item.recharge_added && (
                          <span className="block text-xs mt-0.5 ml-7" style={{ color: '#9A3412' }}>+ refrigeration recovery &amp; recharge</span>
                        )}
                      </div>
                      {/* Editable book hours */}
                      <input
                        type="number" min={0} step={0.25}
                        value={item.book_hours}
                        onChange={e => updateLineHours(item.id, 'book', e.target.value)}
                        className="hidden md:block"
                        style={{ ...lineInp, textAlign: 'right' }}
                        aria-label="Book hours"
                      />
                      {/* Editable mobile hours */}
                      <input
                        type="number" min={0} step={0.25}
                        value={item.mobile_hours}
                        onChange={e => updateLineHours(item.id, 'mobile', e.target.value)}
                        style={{ ...lineInp, textAlign: 'right' }}
                        aria-label="Mobile hours"
                      />
                      <span className="text-xs text-right" style={{ color: MUTED }}>{`${fmt(form.labor_rate)}/hr`}</span>
                      <span className="text-sm font-semibold text-right" style={{ color: TEXT }}>{fmt(item.amount)}</span>
                    </>
                  ) : (
                    <>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-1.5 py-0.5 rounded font-semibold shrink-0" style={{ background: '#EBF5FF', color: BLUE }}>PRT</span>
                          <span className="text-sm" style={{ color: TEXT }}>{item.description}</span>
                        </div>
                        {item.part_number && (
                          <span className="block text-xs font-mono mt-0.5 ml-7" style={{ color: MUTED }}>{item.part_number}</span>
                        )}
                        {/* The Mobile column shows the sell price; the cost behind it is
                            spelled out here so the tech can check the line before saving. */}
                        {item.markup_percent ? (
                          <span className="block text-xs mt-0.5 ml-7" style={{ color: MUTED }}>
                            cost {fmt(item.unit_cost_base ?? 0)} + {item.markup_percent}% markup
                          </span>
                        ) : null}
                      </div>
                      <span className="text-xs text-right hidden md:block" style={{ color: MUTED }}>{`${item.quantity}×`}</span>
                      <span className="text-xs text-right" style={{ color: MUTED }}>{fmt(item.unit_cost)}</span>
                      <span className="text-xs text-right" style={{ color: MUTED }} />
                      <span className="text-sm font-semibold text-right" style={{ color: TEXT }}>{fmt(item.amount)}</span>
                    </>
                  )}
                  <button onClick={() => removeItem(item.id)} style={{ color: '#9CA3AF', lineHeight: 1 }}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8" style={{ border: `2px dashed ${BORDER}`, borderRadius: 8 }}>
              <p className="text-sm" style={{ color: MUTED }}>No line items yet — add labor or parts above</p>
            </div>
          )}

          {/* Running totals */}
          <div className="flex justify-end mt-6">
            {/* Hours and miles. Hidden entirely unless the shop bills one of them.
                Shop supplies has no input - it is a percentage of parts. */}
            <div style={{ width: 280, marginBottom: 12 }}>
              <ExtrasInputs
                settings={extrasSettings}
                loaded={extrasLoaded}
                travelHours={travelHours}
                mileageMiles={mileageMiles}
                onTravelHours={setTravelHours}
                onMileageMiles={setMileageMiles}
                laborRate={Number(form.labor_rate ?? 0)}
              />
            </div>
            <div style={{ width: 280 }}>
              {[
                { label: 'Labor Subtotal', val: subtotalLabor },
                { label: 'Parts Subtotal', val: subtotalParts },
                ...(form.include_diagnostic ? [{ label: 'Diagnostic Fee', val: diagFee }] : []),
                ...(form.include_road_call ? [{ label: 'Road Call Fee', val: roadFee }] : []),
                // Travel, mileage and shop supplies. extrasDisplayRows returns no row
                // for a zero amount, so nothing prints for an extra that is not charged.
                ...extrasDisplayRows(extrasResult).map(r => ({
                  label: r.detail ? `${r.label} (${r.detail})` : r.label,
                  val:   r.amount,
                })),
              ].map(r => (
                <div key={r.label} className="flex justify-between py-1.5 text-sm" style={{ color: MUTED }}>
                  <span>{r.label}</span><span>{fmt(r.val)}</span>
                </div>
              ))}
              {/* ===================================================================
                  ONE TAX BLOCK. TWO RATES, EACH PRINTED ONCE.
                  ===================================================================
                  THIS PRINTED TAX TWICE, in two different formats:

                      Parts Tax %  $0.30 / Labor Tax %  $9.69 / Tax  $9.99
                      Tax on parts (7.75%)  $0.30 / Tax on labor (7.75%)  $9.69

                  The two-rate editor was added ALONGSIDE the existing taxDisplayRows
                  summary instead of replacing it, so every figure appeared twice. And
                  the labels said "Parts Tax %" above a column of dollars.

                  Now one block, worded the way the customer-facing page words it -
                  "Tax on parts", "Labor - not taxable" - with the percentage appearing
                  exactly once, as the field that sets it. The parenthetical (7.75%)
                  that taxDisplayRows produces is deliberately NOT used here: on a form
                  the rate is editable, so printing it in the label too would be the
                  same duplication in miniature.

                  Both rows render whether or not the document has that category yet.
                  taxDisplayRows emits nothing for a category with no base, and keying
                  the inputs off it would leave a tech with nowhere to type the rate
                  until after he had added a line. */}
              {/* The discount sits between the subtotal and the tax. Nothing at all
                  prints for a quote without one. */}
              {discountApplied && (
                <>
                  <div className="flex justify-between py-1.5 text-sm" style={{ color: TEXT, borderTop: `1px solid ${BORDER}`, marginTop: 4 }}>
                    <span>Subtotal</span><span>{fmt(subtotalWithExtras)}</span>
                  </div>
                  <div className="flex justify-between py-1.5 text-sm" style={{ color: '#047857' }} data-testid="discount-row">
                    <span>{discountPrintLabel(discountApplied)}</span><span>{'-' + fmt(discountApplied.amount)}</span>
                  </div>
                </>
              )}
              <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: 4 }}>
                {([
                  // With a discount, each bucket's tax AFTER it (extras included), so
                  // the rows add up to the Tax line beneath them.
                  { key: 'parts', label: 'parts', taxed: taxedPartsFlag, rate: form.tax_rate,       field: 'tax_rate',       amount: (discountApplied ? breakdownFinal?.parts?.amount : tax.breakdown.parts?.amount) ?? 0 },
                  { key: 'labor', label: 'labor', taxed: taxedLaborFlag, rate: form.tax_rate_labor, field: 'tax_rate_labor', amount: (discountApplied ? breakdownFinal?.labor?.amount : tax.breakdown.labor?.amount) ?? 0 },
                ] as const).map(row => (
                  <div key={row.key} className="flex items-center gap-2 py-2">
                    <span className="text-sm flex-1" style={{ color: MUTED }}>
                      {row.taxed
                        ? `Tax on ${row.label}`
                        /* Same sentence the customer's copy uses, so a wrong setting
                           reads the same to the tech as it will to the customer. */
                        : `${row.label === 'parts' ? 'Parts' : 'Labor'} — not taxable`}
                    </span>
                    {row.taxed ? (
                      <>
                        <input
                          type="number"
                          min={0}
                          max={30}
                          step={0.1}
                          value={row.rate}
                          onChange={e => setField(row.field, parseFloat(e.target.value) || 0)}
                          style={{ width: 62, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '4px 8px', fontSize: 13, textAlign: 'right' }}
                        />
                        <span className="text-xs" style={{ color: MUTED }}>%</span>
                      </>
                    ) : (
                      <span className="text-xs" style={{ color: MUTED }}>Settings</span>
                    )}
                    <span className="text-sm" style={{ color: MUTED, minWidth: 68, textAlign: 'right' }}>
                      {fmt(row.amount)}
                    </span>
                  </div>
                ))}
                {/* Anything else the breakdown carries - services are taxed at the
                    parts rate and have no field of their own, so they print as the
                    shared helper words them rather than being silently dropped. */}
                {taxDisplayRows(tax.breakdown)
                  .filter(r => r.category !== 'parts' && r.category !== 'labor')
                  .map(r => (
                    <div key={r.category} className="flex justify-between py-2 text-sm" style={{ color: MUTED }}>
                      <span>{r.text}</span><span>{fmt(r.amount)}</span>
                    </div>
                  ))}
                {/* The total: the two buckets plus the tax on travel and supplies.
                    Its own line so the figures above it visibly add up to it. */}
                <div className="flex items-center gap-3 py-1.5" style={{ borderTop: `1px solid ${BORDER}` }}>
                  <span className="text-sm flex-1 font-semibold" style={{ color: MUTED }}>Tax</span>
                  <span className="text-sm font-semibold" style={{ color: MUTED }}>{fmt(taxFinal)}</span>
                </div>
              </div>
              <div className="flex justify-between items-center pt-3" style={{ borderTop: `2px solid ${ORANGE}`, marginTop: 4 }}>
                <span className="font-bold text-base" style={{ color: TEXT }}>TOTAL</span>
                <span className="font-bold text-2xl" style={{ color: ORANGE }}>{fmt(totalFinal)}</span>
              </div>
              {/* Labor and parts lines only. Travel, mileage, supplies and the fees are
                  never discounted. */}
              <div style={{ marginTop: 16 }}>
                <DiscountEditor theme="light" value={discountDraft} onChange={setDiscountDraft}
                  applied={discountApplied} error={discountError} notice={disc.ok ? disc.notice : null} />
              </div>
            </div>
          </div>
        </div>

        {/* ─ Section 5: Notes & Validity ─ */}
        <div style={cardStyle}>
          <SectionTitle>Notes &amp; Validity</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <Field label="Notes">
                <textarea
                  style={{ ...inp, minHeight: 80, resize: 'vertical' }}
                  value={form.notes}
                  onChange={e => setField('notes', e.target.value)}
                  placeholder="Payment terms, disclaimers, additional info..."
                />
              </Field>
            </div>
            <Field label="Valid Until">
              <input style={inp} type="date" value={form.valid_until} onChange={e => setField('valid_until', e.target.value)} />
            </Field>
            <Field label="Payment Terms">
              <PaymentTermsSelect style={inp} value={form.payment_terms} onChange={v => setField('payment_terms', v)} />
            </Field>
            {/* THE CUSTOMER'S PO NUMBER.
                Migration 153 added hd_quotes.customer_po_number, and the only thing
                that could write it was the customer typing it into the approval page.
                A fleet dispatcher who gives the PO over the phone had nowhere for it
                to go, and a fleet that pays on PO does not pay an invoice without one
                - which is a bill that sits unpaid until somebody calls about it.
                It travels: quote -> work order -> invoice. */}
            {/* WHO IS DOING THE WORK. Optional here, but it travels: quote -> work order
                -> invoice, so per-tech reporting has a name on the billed labor. Free
                text, the same notion of a tech as hd_work_orders.tech_name. */}
            <Field label="Assigned Tech (optional)">
              <input
                style={inp}
                value={form.tech_name}
                onChange={e => setField('tech_name', e.target.value)}
                placeholder="Who is doing the work"
                maxLength={200}
              />
            </Field>
            <Field label="Customer PO # (optional)">
              <input
                style={inp}
                value={form.customer_po_number}
                onChange={e => setField('customer_po_number', e.target.value)}
                placeholder="PO from the customer, if they have one"
              />
            </Field>
          </div>
        </div>

        {/* ─ Action Buttons ─ */}
        <div className="flex flex-col sm:flex-row gap-3 pb-8">
          {editingStatus === 'sent' ? (
            <button
              onClick={() => save('sent')}
              disabled={saving}
              className="flex-1 py-3 rounded-lg font-semibold text-sm text-white disabled:opacity-50"
              style={{ background: ORANGE, minHeight: 48 }}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          ) : (
            <>
              <button
                onClick={() => save('draft')}
                disabled={saving}
                className="flex-1 py-3 rounded-lg font-semibold text-sm disabled:opacity-50"
                style={{ background: '#F3F4F6', color: '#374151', border: `1px solid ${BORDER}`, minHeight: 48 }}
              >
                {saving ? 'Saving...' : editing ? 'Save Draft' : 'Save as Draft'}
              </button>
              <button
                onClick={() => save('sent')}
                disabled={saving}
                className="flex-1 py-3 rounded-lg font-semibold text-sm text-white disabled:opacity-50"
                style={{ background: ORANGE, minHeight: 48 }}
              >
                {saving ? 'Sending...' : 'Send Quote'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ─ Labor Modal (HD Suite dark theme) ─ */}
      {laborModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
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
              <button onClick={closeLaborModal} style={{ color: '#8a9bad' }}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Scrollable body */}
            <div className="px-5 py-4 flex flex-col gap-4" style={{ overflowY: 'auto' }}>

              {/* Free-text description + live library/catalog results */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#8a9bad' }}>Labor Description</label>
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
                          key={key}
                          onClick={() => selectLibraryItem(i)}
                          className="w-full text-left px-4 py-2.5 flex items-center gap-3"
                          style={{
                            background: isSel ? '#1a2733' : 'transparent',
                            borderLeft: isSel ? `3px solid ${ORANGE}` : '3px solid transparent',
                            borderBottom: `1px solid ${D_BORDER}`,
                          }}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate" style={{ color: isSel ? ORANGE : '#FFFFFF' }}>
                              {i.labor_code && <span className="font-mono text-xs mr-2" style={{ color: '#8a9bad' }}>{i.labor_code}</span>}
                              {i.description}
                            </p>
                            <p className="text-xs mt-0.5" style={{ color: '#8a9bad' }}>
                              {`Field: ${fieldT || '—'}`} &nbsp;&bull;&nbsp; {`Shop: ${shopT || '—'}`}
                            </p>
                          </div>
                          {/* Only tech's own saved items get the badge; master items look native */}
                          {!i.is_master && (
                            <span className="text-xs px-1.5 py-0.5 rounded font-semibold shrink-0 text-white" style={{ background: BLUE }}>saved</span>
                          )}
                        </button>
                      )
                    })}

                    {libTrimmed && (
                      <p className="px-4 py-2 text-xs" style={{ color: '#F59E0B', borderBottom: `1px solid ${D_BORDER}` }}>
                        {`Your library: ${libTrimmed}`}
                      </p>
                    )}

                    {/* LABOR_GUIDE fallback suggestions */}
                    {guideMatches.map(item => {
                      const key = `guide:${item.label}`
                      const isSel = laborSelectedKey === key
                      return (
                        <button
                          key={key}
                          onClick={() => selectGuideItem(item)}
                          className="w-full text-left px-4 py-2.5 flex items-center gap-3"
                          style={{
                            background: isSel ? '#1a2733' : 'transparent',
                            borderLeft: isSel ? `3px solid ${ORANGE}` : '3px solid transparent',
                            borderBottom: `1px solid ${D_BORDER}`,
                          }}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate" style={{ color: isSel ? ORANGE : '#FFFFFF' }}>{item.label}</p>
                            <p className="text-xs mt-0.5" style={{ color: '#8a9bad' }}>
                              Book: {fmtHrs(item.book_min, item.book_max, item.shop_only)}
                              &nbsp;&bull;&nbsp;
                              Mobile: {fmtHrs(item.mobile_min, item.mobile_max, item.shop_only)}
                              {item.requires_refrigeration && (
                                <span className="ml-2 font-semibold" style={{ color: '#60A5FA' }}>❄ Refrig.</span>
                              )}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                    {guideTrimmed && (
                      <p className="px-4 py-2 text-xs" style={{ color: '#F59E0B' }}>
                        {`Labor guide: ${guideTrimmed}`}
                      </p>
                    )}
                  </div>
                )}
                {sameNameCard && (
                  <p className="text-xs mt-1" style={{ color: '#F59E0B' }}>
                    {`You already have a card named this (${sameNameCard.labor_code ?? 'no code'}).`}
                  </p>
                )}
              </div>

              {/* ===================================================================
                  ONE BILLABLE NUMBER. Book time is reference, not an input.
                  ===================================================================
                  Four fields for one question is what was here, and the tech typed
                  the same value twice in two of them. The hours that bill get one
                  field; book time sits beside it as text because nothing bills from
                  it. "+ add a range" is for the jobs that genuinely have a spread. */}
              <div className="flex flex-col gap-1">
                <div className="flex items-end justify-between gap-3">
                  <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#8a9bad' }}>
                    Hours (billed)
                  </label>
                  {/* Hidden while the recharge add-on is on: it forces a range, and
                      offering to collapse one that cannot collapse is a dead control. */}
                  {!laborRecharge && (
                    <button
                      type="button"
                      onClick={() => {
                        if (laborRange) {
                          // Collapsing keeps the number the tech can SEE - the min -
                          // and discards the max rather than silently billing it.
                          setLaborMobileMax(laborMobileMin)
                          setLaborRange(false)
                        } else {
                          setLaborMobileMax(laborMobileMin)
                          setLaborRange(true)
                        }
                      }}
                      className="text-xs font-semibold"
                      style={{ color: '#60A5FA', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
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
                      // Single-number mode keeps the two ends together, so the stored
                      // mobile_hours_max matches what is on screen.
                      if (!laborRange) setLaborMobileMax(v)
                    }}
                    style={{ ...dInp, textAlign: 'center', maxWidth: 110 }}
                  />
                  {laborRange && (
                    <>
                      <span style={{ color: '#8a9bad', fontSize: 12 }}>to</span>
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
                  <span className="text-xs" style={{ color: '#8a9bad' }}>
                    hrs
                    {/* Book time, as reference. Only present when a library or guide
                        job supplied one - a hand-typed job has none, and the old form
                        invented 1.0 for it. */}
                    {bookRefText && <span className="ml-2" style={{ color: '#6b7a8c' }}>{bookRefText}</span>}
                  </span>
                </div>
                {pickedShopOnly && (
                  <div className="flex flex-wrap items-center gap-2 mt-1 px-3 py-2 rounded-lg" style={{ background: '#2a2213', border: '1px solid #6b5417' }}>
                    <p className="text-xs flex-1 min-w-[200px]" style={{ color: '#FCD34D' }}>
                      {pickedShopText
                        ? `This card has no field time. Shop time is ${pickedShopText}; field work usually takes longer. Enter the billed hours.`
                        : 'This card has no field time and no shop time. Enter the billed hours.'}
                    </p>
                    {pickedShopText && (
                      <button type="button" onClick={billShopTime}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                        style={{ color: '#FCD34D', border: '1px solid #6b5417', background: 'transparent', cursor: 'pointer' }}>
                        {`Bill shop time (${pickedShopText})`}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Refrigeration: explicit service (separate line) vs fixed-recovery checkbox */}
              {laborRefrig ? (
                <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: '#132132', border: `1px solid ${D_BORDER}` }}>
                  <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="#93C5FD" strokeWidth={2} viewBox="0 0 24 24">
                    <line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/>
                    <path d="M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1"/>
                  </svg>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: '#93C5FD' }}>
                      Separate refrigeration service line will be added
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#8a9bad' }}>
                      Refrigeration Service{laborRefrig.service ? ` ${laborRefrig.service}` : ''} — {laborRefrig.hours} hrs, billed as its own line (not added to base hours)
                    </p>
                  </div>
                </div>
              ) : (
                <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer" style={{ background: '#132132', border: `1px solid ${D_BORDER}` }}>
                  <input
                    type="checkbox"
                    checked={laborRecharge}
                    onChange={e => {
                      setLaborRecharge(e.target.checked)
                      // The add-on is 1.5 TO 2.5 hrs, so the billable figure stops
                      // being one number the moment it is ticked. Switching the field
                      // automatically is the whole reason the range mode exists.
                      if (e.target.checked) setLaborRange(true)
                    }}
                    className="mt-0.5 w-4 h-4"
                    style={{ accentColor: BLUE }}
                  />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: '#93C5FD' }}>Add refrigeration recovery &amp; recharge</p>
                    <p className="text-xs mt-0.5" style={{ color: '#8a9bad' }}>Adds 1.5 to 2.5 hrs to mobile field time</p>
                  </div>
                </label>
              )}

              {/* Filter drier reminder */}
              {(laborRecharge || laborRefrig) && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: '#2a2213', border: '1px solid #6b5417' }}>
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="#F59E0B" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  <p className="text-xs font-semibold" style={{ color: '#FCD34D' }}>Remember to add filter drier to the parts list.</p>
                </div>
              )}

              {/* Save to library - not offered for a card picked from it, unchanged: that
                  line is the card, and saving it again would make a copy. */}
              {pickedUnchanged && laborPicked ? (
                <p className="text-sm" style={{ color: '#c9d5e0' }}>
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
                  <span className="text-sm" style={{ color: '#c9d5e0' }}>Save to my labor library as a new card</span>
                </label>
              )}

              {/* ===================================================================
                  THE ARITHMETIC, NOT A BARE TOTAL.
                  ===================================================================
                  This printed "Mobile: 1.5 hrs", "Book: 1 hrs flat rate" and "$203"
                  side by side, with nothing saying which number produced the $203 -
                  so a tech could not tell whether he had just billed for both. And
                  $203 was a rounded 202.50, so the preview did not even match the
                  line it was about to add.

                  One sentence now: hours x rate = amount, at the real cent. */}
              <div className="p-3 rounded-lg" style={{ background: '#132132', border: `1px solid ${D_BORDER}` }}>
                <p className="text-sm font-semibold" style={{ color: ORANGE }}>
                  {laborMath()}
                </p>
                {laborRecharge && (
                  <p className="text-xs mt-1" style={{ color: '#8a9bad' }}>
                    includes the refrigeration recovery &amp; recharge add-on
                    ({baseMobileMin} hrs + 1.5 to 2.5)
                  </p>
                )}
                {bookRefText && (
                  <p className="text-xs mt-1" style={{ color: '#6b7a8c' }}>
                    {bookRefText} — reference only, nothing bills from it
                  </p>
                )}
                {laborRefrig && (
                  <p className="text-xs mt-1" style={{ color: '#93C5FD' }}>
                    + Refrigeration Service{laborRefrig.service ? ` ${laborRefrig.service}` : ''} — {laborRefrig.hours} hrs
                    {' '}&times; {money(form.labor_rate)}/hr = {money(laborRefrig.hours * form.labor_rate)} (separate line)
                  </p>
                )}
              </div>
            </div>

            {/* Footer buttons */}
            <div className="flex gap-3 px-5 pb-5 pt-3 shrink-0" style={{ borderTop: `1px solid ${D_BORDER}` }}>
              <button
                onClick={closeLaborModal}
                className="flex-1 py-2.5 rounded-lg font-semibold text-sm"
                style={{ background: D_INPUT_BG, color: '#c9d5e0', border: `1px solid ${D_BORDER}` }}
              >
                Cancel
              </button>
              <button
                onClick={addLaborItem}
                disabled={!laborDesc.trim()}
                className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-white disabled:opacity-40"
                style={{ background: ORANGE }}
              >
                Add Line
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─ Parts Modal ─ */}
      {partsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div style={{ background: CARD, borderRadius: 12, padding: 24, width: '100%', maxWidth: 520 }}>
            <h3 className="font-condensed font-bold text-xl mb-4" style={{ color: TEXT }}>ADD PARTS LINE</h3>
            <div className="flex flex-col gap-4">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Field label="Part Number">
                    <input style={inp} value={parts.part_number} onChange={e => setParts(d => ({ ...d, part_number: e.target.value }))} placeholder="e.g. 37-33-6021" autoFocus />
                  </Field>
                </div>
                <div className="flex flex-col justify-end">
                  <button
                    onClick={searchParts}
                    disabled={partsSearching}
                    className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                    style={{ background: BLUE, minHeight: 44 }}
                  >
                    {partsSearching ? '...' : 'Lookup'}
                  </button>
                </div>
              </div>

              {partsResults.length > 0 && (
                <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
                  {partsResults.map(p => (
                    <button
                      key={p.part_number}
                      onClick={() => selectPartResult(p)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-start gap-3"
                      style={{ borderBottom: `1px solid #F9FAFB` }}
                    >
                      <span className="font-mono text-xs font-semibold" style={{ color: ORANGE, minWidth: 100 }}>{p.part_number}</span>
                      <span className="text-sm" style={{ color: TEXT }}>{p.description}</span>
                    </button>
                  ))}
                </div>
              )}

              <Field label="Description">
                <input style={inp} value={parts.description} onChange={e => setParts(d => ({ ...d, description: e.target.value }))} placeholder="Part description" />
              </Field>
              {/* Cost is what the tech paid; sell is what the customer is billed. The
                  sell column is read-only so the two can never be typed out of step. */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Field label="Quantity">
                  <input style={inp} type="number" min={1} value={parts.quantity} onChange={e => setParts(d => ({ ...d, quantity: e.target.value }))} />
                </Field>
                <Field label="Your Cost">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: MUTED }}>$</span>
                    <input style={{ ...inp, paddingLeft: 24 }} type="number" min={0} step={0.01} value={parts.unit_cost} onChange={e => setParts(d => ({ ...d, unit_cost: e.target.value }))} />
                  </div>
                </Field>
                <Field label="Markup %">
                  <input style={inp} type="number" min={0} step={1} value={parts.markup} onChange={e => setParts(d => ({ ...d, markup: e.target.value }))} />
                </Field>
                <Field label="Sell / Unit">
                  <div className="flex items-center" style={{ height: 44, paddingLeft: 12, fontWeight: 600, color: TEXT }}>
                    {fmt(sellPrice(parseFloat(parts.unit_cost) || 0, parseFloat(parts.markup) || 0))}
                  </div>
                </Field>
              </div>
              <p className="text-sm" style={{ color: MUTED }}>
                Line total: <strong style={{ color: TEXT }}>{fmt(lineAmount(parseFloat(parts.quantity) || 1, parseFloat(parts.unit_cost) || 0, parseFloat(parts.markup) || 0))}</strong>
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => { setPartsModal(false); setParts({ part_number: '', description: '', quantity: '1', unit_cost: '0.00', markup: String(partsMarkupDefault) }); setPartsResults([]) }}
                  className="flex-1 py-2.5 rounded-lg font-semibold text-sm"
                  style={{ background: '#F3F4F6', color: '#374151' }}
                >
                  Cancel
                </button>
                <button onClick={addPartsItem} className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-white" style={{ background: BLUE }}>
                  Add Line
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customer-saved toast (green, auto-dismisses at 3s) */}
      {customerToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-semibold text-white shadow-xl" style={{ background: '#16A34A' }}>
          Customer saved to your contacts
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-semibold text-white shadow-xl" style={{ background: '#1A1A1A' }}>
          {toast}
          <button className="ml-4 opacity-60 hover:opacity-100" onClick={() => setToast('')}>×</button>
        </div>
      )}
    </div>
  )
}
