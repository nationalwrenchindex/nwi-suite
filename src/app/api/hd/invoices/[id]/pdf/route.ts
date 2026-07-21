import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'

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
  return `$${(n ?? 0).toFixed(2)}`
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, phone')
    .eq('id', user.id)
    .single()

  const items: LineItem[] = Array.isArray(inv.line_items) ? inv.line_items : []

  const lineRows = items.map(item => {
    if (item.type === 'labor') {
      return `<tr>
        <td>${item.description}</td>
        <td>Labor</td>
        <td>${item.mobile_hours ?? 0} hrs</td>
        <td>${fmt(inv.labor_rate)}/hr</td>
        <td>${fmt(item.amount)}</td>
      </tr>`
    }
    return `<tr>
      <td>${item.description}${item.part_number ? `<br><small style="color:#888">${item.part_number}</small>` : ''}</td>
      <td>Parts</td>
      <td>${item.quantity ?? 1} ea</td>
      <td>${fmt(item.unit_cost)}</td>
      <td>${fmt(item.amount)}</td>
    </tr>`
  }).join('')

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
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; border-bottom: 3px solid #16a34a; padding-bottom: 20px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-icon { width: 44px; height: 44px; background: #16a34a; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
  .brand-icon svg { width: 28px; height: 28px; stroke: white; fill: none; stroke-width: 2; }
  .brand-name { font-size: 20px; font-weight: 800; letter-spacing: 1px; color: #1a1a1a; }
  .brand-sub { font-size: 11px; color: #888; margin-top: 2px; }
  .inv-meta { text-align: right; }
  .inv-number { font-size: 22px; font-weight: 700; color: #16a34a; }
  .inv-meta p { font-size: 12px; color: #555; margin-top: 4px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 28px; }
  .info-box h3 { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #888; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .info-box p { font-size: 13px; color: #1a1a1a; line-height: 1.6; }
  .info-box p.label { font-size: 11px; color: #888; }
  .section-label { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #888; margin-bottom: 6px; }
  .complaint-box { background: #f9f9f9; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; margin-bottom: 20px; }
  .complaint-box p { font-size: 13px; color: #333; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead tr { background: #1a1a1a; color: white; }
  thead th { padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; }
  tbody tr:nth-child(even) { background: #f9f9f9; }
  tbody td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  .totals { display: flex; justify-content: flex-end; }
  .totals-box { width: 280px; }
  .totals-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; }
  .totals-row.divider { border-top: 1px solid #e5e7eb; margin-top: 4px; padding-top: 8px; }
  .totals-row.total { font-size: 18px; font-weight: 700; color: #16a34a; border-top: 2px solid #16a34a; margin-top: 4px; padding-top: 10px; }
  .notes-box { margin-top: 28px; padding: 12px; background: #f9f9f9; border-radius: 6px; border: 1px solid #e5e7eb; }
  .notes-box h3 { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #888; margin-bottom: 6px; }
  .footer { margin-top: 36px; text-align: center; font-size: 11px; color: #aaa; border-top: 1px solid #e5e7eb; padding-top: 16px; }
  .status-badge { display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; }
  .status-unpaid { background: #fee2e2; color: #dc2626; }
  .status-paid { background: #dcfce7; color: #16a34a; }
  .status-partial { background: #fef3c7; color: #d97706; }
  .status-void { background: #f3f4f6; color: #6b7280; }
  .no-print { text-align: center; margin-bottom: 24px; }
  .print-btn { background: #16a34a; color: white; border: none; padding: 10px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
  @media print {
    body { background: white; }
    .page { margin: 0; padding: 32px; box-shadow: none; max-width: 100%; }
    .no-print { display: none !important; }
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
        <div class="brand-sub">${profile?.business_name ?? 'Heavy Duty Service'}</div>
      </div>
    </div>
    <div class="inv-meta">
      <div class="inv-number">${inv.invoice_number}</div>
      <p>Date: ${fmtDate(inv.created_at)}</p>
      <p>Terms: ${inv.payment_terms ?? 'Due on receipt'}</p>
      <p>Status: <span class="status-badge status-${inv.status}">${inv.status}</span></p>
      ${inv.paid_at ? `<p>Paid: ${fmtDate(inv.paid_at)}</p>` : ''}
    </div>
  </div>

  <div class="info-grid">
    <div class="info-box">
      <h3>Bill To</h3>
      <p><strong>${inv.customer_name}</strong></p>
      ${inv.customer_phone ? `<p>${inv.customer_phone}</p>` : ''}
      ${inv.customer_email ? `<p>${inv.customer_email}</p>` : ''}
    </div>
    <div class="info-box">
      <h3>Service Unit</h3>
      ${inv.unit_manufacturer || inv.unit_model ? `<p><strong>${[inv.unit_manufacturer, inv.unit_model].filter(Boolean).join(' ')}</strong></p>` : ''}
      ${inv.unit_serial ? `<p class="label">Serial: ${inv.unit_serial}</p>` : ''}
      ${inv.unit_year ? `<p class="label">Year: ${inv.unit_year}</p>` : ''}
      ${inv.truck_make || inv.truck_model ? `<p class="label">Truck: ${[inv.truck_year, inv.truck_make, inv.truck_model].filter(Boolean).join(' ')}</p>` : ''}
      ${inv.vin ? `<p class="label">VIN: ${inv.vin}</p>` : ''}
    </div>
  </div>

  ${inv.complaint ? `
  <div style="margin-bottom:12px">
    <div class="section-label">Complaint</div>
    <div class="complaint-box"><p>${inv.complaint}</p></div>
  </div>` : ''}

  ${inv.diagnosis ? `
  <div style="margin-bottom:20px">
    <div class="section-label">Diagnosis</div>
    <div class="complaint-box"><p>${inv.diagnosis}</p></div>
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
      ${Number(inv.diagnostic_fee) > 0 ? `<div class="totals-row"><span>Diagnostic Fee</span><span>${fmt(inv.diagnostic_fee)}</span></div>` : ''}
      ${Number(inv.road_call_fee) > 0 ? `<div class="totals-row"><span>Road Call Fee</span><span>${fmt(inv.road_call_fee)}</span></div>` : ''}
      ${Number(inv.tax_amount) > 0 ? `<div class="totals-row divider"><span>Tax (${inv.tax_rate}%)</span><span>${fmt(inv.tax_amount)}</span></div>` : ''}
      <div class="totals-row total"><span>TOTAL</span><span>${fmt(inv.total)}</span></div>
    </div>
  </div>

  ${inv.notes ? `
  <div class="notes-box">
    <h3>Notes</h3>
    <p style="color:#444;line-height:1.5;font-size:13px">${inv.notes}</p>
  </div>` : ''}

  <div class="footer">
    <p>National Wrench Index HD Suite &bull; EPA Section 608 certified refrigeration work &bull; All work performed by certified technicians</p>
  </div>
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
