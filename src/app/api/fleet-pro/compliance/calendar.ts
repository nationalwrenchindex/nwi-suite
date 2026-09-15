// SERVER-ONLY. Assembles the compliance calendar for one fleet.
//
// Not a route — a plain module beside route.ts. Next.js only treats route.ts/page.tsx
// as special inside app/, so a sibling module here is just an import, and this is the
// one place both consumers can reach: GET /api/fleet-pro/compliance renders it, and
// the nightly cron at /api/cron/fleet-pro-compliance-alerts alerts on it. Two copies
// of this assembly would eventually disagree about what "due" means, which is the one
// thing a compliance calendar may never do.
//
// THE TENANT RULE: every query below is scoped with .eq('fleet_account_id', fleetId)
// using the id the caller's membership resolved to — never one from a request body.
//
// Nothing here classifies a date itself. All eight item types go through
// src/lib/fleet-pro/compliance.ts so the page, the email and the SMS agree.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  complianceStatus,
  annualDotInspectionDue,
  nextIftaPeriodEnd,
  iftaPeriodLabel,
  iftaFilingDeadline,
  nextHut2290Due,
  hut2290TaxPeriodYear,
  COMPLIANCE_TYPE_LABEL,
  COMPLIANCE_STATE_RANK,
  type ComplianceItemType,
} from '@/lib/fleet-pro/compliance'
import {
  COMPLIANCE_BUCKET,
  COMPLIANCE_SIGNED_URL_TTL_SECONDS,
  type ComplianceItem,
  type ComplianceItemSource,
  type FleetComplianceRecord,
} from '@/types/fleet-pro-compliance'

export const DOC_COLUMNS =
  'id, fleet_account_id, unit_id, driver_id, doc_type, issued_on, expires_on, file_url, file_name, notes, created_at, updated_at'

// One string literal, like DOC_COLUMNS above: the Supabase client reads these at the
// type level to derive the row shape, and a concatenation it cannot see statically
// degrades the result type.
export const FLEET_COMPLIANCE_COLUMNS =
  'insurance_carrier, insurance_policy_number, insurance_expires_on, insurance_doc_url, insurance_doc_name, ifta_account_number, ifta_filed_through, hut_2290_filed_for_year, notes, alert_sent_at, alert_digest_key, updated_at'

interface Row { [key: string]: unknown }

/** Postgres DATE comes back as YYYY-MM-DD; a TIMESTAMPTZ does not. Take the day only. */
function dayOf(value: unknown): string | null {
  if (!value) return null
  const s = String(value)
  return s.length >= 10 ? s.slice(0, 10) : null
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(`${s}T12:00:00`)
  return isNaN(d.getTime())
    ? s
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export interface ComplianceCalendarResult {
  items:        ComplianceItem[]
  units:        { id: string; unit_number: string }[]
  drivers:      { id: string; full_name: string }[]
  fleetRecord:  FleetComplianceRecord | null
  /** Raw dedupe state from fleet_pro_fleet_compliance, for the cron. Never sent to a client. */
  alertSentAt:  string | null
  alertKey:     string | null
}

/**
 * Build every calendar line for one fleet.
 *
 * `withSignedUrls` is off for the cron: minting a signed URL per document costs a
 * storage round trip and the email links to the portal, not to the file.
 */
export async function buildComplianceCalendar(
  svc: SupabaseClient,
  fleetAccountId: string,
  fleetName: string,
  today: string,
  opts: { withSignedUrls?: boolean } = {},
): Promise<ComplianceCalendarResult> {
  const withSignedUrls = opts.withSignedUrls ?? false

  // ── 1. Load everything the calendar is derived from, in parallel ────────────
  const [unitsRes, driversRes, regRes, docsRes, inspRes, fleetRes] = await Promise.all([
    svc.from('hd_units')
      .select('id, unit_number')
      .eq('fleet_account_id', fleetAccountId)
      .order('unit_number', { ascending: true }),

    // Retired drivers drop off the calendar entirely — an expired CDL for someone who
    // left in March is not a compliance problem, and leaving it red trains the fleet
    // to ignore red.
    svc.from('fleet_pro_drivers')
      .select('id, full_name, cdl_expires_on, medical_card_expires_on')
      .eq('fleet_account_id', fleetAccountId)
      .eq('active', true)
      .order('full_name', { ascending: true }),

    // Migration 114's table, read rather than re-created. See the header of 131.
    svc.from('fleet_pro_unit_registration')
      .select('unit_id, expires_on, license_plate, jurisdiction')
      .eq('fleet_account_id', fleetAccountId),

    svc.from('fleet_pro_compliance_docs')
      .select(DOC_COLUMNS)
      .eq('fleet_account_id', fleetAccountId),

    // Newest first so the first row seen per unit is the most recent inspection.
    svc.from('hd_dot_inspections')
      .select('unit_id, inspection_date')
      .eq('fleet_account_id', fleetAccountId)
      .not('unit_id', 'is', null)
      .order('inspection_date', { ascending: false }),

    svc.from('fleet_pro_fleet_compliance')
      .select(FLEET_COMPLIANCE_COLUMNS)
      .eq('fleet_account_id', fleetAccountId)
      .maybeSingle(),
  ])

  const units   = (unitsRes.data   ?? []) as Row[]
  const drivers = (driversRes.data ?? []) as Row[]
  const regs    = (regRes.data     ?? []) as Row[]
  const docs    = (docsRes.data    ?? []) as Row[]
  const insps   = (inspRes.data    ?? []) as Row[]
  const fleet   = (fleetRes.data   ?? null) as Row | null

  // A load failure is logged rather than thrown: a calendar that renders seven of its
  // eight item families is far more useful than a 500, and the missing family shows as
  // 'missing' (red) rather than quietly as green.
  for (const [name, res] of Object.entries({
    units: unitsRes, drivers: driversRes, registration: regRes,
    docs: docsRes, inspections: inspRes, fleet: fleetRes,
  })) {
    if (res.error) console.error(`[fleet-pro/compliance] ${name} load failed:`, res.error.message)
  }

  // ── 2. Index the lookups ────────────────────────────────────────────────────
  const regByUnit = new Map<string, Row>()
  for (const r of regs) regByUnit.set(String(r.unit_id), r)

  const lastInspectionByUnit = new Map<string, string>()
  for (const i of insps) {
    const unitId = String(i.unit_id)
    const date   = dayOf(i.inspection_date)
    if (date && !lastInspectionByUnit.has(unitId)) lastInspectionByUnit.set(unitId, date)
  }

  // Newest document wins when a subject has more than one of a type. A fleet that
  // uploads this year's medical card without deleting last year's must see this year's.
  const docBySubjectType = new Map<string, Row>()
  for (const d of docs) {
    const subjectId = (d.unit_id as string | null) ?? (d.driver_id as string | null)
    if (!subjectId) continue
    const key      = `${d.doc_type}:${subjectId}`
    const existing = docBySubjectType.get(key)
    if (!existing) { docBySubjectType.set(key, d); continue }
    const a = dayOf(d.expires_on) ?? ''
    const b = dayOf(existing.expires_on) ?? ''
    if (a > b) docBySubjectType.set(key, d)
  }

  // ── 3. Signed URLs, one batch ───────────────────────────────────────────────
  // The bucket is private — these are CDL and medical-card scans. Links are minted
  // here, live an hour, and are never stored.
  const signedByPath = new Map<string, string>()
  if (withSignedUrls) {
    const paths = [
      ...docs.map(d => d.file_url as string | null),
      (fleet?.insurance_doc_url as string | null) ?? null,
    ].filter((p): p is string => !!p)

    if (paths.length > 0) {
      const { data, error } = await svc.storage
        .from(COMPLIANCE_BUCKET)
        .createSignedUrls(paths, COMPLIANCE_SIGNED_URL_TTL_SECONDS)
      if (error) {
        // A bucket that does not exist yet must not take the page down with it.
        console.error('[fleet-pro/compliance] signed url batch failed:', error.message)
      } else {
        for (const entry of data ?? []) {
          if (entry.path && entry.signedUrl) signedByPath.set(entry.path, entry.signedUrl)
        }
      }
    }
  }

  const signedFor = (path: string | null | undefined): string | null =>
    path ? signedByPath.get(path) ?? null : null

  // ── 4. Build the items ──────────────────────────────────────────────────────
  const items: ComplianceItem[] = []

  function push(args: {
    type:          ComplianceItemType
    subject:       'unit' | 'driver' | 'fleet'
    subjectId:     string | null
    subjectLabel:  string
    expiresOn:     string | null
    source:        ComplianceItemSource
    detail?:       string | null
    doc?:          Row | null
  }) {
    const status = complianceStatus(args.expiresOn, today)
    const doc    = args.doc ?? null
    const path   = (doc?.file_url as string | null) ?? null
    items.push({
      key:                   `${args.type}:${args.subjectId ?? 'fleet'}`,
      type:                  args.type,
      type_label:            COMPLIANCE_TYPE_LABEL[args.type],
      subject:               args.subject,
      subject_id:            args.subjectId,
      subject_label:         args.subjectLabel,
      expires_on:            args.expiresOn,
      state:                 status.state,
      days_until_expiration: status.daysUntilExpiration,
      label:                 status.label,
      color:                 status.color,
      source:                args.source,
      detail:                args.detail ?? null,
      doc_id:                doc ? String(doc.id) : null,
      has_document:          !!path,
      signed_url:            signedFor(path),
    })
  }

  // ---- per unit -------------------------------------------------------------
  for (const u of units) {
    const unitId = String(u.id)
    const label  = (u.unit_number as string | null) ?? 'Unit'

    // Annual DOT inspection. Derived from the newest hd_dot_inspections row for the
    // unit + 12 months, because that row IS the inspection. An uploaded document of
    // this type overrides it — the case where the fleet had the inspection done
    // somewhere other than through NWI and the system has no record of its own.
    const inspDoc     = docBySubjectType.get(`annual_dot_inspection:${unitId}`) ?? null
    const derivedDue  = annualDotInspectionDue(lastInspectionByUnit.get(unitId) ?? null)
    const docDue      = dayOf(inspDoc?.expires_on)
    const lastInsp    = lastInspectionByUnit.get(unitId) ?? null
    push({
      type: 'annual_dot_inspection', subject: 'unit', subjectId: unitId, subjectLabel: label,
      expiresOn: docDue ?? derivedDue,
      source:    docDue ? 'document' : 'inspection',
      detail:    docDue
        ? 'From uploaded inspection report'
        : lastInsp ? `Last inspected ${fmtDate(lastInsp)}` : 'No inspection on record',
      doc: inspDoc,
    })

    // Registration. Read from migration 114's table; a document of type 'registration'
    // only supplies the scan, never the date — one date, one owner.
    const reg     = regByUnit.get(unitId) ?? null
    const regDoc  = docBySubjectType.get(`registration:${unitId}`) ?? null
    const plate   = (reg?.license_plate as string | null) ?? null
    const juris   = (reg?.jurisdiction  as string | null) ?? null
    push({
      type: 'registration', subject: 'unit', subjectId: unitId, subjectLabel: label,
      expiresOn: dayOf(reg?.expires_on),
      source:    'registration',
      detail:    plate ? `Plate ${plate}${juris ? ` (${juris})` : ''}` : 'No plate on file',
      doc: regDoc,
    })

    // IRP. No table of its own — an apportioned cab card is a document with a date,
    // which is exactly what fleet_pro_compliance_docs is.
    const irpDoc = docBySubjectType.get(`irp:${unitId}`) ?? null
    push({
      type: 'irp', subject: 'unit', subjectId: unitId, subjectLabel: label,
      expiresOn: dayOf(irpDoc?.expires_on),
      source:    'document',
      detail:    irpDoc ? ((irpDoc.notes as string | null) ?? null) : 'No IRP cab card on file',
      doc: irpDoc,
    })
  }

  // ---- per driver -----------------------------------------------------------
  for (const d of drivers) {
    const driverId = String(d.id)
    const label    = (d.full_name as string | null) ?? 'Driver'

    push({
      type: 'cdl', subject: 'driver', subjectId: driverId, subjectLabel: label,
      expiresOn: dayOf(d.cdl_expires_on),
      source:    'driver',
      detail:    null,
      doc:       docBySubjectType.get(`cdl:${driverId}`) ?? null,
    })

    push({
      type: 'medical_card', subject: 'driver', subjectId: driverId, subjectLabel: label,
      expiresOn: dayOf(d.medical_card_expires_on),
      source:    'driver',
      // 49 CFR 391.45 — worth saying on the row, because the medical card is the one
      // people assume is covered by the CDL.
      detail:    'DOT medical certificate (49 CFR 391.45)',
      doc:       docBySubjectType.get(`medical_card:${driverId}`) ?? null,
    })
  }

  // ---- per fleet ------------------------------------------------------------
  const insuranceExpires = dayOf(fleet?.insurance_expires_on)
  const carrier          = (fleet?.insurance_carrier as string | null) ?? null
  push({
    type: 'insurance', subject: 'fleet', subjectId: null, subjectLabel: fleetName,
    expiresOn: insuranceExpires,
    source:    'fleet',
    detail:    carrier ? `Certificate of insurance — ${carrier}` : 'No certificate on file',
    doc:       null,
  })
  // The COI scan lives on the fleet row rather than in the docs table (the docs table's
  // CHECK requires a unit or a driver), so its signed URL is patched on by hand here.
  const coiPath = (fleet?.insurance_doc_url as string | null) ?? null
  if (coiPath) {
    const last = items[items.length - 1]
    last.has_document = true
    last.signed_url   = signedFor(coiPath)
  }

  const iftaFiled  = dayOf(fleet?.ifta_filed_through)
  const iftaPeriod = nextIftaPeriodEnd(today, iftaFiled)
  push({
    type: 'ifta', subject: 'fleet', subjectId: null, subjectLabel: fleetName,
    expiresOn: iftaPeriod,
    source:    'statutory',
    // The quarter end is what the calendar tracks; the statutory return deadline is a
    // month later. Both are shown so nobody reads the earlier date as the drop-dead
    // one — see the comment on IFTA_PERIOD_ENDS in lib/fleet-pro/compliance.ts.
    detail:    iftaPeriod
      ? `${iftaPeriodLabel(iftaPeriod)} period closes — return due ${fmtDate(iftaFilingDeadline(iftaPeriod))}`
      : null,
    doc: null,
  })

  const filedYear = fleet?.hut_2290_filed_for_year == null
    ? null
    : Number(fleet.hut_2290_filed_for_year)
  const hutDue    = nextHut2290Due(today, filedYear)
  const hutPeriod = hut2290TaxPeriodYear(today)
  push({
    type: 'hut_2290', subject: 'fleet', subjectId: null, subjectLabel: fleetName,
    expiresOn: hutDue,
    source:    'statutory',
    detail:    hutPeriod == null
      ? null
      : `Heavy vehicle use tax, period ${hutPeriod}–${hutPeriod + 1}` +
        (filedYear != null ? ` · filed for ${filedYear}` : ''),
    doc: null,
  })

  // ── 5. Worst first, then soonest ────────────────────────────────────────────
  // The expired items are the reason this page exists, so they lead regardless of how
  // far in the past they are. Within a state, the nearest date comes first; an item
  // with no date sorts last inside its own (red) group.
  items.sort((a, b) => {
    const rank = COMPLIANCE_STATE_RANK[a.state] - COMPLIANCE_STATE_RANK[b.state]
    if (rank !== 0) return rank
    const ad = a.days_until_expiration ?? Number.MAX_SAFE_INTEGER
    const bd = b.days_until_expiration ?? Number.MAX_SAFE_INTEGER
    if (ad !== bd) return ad - bd
    return a.subject_label.localeCompare(b.subject_label)
  })

  const fleetRecord: FleetComplianceRecord | null = fleet ? {
    insurance_carrier:       (fleet.insurance_carrier       as string | null) ?? null,
    insurance_policy_number: (fleet.insurance_policy_number as string | null) ?? null,
    insurance_expires_on:    insuranceExpires,
    insurance_doc_url:       coiPath,
    insurance_doc_name:      (fleet.insurance_doc_name      as string | null) ?? null,
    insurance_signed_url:    signedFor(coiPath),
    ifta_account_number:     (fleet.ifta_account_number     as string | null) ?? null,
    ifta_filed_through:      iftaFiled,
    hut_2290_filed_for_year: filedYear,
    notes:                   (fleet.notes                   as string | null) ?? null,
    updated_at:              (fleet.updated_at              as string | null) ?? null,
  } : null

  return {
    items,
    units:   units.map(u => ({ id: String(u.id), unit_number: (u.unit_number as string | null) ?? 'Unit' })),
    drivers: drivers.map(d => ({ id: String(d.id), full_name: (d.full_name as string | null) ?? 'Driver' })),
    fleetRecord,
    alertSentAt: (fleet?.alert_sent_at    as string | null) ?? null,
    alertKey:    (fleet?.alert_digest_key as string | null) ?? null,
  }
}
