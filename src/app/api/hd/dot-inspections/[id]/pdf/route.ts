// GET /api/hd/dot-inspections/[id]/pdf — the printable DOT annual inspection.
//
// Same generation approach as /api/hd/invoices/[id]/pdf: a self-contained HTML
// document served as text/html with a print button, which the browser turns into a
// PDF. No PDF library is involved on purpose — the invoice route set that pattern
// and a second mechanism would mean two ways for a signed record to render.
//
// Three audiences reach this document: the mechanic who performed the inspection,
// the fleet whose unit it is, and the partner who resells that fleet. Anyone else
// gets a 403, including a signed-in mechanic who simply guessed the uuid.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getFleetProMembership } from '@/lib/fleet-pro/access'
import { getPartner, partnerOwnsAccount } from '@/lib/fleet-pro/partner-access'
import {
  INSPECTION_CATEGORIES,
  CATEGORY_ITEMS,
  categoryLabel,
} from '@/lib/hd/dot-categories'

export const dynamic = 'force-dynamic'

interface ItemState { result?: string; notes?: string }
interface CategoryState { items?: Record<string, ItemState> }

interface Violation {
  category?: string
  item?: string
  label?: string
  notes?: string
  safetyCritical?: boolean
}

interface Row { [key: string]: unknown }

// ── helpers ───────────────────────────────────────────────────────────────────

/** Everything printed here is operator-entered text landing in an HTML document. */
function esc(value: unknown): string {
  if (value == null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function str(value: unknown): string | null {
  const s = value == null ? '' : String(value).trim()
  return s.length ? s : null
}

/** Date-only column. Noon avoids the timezone slip that turns a date into yesterday. */
function fmtDay(value: unknown): string {
  const s = str(value)
  if (!s) return '—'
  const d = new Date(`${s.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function fmtStamp(value: unknown): string | null {
  const s = str(value)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-US')
}

/** A category is failed if any answered item failed; N/A only when every item is. */
function categoryVerdict(state: CategoryState | undefined): 'pass' | 'fail' | 'na' {
  const results = Object.values(state?.items ?? {}).map(i => String(i?.result ?? ''))
  if (results.some(r => r === 'fail')) return 'fail'
  if (results.length > 0 && results.every(r => r === 'na')) return 'na'
  return 'pass'
}

const VERDICT_CLASS: Record<string, string> = { pass: 'r-pass', fail: 'r-fail', na: 'r-na' }
const VERDICT_LABEL: Record<string, string> = { pass: 'PASS', fail: 'FAIL', na: 'N/A' }

// ── route ─────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  // Read through the service client, then decide. Reading under the caller's own
  // RLS would hand the mechanic his row and everybody else a 404, which is the
  // wrong answer for the fleet and the partner who are both entitled to it.
  const svc = createServiceClient()
  const { data: inspection } = await svc
    .from('hd_dot_inspections')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!inspection) return new NextResponse('Not found', { status: 404 })

  const insp    = inspection as Row
  const fleetId = str(insp.fleet_account_id)

  let allowed = str(insp.user_id) === user.id

  if (!allowed && fleetId) {
    const membership = await getFleetProMembership(user.id)
    if (membership?.fleet_account_id === fleetId) allowed = true
  }
  if (!allowed && fleetId) {
    const partner = await getPartner(user.id)
    if (partner && await partnerOwnsAccount(partner.id, fleetId)) allowed = true
  }

  if (!allowed) return new NextResponse('Forbidden', { status: 403 })

  // ── supporting context ──────────────────────────────────────────────────────
  const unitId = str(insp.unit_id)
  const [{ data: unit }, { data: profile }] = await Promise.all([
    unitId
      ? svc.from('hd_units')
          .select('unit_number, manufacturer, model, serial_number, year, truck_trailer_number')
          .eq('id', unitId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    svc.from('profiles')
      .select('business_name')
      .eq('id', str(insp.user_id) ?? '')
      .maybeSingle(),
  ])

  const u = (unit ?? null) as Row | null

  const data       = (insp.inspection_data ?? {}) as Record<string, CategoryState>
  const violations = (Array.isArray(insp.violations) ? insp.violations : []) as Violation[]
  const passed     = String(insp.overall_result ?? '').toLowerCase() !== 'fail'
  const inspId     = str(insp.inspection_id) ?? `DOT-${String(insp.id).slice(0, 8).toUpperCase()}`

  // SIGNATURE HONESTY: the document says signed only when a signature actually
  // exists on the row. An unsigned record prints, and prints as unsigned.
  const signature  = str(insp.signature_data)
  const signedAt   = fmtStamp(insp.locked_at)

  const factRows: { label: string; value: string }[] = [
    { label: 'Unit Number',     value: str(u?.unit_number) ?? str(insp.unit_identifier) ?? '—' },
    { label: 'Make / Model',    value: [str(u?.manufacturer) ?? str(insp.unit_manufacturer), str(u?.model) ?? str(insp.unit_model)].filter(Boolean).join(' ') || '—' },
    { label: 'Serial / VIN',    value: str(u?.serial_number) ?? str(insp.unit_serial) ?? '—' },
    { label: 'Truck / Trailer', value: str(u?.truck_trailer_number) ?? '—' },
    { label: 'Customer',        value: str(insp.customer_name) ?? '—' },
    { label: 'Carrier Address', value: str(insp.carrier_address) ?? '—' },
    { label: 'License Plate',   value: str(insp.license_plate) ?? '—' },
    { label: 'Odometer / Hrs',  value: str(insp.odometer_hours) ?? '—' },
    { label: 'Location',        value: str(insp.location) ?? '—' },
    { label: 'Inspection Date', value: fmtDay(insp.inspection_date) },
    { label: 'Inspection ID',   value: inspId },
    { label: 'Inspector',       value: str(insp.inspector_name) ?? '—' },
  ]

  const categoryRows = INSPECTION_CATEGORIES.map(cat => {
    const state   = data[cat.id]
    const verdict = categoryVerdict(state)
    const items   = CATEGORY_ITEMS[cat.id] ?? []
    const failed  = items.filter(item => state?.items?.[item.id]?.result === 'fail')

    const failLines = failed.map(item => `
        <div class="fail-line">
          <span class="fail-mark">${item.safetyCritical ? '&#9888;' : '&#10007;'}</span>
          <span>${esc(item.label)}${state?.items?.[item.id]?.notes ? `<span class="fail-note">Note: ${esc(state.items[item.id].notes)}</span>` : ''}</span>
        </div>`).join('')

    return `
      <div class="cat${verdict === 'fail' ? ' cat-fail' : ''}">
        <div class="cat-head">
          <span class="cat-num">${cat.num}</span>
          <span class="cat-label">${esc(cat.label)}</span>
          <span class="badge ${VERDICT_CLASS[verdict]}">${VERDICT_LABEL[verdict]}</span>
        </div>
        ${failLines}
      </div>`
  }).join('')

  const violationBlock = violations.length ? `
  <div class="box box-fail">
    <h3>Violations Found — ${violations.length}</h3>
    ${violations.map(v => `
      <p class="viol">
        <strong>${esc(categoryLabel(String(v.category ?? '')))}</strong>${v.safetyCritical ? ' <span class="critical">&#9888; SAFETY CRITICAL</span>' : ''}<br>
        ${esc(v.label ?? v.item ?? '')}${v.notes ? `<span class="viol-note">${esc(v.notes)}</span>` : ''}
      </p>`).join('')}
  </div>` : `
  <div class="box">
    <h3>Violations</h3>
    <p class="muted">No violations recorded on this inspection.</p>
  </div>`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DOT Inspection ${esc(inspId)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #1a1a1a; background: #f5f5f5; }
  .page { background: #fff; max-width: 800px; margin: 24px auto; padding: 48px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; border-bottom: 3px solid #FF6600; padding-bottom: 20px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-icon { width: 44px; height: 44px; background: #FF6600; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
  .brand-icon svg { width: 28px; height: 28px; stroke: white; fill: none; stroke-width: 2; }
  .brand-name { font-size: 20px; font-weight: 800; letter-spacing: 1px; color: #1a1a1a; }
  .brand-sub { font-size: 11px; color: #888; margin-top: 2px; }
  .doc-meta { text-align: right; }
  .doc-number { font-size: 20px; font-weight: 700; color: #FF6600; }
  .doc-meta p { font-size: 12px; color: #555; margin-top: 4px; }
  .doc-title { font-size: 15px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; }
  .citation { font-size: 11px; color: #888; letter-spacing: 0.5px; text-transform: uppercase; }
  .result-strip { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-radius: 6px; margin-bottom: 20px; }
  .result-pass { background: #dcfce7; border: 2px solid #16a34a40; }
  .result-fail { background: #fee2e2; border: 2px solid #dc262640; }
  .result-word { font-size: 28px; font-weight: 800; letter-spacing: 1px; }
  .result-pass .result-word { color: #16a34a; }
  .result-fail .result-word { color: #dc2626; }
  .result-note { font-size: 12px; color: #555; }
  .info-box { border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 20px; }
  .info-box h3, .box h3 { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #888; }
  .info-box h3 { background: #f9f9f9; padding: 6px 12px; border-bottom: 1px solid #e5e7eb; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; }
  .fact { padding: 6px 12px; border-bottom: 1px solid #f1f1f1; border-right: 1px solid #f1f1f1; }
  .fact-label { font-size: 8px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
  .fact-value { font-size: 11px; font-weight: 600; margin-top: 2px; word-break: break-word; }
  .cat { border-bottom: 1px solid #f1f1f1; }
  .cat-fail { background: #fff8f8; }
  .cat-head { display: flex; align-items: center; gap: 8px; padding: 5px 12px; }
  .cat-num { font-size: 9px; color: #999; width: 18px; text-align: right; flex-shrink: 0; }
  .cat-label { flex: 1; font-size: 11px; }
  .badge { font-size: 9px; font-weight: 700; padding: 2px 8px; border-radius: 9px; }
  .r-pass { background: #dcfce7; color: #16a34a; }
  .r-fail { background: #fee2e2; color: #dc2626; }
  .r-na   { background: #f3f4f6; color: #6b7280; }
  .fail-line { display: flex; gap: 6px; margin-left: 38px; padding: 0 12px 5px 0; font-size: 10px; color: #b91c1c; }
  .fail-mark { flex-shrink: 0; }
  .fail-note { display: block; font-size: 9px; color: #900; margin-top: 1px; }
  .box { margin-bottom: 20px; padding: 12px; background: #f9f9f9; border: 1px solid #e5e7eb; border-radius: 6px; }
  .box-fail { background: #fff5f5; border-color: #fecaca; }
  .box h3 { margin-bottom: 8px; }
  .viol { font-size: 12px; color: #444; line-height: 1.5; margin-bottom: 8px; }
  .viol-note { display: block; color: #b91c1c; font-size: 11px; margin-top: 2px; }
  .critical { color: #d97706; font-weight: 700; font-size: 10px; }
  .muted { font-size: 12px; color: #888; }
  .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
  .sign-box { border: 1px solid #e5e7eb; border-radius: 6px; }
  .sign-box h3 { background: #f9f9f9; padding: 6px 12px; border-bottom: 1px solid #e5e7eb; }
  .sign-body { padding: 12px; }
  .sign-label { font-size: 8px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
  .sign-value { font-size: 12px; font-weight: 700; margin-bottom: 8px; }
  .sign-img { max-height: 80px; max-width: 100%; }
  .unsigned { display: inline-block; font-size: 11px; font-weight: 700; color: #b91c1c; background: #fee2e2; border: 1px solid #fecaca; border-radius: 4px; padding: 4px 10px; }
  .attest { margin-top: 10px; font-size: 9px; color: #888; line-height: 1.4; }
  .footer { margin-top: 28px; text-align: center; font-size: 11px; color: #aaa; border-top: 1px solid #e5e7eb; padding-top: 16px; }
  .no-print { text-align: center; margin-bottom: 24px; }
  .print-btn { background: #FF6600; color: white; border: none; padding: 10px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
  @media print {
    body { background: white; }
    .page { margin: 0; padding: 32px; box-shadow: none; max-width: 100%; }
    .no-print { display: none !important; }
    img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .cat { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="no-print">
  <button class="print-btn" onclick="window.print()">Download / Print PDF</button>
</div>
<div class="page">
  <div class="header">
    <div class="brand">
      <div class="brand-icon">
        <svg viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
      </div>
      <div>
        <div class="brand-name">NWI HD SUITE</div>
        <div class="brand-sub">${esc(str(profile?.business_name) ?? 'Heavy Duty Service')}</div>
      </div>
    </div>
    <div class="doc-meta">
      <div class="doc-title">Annual DOT Vehicle Inspection</div>
      <div class="citation">FMCSA 49 CFR Part 396</div>
      <div class="doc-number">${esc(inspId)}</div>
      <p>Date: ${esc(fmtDay(insp.inspection_date))}</p>
      <p>${signature ? `Electronically signed${signedAt ? ` ${esc(signedAt)}` : ''}` : 'UNSIGNED — no signature captured'}</p>
    </div>
  </div>

  <div class="result-strip ${passed ? 'result-pass' : 'result-fail'}">
    <span class="result-word">${passed ? 'PASS' : 'FAIL'}</span>
    <span class="result-note">
      ${violations.length
        ? `${violations.length} violation${violations.length === 1 ? '' : 's'} recorded`
        : 'No violations recorded'}
    </span>
  </div>

  <div class="info-box">
    <h3>Unit &amp; Inspection Information</h3>
    <div class="info-grid">
      ${factRows.map(f => `
      <div class="fact">
        <div class="fact-label">${esc(f.label)}</div>
        <div class="fact-value">${esc(f.value)}</div>
      </div>`).join('')}
    </div>
  </div>

  <div class="info-box">
    <h3>CVSA Inspection Results — ${INSPECTION_CATEGORIES.length} Categories</h3>
    ${categoryRows}
  </div>

  ${violationBlock}

  <div class="sign-grid">
    <div class="sign-box">
      <h3>Inspector Certification</h3>
      <div class="sign-body">
        <div class="sign-label">Name</div>
        <div class="sign-value">${esc(str(insp.inspector_name) ?? '—')}</div>
        <div class="sign-label">Certification #</div>
        <div class="sign-value">${esc(str(insp.inspector_cert_number) ?? '—')}</div>
        <div class="attest">
          I certify this vehicle has been inspected per FMCSA 49 CFR 396 and I am a qualified inspector
          as defined by 49 CFR 396.19.
        </div>
      </div>
    </div>
    <div class="sign-box">
      <h3>Signature</h3>
      <div class="sign-body">
        ${signature
          ? `<img class="sign-img" src="${esc(signature)}" alt="Inspector signature">
             <div class="attest">Electronically signed${signedAt ? ` ${esc(signedAt)}` : ''}.</div>`
          : `<span class="unsigned">UNSIGNED</span>
             <div class="attest">No signature was captured for this inspection. This document is a record of the
             inspection results only and is not a signed certification.</div>`}
      </div>
    </div>
  </div>

  <div class="footer">
    <p>Inspection ID: ${esc(inspId)} &bull; Generated ${esc(fmtStamp(new Date().toISOString()) ?? '')} &bull; National Wrench Index HD Suite</p>
  </div>
</div>
</body>
</html>`

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
