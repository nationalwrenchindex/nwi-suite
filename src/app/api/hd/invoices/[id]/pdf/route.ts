// GET /api/hd/invoices/[id]/pdf — the HD invoice print copy.
//
// Self-contained HTML with a print button; this codebase has no PDF library and
// every "PDF" route works the same way. The customer's on-screen copy is a
// different template (src/components/hd/PublicInvoicePay.tsx) — shared document
// rules live in src/lib/invoice-document.ts so the two cannot drift again.

import { NextResponse, type NextRequest } from 'next/server'
import { parseBreakdown, taxDisplayRows } from '@/lib/tax'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { termsDisplay, formatDueDate } from '@/lib/hd/payment-terms'
import { AERIAL_TYPE_LABEL } from '@/lib/hd/aerial/forms'
import type { AerialInspectionType } from '@/types/aerial'
import { money } from '@/lib/format'
import {
  SHOP_BLOCK_SELECT,
  shopBlockFrom,
  serviceUnitLines,
  documentDisclaimers,
  epa608Line,
  inspectionOutcome,
  feeRows,
} from '@/lib/invoice-document'
import { extrasDisplayRows, extrasFromDocument } from '@/lib/billable-extras'

/** Everything interpolated into the HTML below goes through this first. */
function esc(v: unknown): string {
  if (v == null) return ''
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export const dynamic = 'force-dynamic'

interface LineItem {
  id: string
  type: 'labor' | 'parts'
  description: string
  book_hours?: number
  mobile_hours?: number
  part_number?: string
  quantity?: number
  unit_cost?: number
  amount: number
}

function fmt(n: number | null | undefined) {
  return `${money((n ?? 0))}`
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return new NextResponse('HD subscription required', { status: 403 })

  const { data: inv, error } = await supabase
    .from('hd_invoices')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !inv) return new NextResponse('Not found', { status: 404 })

  // Reports attached to this invoice. The customer should end up holding one
  // document that references everything performed, so the printed invoice carries
  // the report summary and an absolute link rather than leaving them to hunt.
  const [{ data: profile }, { data: pmChecklist }, { data: dotInspection }, { data: aerialInspection }] = await Promise.all([
    supabase
      .from('profiles')
      // Was 'business_name, phone' — and the phone was never even rendered. The
      // shop's logo, address and email all exist and none of them reached the
      // printed invoice.
      .select(`${SHOP_BLOCK_SELECT}, hd_epa_cert_number, default_payment_instructions`)
      .eq('id', user.id)
      .single(),
    supabase
      .from('hd_pm_checklists')
      .select('id, pm_type, created_at, removed_from_service')
      .eq('invoice_id', id)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('hd_dot_inspections')
      .select('id, inspection_id, overall_result, created_at, removed_from_service')
      .eq('invoice_id', id)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('hd_aerial_inspections')
      .select('id, inspection_id, inspection_type, overall_result, removed_from_service, inspection_date')
      .eq('invoice_id', id)
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  const origin = req.nextUrl.origin
  const attachedReports = [
    pmChecklist && {
      title:  'PM Checklist',
      detail: [
        pmChecklist.pm_type,
        // A PM checklist has no overall_result column, so only the determination
        // can be stated — and only when one was recorded.
        ...inspectionOutcome(null, pmChecklist.removed_from_service),
        fmtDate(pmChecklist.created_at),
      ].filter(Boolean).join(' · '),
      url:    `${origin}/hd/pm-checklist/${pmChecklist.id}`,
    },
    dotInspection && {
      title:  'DOT Annual Inspection',
      detail: [
        dotInspection.inspection_id,
        // A bare "FAIL" leaves the customer holding a document that does not say
        // whether the vehicle may be driven. inspectionOutcome adds the migration
        // 141 determination, and prints nothing when nobody was asked.
        ...inspectionOutcome(dotInspection.overall_result, dotInspection.removed_from_service),
        fmtDate(dotInspection.created_at),
      ].filter(Boolean).join(' · '),
      url:    `${origin}/hd/dot-inspections/${dotInspection.id}`,
    },
    aerialInspection && {
      title:  `ANSI A92 Aerial Inspection${AERIAL_TYPE_LABEL[aerialInspection.inspection_type as AerialInspectionType] ? ` — ${AERIAL_TYPE_LABEL[aerialInspection.inspection_type as AerialInspectionType]}` : ''}`,
      detail: [
        aerialInspection.inspection_id,
        // OSHA takes a critically deficient machine out of service — the customer's
        // copy has to say so plainly, not leave it inside the linked report.
        ...inspectionOutcome(aerialInspection.overall_result, aerialInspection.removed_from_service),
        fmtDate(aerialInspection.inspection_date),
      ].filter(Boolean).join(' · '),
      url:    `${origin}/hd/aerial-inspections/${aerialInspection.id}`,
    },
  ].filter(Boolean) as { title: string; detail: string; url: string }[]

  // Empty on a pre-140 invoice, which keeps the single Tax line it was printed with.
  const pdfTaxRows = taxDisplayRows(parseBreakdown((inv as { tax_breakdown?: unknown }).tax_breakdown))

  const reportsBlock = attachedReports.length ? `
  <div class="notes-box">
    <h3>Attached Reports</h3>
    ${attachedReports.map(r => `
      <p style="color:#444;line-height:1.5;font-size:13px;margin-bottom:6px">
        <strong>${r.title}</strong>${r.detail ? ` — ${r.detail}` : ''}<br>
        <a href="${r.url}" style="color:#2969B0;font-size:12px;word-break:break-all">${r.url}</a>
      </p>`).join('')}
  </div>` : ''

  const items: LineItem[] = Array.isArray(inv.line_items) ? inv.line_items : []

  const lineRows = items.map(item => {
    if (item.type === 'labor') {
      return `<tr>
        <td>${esc(item.description)}</td>
        <td>Labor</td>
        <td>${esc(item.mobile_hours ?? 0)} hrs</td>
        <td>${fmt(inv.labor_rate)}/hr</td>
        <td>${fmt(item.amount)}</td>
      </tr>`
    }
    return `<tr>
      <td>${esc(item.description)}${item.part_number ? `<br><small style="color:#666">${esc(item.part_number)}</small>` : ''}</td>
      <td>Parts</td>
      <td>${esc(item.quantity ?? 1)} ea</td>
      <td>${fmt(item.unit_cost)}</td>
      <td>${fmt(item.amount)}</td>
    </tr>`
  }).join('')

  // ── The shop block, the unit block, and what may legally be claimed ─────────
  const shop = shopBlockFrom(profile)
  const unitLines = serviceUnitLines(inv as Record<string, unknown>)
  const disclaimers = documentDisclaimers(inv as Record<string, unknown>)
  const epaCert = (profile as { hd_epa_cert_number?: string | null } | null)?.hd_epa_cert_number ?? null

  const shopLogo = shop.logoUrl
    ? `<img src="${esc(shop.logoUrl)}" alt="${esc(shop.name)}" class="brand-logo">`
    : `<div class="brand-icon">
        <svg viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
      </div>`

  // The subscriber's name leads, not NWI's. This block used to print the literal
  // string "NWI HD SUITE" at 20px with the shop relegated to a subtitle, on a
  // document the shop hands to its own customer.
  const shopBlockHtml = `
    <div class="brand">
      ${shopLogo}
      <div>
        <div class="brand-name">${esc(shop.name)}</div>
        ${shop.addressLines.map(l => `<div class="brand-sub">${esc(l)}</div>`).join('')}
        ${shop.phone  ? `<div class="brand-sub">${esc(shop.phone)}</div>` : ''}
        ${shop.email  ? `<div class="brand-sub">${esc(shop.email)}</div>` : ''}
      </div>
    </div>`

  // Rendered only when the invoice knows something about the unit. An invoice
  // auto-created from an aerial inspection knows nothing, and printed a
  // "Service Unit" heading over blank space.
  const unitBlockHtml = unitLines.length > 0 ? `
    <div class="info-box">
      <h3>Service Unit</h3>
      ${unitLines.map(l => l.label
        ? `<p class="label">${esc(l.label)}: ${esc(l.value)}</p>`
        : `<p><strong>${esc(l.value)}</strong></p>`).join('')}
    </div>` : ''

  // MANUFACTURER AND CERTIFICATION CLAIMS ARE NOW CONDITIONAL.
  // This footer used to read "EPA Section 608 certified refrigeration work" on
  // every invoice the route generated, including a DOT inspection on an
  // International tractor and an aerial lift inspection. A refrigeration
  // certification asserted on an aerial inspection is a false statement on a
  // document the customer keeps.
  const footerLines = [
    ...(disclaimers.epa608 ? [epa608Line(epaCert)] : []),
    ...disclaimers.manufacturers,
  ]
  const footerHtml = footerLines.length > 0
    ? `<div class="footer">${footerLines.map(l => `<p>${esc(l)}</p>`).join('')}</div>`
    : ''

  // HOW TO PAY. hd_invoices has no payment_instructions column of its own, so
  // this is the shop's profile default — the same value the LD invoice uses. A
  // paid or voided invoice does not ask for money.
  const payInstructions = (profile as { default_payment_instructions?: string | null } | null)
    ?.default_payment_instructions?.trim() || null
  const payBlock = payInstructions && inv.status !== 'paid' && inv.status !== 'void'
    ? `<div class="pay-box"><h3>How to Pay</h3><p>${esc(payInstructions)}</p></div>`
    : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Invoice ${inv.invoice_number}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #1a1a1a; background: #f5f5f5; }
  .page { background: #fff; max-width: 800px; margin: 24px auto; padding: 48px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; border-bottom: 3px solid #FF6600; padding-bottom: 20px; }
  .brand { display: flex; align-items: flex-start; gap: 12px; }
  .brand-icon { width: 44px; height: 44px; border: 1px solid #e5e7eb; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
  .brand-icon svg { width: 26px; height: 26px; stroke: #FF6600; fill: none; stroke-width: 2; }
  .brand-logo { height: 54px; max-width: 200px; object-fit: contain; display: block; }
  .brand-name { font-size: 20px; font-weight: 800; letter-spacing: 0.5px; color: #1a1a1a; }
  .brand-sub { font-size: 11px; color: #666; margin-top: 2px; line-height: 1.45; }
  .inv-meta { text-align: right; }
  .inv-number { font-size: 22px; font-weight: 700; color: #FF6600; }
  .inv-meta p { font-size: 12px; color: #555; margin-top: 4px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px; }
  .info-box h3 { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #888; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .info-box p { font-size: 13px; color: #1a1a1a; line-height: 1.6; }
  .info-box p.label { font-size: 11px; color: #888; }
  .section-label { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #888; margin-bottom: 6px; }
  .complaint-box { background: #f9f9f9; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; margin-bottom: 20px; }
  .complaint-box p { font-size: 13px; color: #333; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  /* PRINT-SAFE. This header was a solid #1a1a1a bar with white text on a page
     the shop's customer prints on their own paper: a full-width band of black
     toner per invoice, and on a low-ink printer the labels vanish into it. */
  thead tr { background: #ffffff; color: #1a1a1a; border-bottom: 2px solid #1a1a1a; }
  thead th { padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: #555; }
  tbody tr:nth-child(even) { background: #f9f9f9; }
  tbody td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  .totals { display: flex; justify-content: flex-end; }
  .totals-box { width: 280px; }
  .totals-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; }
  .totals-row.divider { border-top: 1px solid #e5e7eb; margin-top: 4px; padding-top: 8px; }
  /* TOTAL DUE is the largest thing on the page — bigger than the invoice number. */
  .totals-row.total { font-size: 26px; font-weight: 800; color: #FF6600; border-top: 2px solid #FF6600; margin-top: 4px; padding-top: 10px; align-items: baseline; }
  .totals-row.total span:first-child { font-size: 14px; font-weight: 700; color: #1a1a1a; text-transform: uppercase; letter-spacing: 0.5px; }
  .pay-box { margin-top: 24px; padding: 16px; border: 2px solid #FF6600; border-radius: 8px; }
  .pay-box h3 { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #888; margin-bottom: 6px; }
  .pay-box p { font-size: 13px; color: #333; line-height: 1.55; white-space: pre-wrap; }
  .notes-box { margin-top: 28px; padding: 12px; background: #f9f9f9; border-radius: 6px; border: 1px solid #e5e7eb; }
  .notes-box h3 { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #888; margin-bottom: 6px; }
  .footer { margin-top: 36px; text-align: center; font-size: 11px; color: #aaa; border-top: 1px solid #e5e7eb; padding-top: 16px; }
  .status-badge { display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; }
  .status-unpaid { background: #fee2e2; color: #dc2626; }
  .status-sent { background: #dbeafe; color: #2563eb; }
  .status-overdue { background: #fee2e2; color: #b91c1c; }
  .status-paid { background: #dcfce7; color: #16a34a; }
  .status-partial { background: #fef3c7; color: #d97706; }
  .status-void { background: #f3f4f6; color: #6b7280; }
  .due-highlight { color: #b91c1c; font-weight: 700; }
  .no-print { text-align: center; margin-bottom: 24px; }
  .print-btn { background: #FF6600; color: white; border: none; padding: 10px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
  /* Single column at phone width, and no horizontal scroll. A customer opening
     this from a text has a 360px viewport; the two-column grid and the five-column
     table both overflowed it. */
  @media (max-width: 640px) {
    .page { padding: 20px 16px; margin: 0; }
    .header { flex-direction: column; gap: 14px; }
    .inv-meta { text-align: left; }
    .info-grid { grid-template-columns: 1fr; gap: 16px; }
    .totals { justify-content: stretch; }
    .totals-box { width: 100%; }
    /* Type and Rate are derivable from the description and the amount; dropping
       them is what keeps the remaining columns readable instead of scrolling. */
    thead th:nth-child(2), tbody td:nth-child(2),
    thead th:nth-child(4), tbody td:nth-child(4) { display: none; }
    thead th, tbody td { padding: 8px 6px; font-size: 12px; }
  }
  @media print {
    body { background: white; }
    .page { margin: 0; padding: 32px; box-shadow: none; max-width: 100%; }
    .no-print { display: none !important; }
    /* Never let a browser "print backgrounds" setting put a dark fill on paper. */
    thead tr { background: #ffffff !important; color: #1a1a1a !important; }
  }
</style>
</head>
<body>
<div class="no-print">
  <button class="print-btn" onclick="window.print()">Download / Print PDF</button>
</div>
<div class="page">
  <div class="header">
    ${shopBlockHtml}
    <div class="inv-meta">
      <div class="inv-number">${inv.invoice_number}</div>
      <p>Date: ${fmtDate(inv.created_at)}</p>
      <p>Terms: ${termsDisplay(inv.payment_terms)}</p>
      ${inv.due_date ? `<p${inv.status === 'overdue' ? ' class="due-highlight"' : ''}>Payment Due: ${formatDueDate(inv.due_date)}</p>` : ''}
      <p>Status: <span class="status-badge status-${inv.status}">${inv.status}</span></p>
      ${inv.late_fee_applied && Number(inv.late_fee_amount) > 0 ? `<p class="due-highlight">Late Fee: ${fmt(inv.late_fee_amount)}</p>` : ''}
      ${inv.paid_at ? `<p>Paid: ${fmtDate(inv.paid_at)}</p>` : ''}
    </div>
  </div>

  <div class="info-grid">
    <div class="info-box">
      <h3>Bill To</h3>
      <p><strong>${esc(inv.customer_name)}</strong></p>
      ${inv.address_line1 ? `<p>${inv.has_corp_address ? '<span class="label">Billing:</span> ' : ''}${esc([inv.address_line1, inv.address_line2, [inv.city, inv.state].filter(Boolean).join(', '), inv.zip].filter(Boolean).join(', '))}</p>` : ''}
      ${inv.has_corp_address && inv.corp_address_line1 ? `<p><span class="label">Service:</span> ${esc([inv.corp_address_line1, inv.corp_address_line2, [inv.corp_city, inv.corp_state].filter(Boolean).join(', '), inv.corp_zip].filter(Boolean).join(', '))}</p>` : ''}
      ${inv.customer_phone ? `<p>${esc(inv.customer_phone)}</p>` : ''}
      ${inv.customer_email ? `<p>${esc(inv.customer_email)}</p>` : ''}
    </div>
    ${unitBlockHtml}
  </div>

  ${inv.complaint ? `
  <div style="margin-bottom:12px">
    <div class="section-label">Complaint</div>
    <div class="complaint-box"><p>${esc(inv.complaint)}</p></div>
  </div>` : ''}

  ${inv.diagnosis ? `
  <div style="margin-bottom:20px">
    <div class="section-label">Diagnosis</div>
    <div class="complaint-box"><p>${esc(inv.diagnosis)}</p></div>
  </div>` : ''}

  <table>
    <thead>
      <tr>
        <th style="width:40%">Description</th>
        <th style="width:12%">Type</th>
        <th style="width:15%">Qty / Hours</th>
        <th style="width:15%">Rate</th>
        <th style="width:18%;text-align:right">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-box">
      <div class="totals-row"><span>Labor Subtotal</span><span>${fmt(inv.subtotal_labor)}</span></div>
      <div class="totals-row"><span>Parts Subtotal</span><span>${fmt(inv.subtotal_parts)}</span></div>
      ${feeRows(inv as Record<string, unknown>).map(r => `<div class="totals-row"><span>${esc(r.label)}</span><span>${fmt(r.amount)}</span></div>`).join('')}
      ${extrasDisplayRows(extrasFromDocument(inv as Record<string, unknown>)).map(r =>
        `<div class="totals-row"><span>${esc(r.label)}${r.detail ? ` <small style="color:#888">(${esc(r.detail)})</small>` : ''}</span><span>${fmt(r.amount)}</span></div>`,
      ).join('')}
      ${pdfTaxRows.length > 0
        ? pdfTaxRows.map((r, i) => `<div class="totals-row${i === 0 ? ' divider' : ''}"><span>${r.text}</span><span>${r.taxed ? fmt(r.amount) : '—'}</span></div>`).join('')
        : Number(inv.tax_amount) > 0 ? `<div class="totals-row divider"><span>Tax (${inv.tax_rate}%)</span><span>${fmt(inv.tax_amount)}</span></div>` : ''}
      <div class="totals-row total"><span>${inv.status === 'paid' ? 'Total Paid' : inv.status === 'void' ? 'Total' : 'Total Due'}</span><span>${fmt(inv.total)}</span></div>
    </div>
  </div>

  ${payBlock}

  ${reportsBlock}

  ${inv.notes ? `
  <div class="notes-box">
    <h3>Notes</h3>
    <p style="color:#444;line-height:1.5;font-size:13px">${esc(inv.notes)}</p>
  </div>` : ''}

  ${footerHtml}
</div>
<script>
  // No auto-print — user clicks the button
</script>
</body>
</html>`

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
