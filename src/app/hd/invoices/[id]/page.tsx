import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import InvoiceDetailActions from './InvoiceDetailActions'
import { termsDisplay, formatDueDate } from '@/lib/hd/payment-terms'
import { AERIAL_TYPE_LABEL } from '@/lib/hd/aerial/forms'
import { findInvoicePMChecklists } from '@/lib/hd/pm-report-attachment'
import { resolveLateFeeSettings, assessLateFee, lateFeeBlockMessage } from '@/lib/hd/late-fee'
import type { AerialInspectionType } from '@/types/aerial'

const ORANGE = '#FF6600'
const BLUE   = '#2969B0'

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  unpaid:  { bg: '#FEE2E2', color: '#dc2626' },
  sent:    { bg: '#DBEAFE', color: '#2563eb' },
  overdue: { bg: '#FEE2E2', color: '#b91c1c' },
  paid:    { bg: '#DCFCE7', color: '#16a34a' },
  partial: { bg: '#FEF3C7', color: '#d97706' },
  void:    { bg: '#F3F4F6', color: '#6B7280' },
}

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
  return new Date(s).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) redirect('/hd/signup')

  const [{ data: inv }, { data: profile }, { data: dotInspection }, { data: aerialInspection }] = await Promise.all([
    supabase.from('hd_invoices').select('*').eq('id', id).eq('user_id', user.id).single(),
    supabase.from('profiles').select('business_name, phone').eq('id', user.id).single(),
    supabase.from('hd_dot_inspections').select('id, inspection_id, overall_result').eq('invoice_id', id).eq('user_id', user.id).maybeSingle(),
    supabase.from('hd_aerial_inspections').select('id, inspection_type, overall_result, removed_from_service').eq('invoice_id', id).eq('user_id', user.id).maybeSingle(),
  ])

  if (!inv) notFound()

  // PMs reach an invoice two ways — attached directly, or performed on the same work
  // order. The second link is the newer writer, and a PM that used only that one was
  // invisible here. Runs after the invoice because it needs the invoice's work_order_id,
  // and returns a list because one job can carry several PMs.
  const pmChecklists = await findInvoicePMChecklists(
    supabase, user.id, id, (inv.work_order_id as string | null) ?? null,
  )

  const items: LineItem[] = Array.isArray(inv.line_items) ? inv.line_items : []
  const st = STATUS_STYLE[inv.status] ?? STATUS_STYLE.unpaid

  // Late fee, computed by the same module the send route charges from
  // (src/lib/hd/late-fee.ts), off the same late_fee_settings row the nightly cron
  // reads. The number shown here is therefore the number that gets charged — if
  // this page did its own arithmetic the tech could be quoted one figure and the
  // customer billed another.
  const lateFeeSettings   = await resolveLateFeeSettings(supabase, user.id)
  const lateFee           = assessLateFee(inv, lateFeeSettings, new Date())
  const lateFeeApplied    = Boolean(inv.late_fee_applied) && Number(inv.late_fee_amount) > 0
  // The rate recorded on the row (migration 130) is what actually produced the
  // charge; settings may have moved since. undefined on a pre-130 database.
  const appliedRate       = inv.late_fee_percentage == null ? null : Number(inv.late_fee_percentage)

  return (
    <div style={{ background: '#F4F5F7', minHeight: '100dvh', padding: '24px 20px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Page header + actions */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-3 flex-1">
            <Link href="/hd/invoices" style={{ color: '#6B7280', fontSize: 13 }}>← Invoices</Link>
            <span style={{ color: '#E5E7EB' }}>/</span>
            <span className="font-condensed font-bold text-2xl" style={{ color: '#1A1A1A' }}>{inv.invoice_number}</span>
            {/* Work order this invoice was converted from. The number is denormalized,
                so it survives the work order being deleted — only then is it not a link. */}
            {inv.work_order_number && (
              inv.work_order_id ? (
                <Link href={`/hd/work-orders/${inv.work_order_id}`} className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: '#FFF7ED', color: ORANGE }}>
                  {inv.work_order_number}
                </Link>
              ) : (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: '#FFF7ED', color: ORANGE }}>
                  {inv.work_order_number}
                </span>
              )
            )}
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full capitalize" style={{ background: st.bg, color: st.color }}>
              {inv.status}
            </span>

            {/* OVERDUE is a fact about the calendar, not a status. An invoice can sit
                at 'sent' for sixty days and nothing moves it to 'overdue' until the
                cron touches it — and the cron has never run. This badge is computed
                from due_date on every render, so the tech sees the truth today. */}
            {lateFee.isOverdue && !lateFeeApplied && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: '#FEE2E2', color: '#b91c1c' }}>
                Overdue {lateFee.daysOverdue}d
              </span>
            )}

            {lateFeeApplied && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: '#FEF3C7', color: '#92400e' }}>
                Late fee applied · {fmt(inv.late_fee_amount)}
              </span>
            )}
          </div>
          <InvoiceDetailActions
            invoiceId={inv.id}
            invoiceNumber={inv.invoice_number}
            currentStatus={inv.status}
            customerPhone={inv.customer_phone}
            customerEmail={(inv.customer_email as string | null) ?? null}
            /* The modal offers "Resend with Late Fee" only when this says it can be
               charged, and prints lateFeeBlockedReason instead when it cannot. Both
               come from the shared calculator, so the amount on the button is the
               amount the send route writes. */
            lateFeeChargeable={lateFee.chargeable}
            lateFeeAmount={lateFee.feeAmount}
            lateFeeDaysOverdue={lateFee.daysOverdue}
            lateFeePercentage={lateFee.percentage}
            lateFeeBlockedReason={lateFee.chargeable ? null : lateFeeBlockMessage(lateFee)}
            lateFeeAlreadyApplied={lateFeeApplied}
            pmChecklistId={pmChecklists[0]?.id ?? null}
            dotInspectionId={dotInspection?.id ?? null}
            aerialInspectionId={aerialInspection?.id ?? null}
            /* Columns arrive in migration 129. Reading them off a row that predates it
               yields undefined, which these defaults absorb — the page renders either way. */
            sentCount={(inv.sent_count as number) ?? 0}
            lastSentAt={(inv.last_sent_at as string | null) ?? null}
          />
        </div>

        {/* Invoice document */}
        <div style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid #E5E7EB', overflow: 'hidden' }}>

          {/* Invoice header bar */}
          <div className="flex items-center justify-between px-8 py-6" style={{ borderBottom: `3px solid ${ORANGE}` }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: ORANGE }}>
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <rect x="1" y="3" width="15" height="13" rx="2" />
                  <path d="M16 8h4l3 5v3h-7V8z" />
                  <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
                </svg>
              </div>
              <div>
                <p className="font-condensed font-bold text-lg tracking-wide" style={{ color: '#1A1A1A' }}>NWI HD SUITE</p>
                <p className="text-xs" style={{ color: '#9CA3AF' }}>{profile?.business_name ?? 'Heavy Duty Service'}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-bold text-xl" style={{ color: ORANGE }}>{inv.invoice_number}</p>
              {inv.work_order_number && (
                <p className="text-sm" style={{ color: '#6B7280' }}>Work Order: {inv.work_order_number}</p>
              )}
              <p className="text-sm" style={{ color: '#6B7280' }}>Date: {fmtDate(inv.created_at)}</p>
              <p className="text-sm" style={{ color: '#6B7280' }}>Terms: {termsDisplay(inv.payment_terms)}</p>
              {inv.due_date && (
                <p className="text-sm font-semibold" style={{ color: inv.status === 'overdue' ? '#b91c1c' : '#6B7280' }}>Payment Due: {formatDueDate(inv.due_date)}</p>
              )}
              {lateFeeApplied && (
                <p className="text-sm font-semibold" style={{ color: '#b91c1c' }}>
                  Late Fee: {fmt(inv.late_fee_amount)}
                  {/* The rate is printed from the invoice's own record of it, not from
                      current settings — that is what makes the charge explainable to a
                      customer months later even if the tech has since changed it. */}
                  {appliedRate != null && appliedRate > 0 && (
                    <span style={{ color: '#9CA3AF', fontWeight: 400 }}> ({appliedRate}%/mo)</span>
                  )}
                </p>
              )}
              {inv.paid_at && (
                <p className="text-sm font-semibold" style={{ color: '#16a34a' }}>Paid: {fmtDate(inv.paid_at)}</p>
              )}
            </div>
          </div>

          <div className="px-8 py-6">

            {/* Bill To + Unit Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mb-8 pb-8" style={{ borderBottom: '1px solid #E5E7EB' }}>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#9CA3AF' }}>Bill To</h3>
                <p className="font-semibold text-base" style={{ color: '#1A1A1A' }}>{inv.customer_name}</p>
                {inv.address_line1 && (
                  <p className="text-sm mt-1" style={{ color: '#6B7280' }}>
                    {inv.has_corp_address && <span style={{ color: '#9CA3AF' }}>Billing: </span>}
                    {[inv.address_line1, inv.address_line2, [inv.city, inv.state].filter(Boolean).join(', '), inv.zip].filter(Boolean).join(', ')}
                  </p>
                )}
                {inv.has_corp_address && inv.corp_address_line1 && (
                  <p className="text-sm" style={{ color: '#6B7280' }}>
                    <span style={{ color: '#9CA3AF' }}>Service: </span>
                    {[inv.corp_address_line1, inv.corp_address_line2, [inv.corp_city, inv.corp_state].filter(Boolean).join(', '), inv.corp_zip].filter(Boolean).join(', ')}
                  </p>
                )}
                {inv.customer_phone && <p className="text-sm mt-1" style={{ color: '#6B7280' }}>{inv.customer_phone}</p>}
                {inv.customer_email && <p className="text-sm" style={{ color: '#6B7280' }}>{inv.customer_email}</p>}
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#9CA3AF' }}>Service Unit</h3>
                {(inv.unit_manufacturer || inv.unit_model) && (
                  <p className="font-semibold text-base" style={{ color: '#1A1A1A' }}>
                    {[inv.unit_manufacturer, inv.unit_model].filter(Boolean).join(' ')}
                  </p>
                )}
                {inv.unit_serial && <p className="text-sm mt-1" style={{ color: '#6B7280' }}>Serial: {inv.unit_serial}</p>}
                {inv.unit_year   && <p className="text-sm" style={{ color: '#6B7280' }}>Year: {inv.unit_year}</p>}
                {(inv.truck_make || inv.truck_model) && (
                  <p className="text-sm mt-1" style={{ color: '#6B7280' }}>
                    Truck: {[inv.truck_year, inv.truck_make, inv.truck_model].filter(Boolean).join(' ')}
                  </p>
                )}
                {inv.vin && <p className="text-sm" style={{ color: '#9CA3AF' }}>VIN: {inv.vin}</p>}
              </div>
            </div>

            {/* Complaint + Diagnosis */}
            {(inv.complaint || inv.diagnosis) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8 pb-8" style={{ borderBottom: '1px solid #E5E7EB' }}>
                {inv.complaint && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#9CA3AF' }}>Complaint</h3>
                    <p className="text-sm leading-relaxed" style={{ color: '#374151' }}>{inv.complaint}</p>
                  </div>
                )}
                {inv.diagnosis && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#9CA3AF' }}>Diagnosis</h3>
                    <p className="text-sm leading-relaxed" style={{ color: '#374151' }}>{inv.diagnosis}</p>
                  </div>
                )}
              </div>
            )}

            {/* Line Items */}
            <div className="mb-8">
              <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#9CA3AF' }}>Services &amp; Parts</h3>
              {items.length === 0 ? (
                <p className="text-sm" style={{ color: '#9CA3AF' }}>No line items</p>
              ) : (
                <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
                  {/* Desktop table (md+) */}
                  <div className="hidden md:block">
                    <div className="grid text-xs font-semibold uppercase tracking-wide px-4 py-2.5" style={{ gridTemplateColumns: '70px 1fr 100px 100px 100px', background: '#1A1A1A', color: 'var(--hd-text)', gap: 8 }}>
                      <span>Type</span><span>Description</span><span className="text-right">Hrs/Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span>
                    </div>
                    {items.map(item => (
                      <div key={item.id} className="grid px-4 py-3 items-center" style={{ gridTemplateColumns: '70px 1fr 100px 100px 100px', gap: 8, borderBottom: '1px solid #F9FAFB' }}>
                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold w-fit" style={item.type === 'labor' ? { background: '#FFF7ED', color: ORANGE } : { background: '#EBF5FF', color: BLUE }}>
                          {item.type}
                        </span>
                        <div>
                          <span className="text-sm" style={{ color: '#1A1A1A' }}>{item.description}</span>
                          {item.part_number && <span className="block text-xs font-mono" style={{ color: '#9CA3AF' }}>{item.part_number}</span>}
                        </div>
                        <span className="text-sm text-right" style={{ color: '#6B7280' }}>
                          {item.type === 'labor' ? `${item.mobile_hours}h` : `${item.quantity}×`}
                        </span>
                        <span className="text-sm text-right" style={{ color: '#6B7280' }}>
                          {item.type === 'labor' ? `${fmt(inv.labor_rate)}/hr` : fmt(item.unit_cost)}
                        </span>
                        <span className="text-sm font-semibold text-right" style={{ color: '#1A1A1A' }}>{fmt(item.amount)}</span>
                      </div>
                    ))}
                  </div>

                  {/* Mobile cards (below md) */}
                  <div className="block md:hidden">
                    {items.map(item => (
                      <div key={item.id} className="px-4 py-3" style={{ borderBottom: '1px solid #F3F4F6' }}>
                        <div className="flex items-start gap-2">
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0" style={item.type === 'labor' ? { background: '#FFF7ED', color: ORANGE } : { background: '#EBF5FF', color: BLUE }}>
                            {item.type}
                          </span>
                          <div className="min-w-0">
                            <span className="text-sm" style={{ color: '#1A1A1A' }}>{item.description}</span>
                            {item.part_number && <span className="block text-xs font-mono" style={{ color: '#9CA3AF' }}>{item.part_number}</span>}
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-2 text-xs" style={{ color: '#6B7280' }}>
                          <span>
                            {item.type === 'labor'
                              ? `${item.mobile_hours}h · ${fmt(inv.labor_rate)}/hr`
                              : `${item.quantity} × ${fmt(item.unit_cost)}`}
                          </span>
                          <span className="text-sm font-semibold" style={{ color: '#1A1A1A' }}>{fmt(item.amount)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Totals */}
            <div className="flex justify-end mb-8">
              <div style={{ width: 300 }}>
                {[
                  { label: 'Labor Subtotal', val: inv.subtotal_labor },
                  { label: 'Parts Subtotal', val: inv.subtotal_parts },
                  ...(Number(inv.diagnostic_fee) > 0 ? [{ label: 'Diagnostic Fee', val: inv.diagnostic_fee }] : []),
                  ...(Number(inv.road_call_fee) > 0 ? [{ label: 'Road Call Fee', val: inv.road_call_fee }] : []),
                  ...(Number(inv.tax_amount) > 0 ? [{ label: `Tax (${inv.tax_rate}%)`, val: inv.tax_amount }] : []),
                ].map(r => (
                  <div key={r.label} className="flex justify-between py-2 text-sm" style={{ color: '#6B7280', borderBottom: '1px solid #F3F4F6' }}>
                    <span>{r.label}</span><span>{fmt(r.val)}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center py-3" style={{ borderTop: `2px solid ${ORANGE}`, marginTop: 4 }}>
                  <span className="font-bold text-base" style={{ color: '#1A1A1A' }}>TOTAL DUE</span>
                  <span className="font-bold text-3xl" style={{ color: ORANGE }}>{fmt(inv.total)}</span>
                </div>

                {/* NOT yet charged, and deliberately outside the totals column above —
                    the customer's copy must not imply a fee that has not been added.
                    This is the quote for what "Resend with Late Fee" would add, shown
                    to the tech so the decision is made with the number in front of them. */}
                {lateFee.chargeable && (
                  <div className="mt-3 p-3 rounded-lg" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#92400e' }}>
                        Late fee available
                      </span>
                      <span className="text-base font-bold" style={{ color: '#92400e' }}>{fmt(lateFee.feeAmount)}</span>
                    </div>
                    <p className="text-xs mt-1" style={{ color: '#a16207' }}>
                      {lateFee.daysOverdue} day{lateFee.daysOverdue === 1 ? '' : 's'} past due
                      {lateFee.percentage != null ? ` · ${lateFee.percentage}% per month` : ' · flat fee'}
                      {lateFeeSettings.isDefault ? ' (default — not yet configured in Settings)' : ''}.
                      Not charged until you choose “Resend with Late Fee”.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Attached reports (PM checklist / DOT inspection) */}
            {(pmChecklists.length > 0 || dotInspection || aerialInspection) && (
              <div className="mb-8">
                <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
                  <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>Attached Reports</h3>
                  {/* The printed invoice carries these too, so the customer ends up
                      with one document that links out to every report. */}
                  <a
                    href={`/api/hd/invoices/${inv.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold"
                    style={{ color: BLUE }}
                  >
                    Print invoice with reports →
                  </a>
                </div>
                <div className="space-y-2">
                  {pmChecklists.map(pm => (
                    <div key={pm.id} className="flex items-center justify-between gap-3 p-4 rounded-lg flex-wrap" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: '#1A1A1A' }}>📋 PM Checklist</p>
                        <p className="text-xs" style={{ color: '#6B7280' }}>
                          Preventive Maintenance report attached{pm.pm_type ? ` — ${pm.pm_type}` : ''} · {fmtDate(pm.completed_at ?? pm.created_at)}
                        </p>
                        {/* The pass/fail split comes from the same join the report itself is
                            built from, so this line can never disagree with the document. */}
                        <p className="text-xs mt-0.5" style={{ color: pm.report.failed > 0 ? '#b91c1c' : '#16a34a' }}>
                          {pm.report.total} inspected · {pm.report.passed} pass · {pm.report.failed} fail · {pm.report.na} N/A
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <Link href={`/hd/pm-checklist/${pm.id}`} className="text-sm font-semibold" style={{ color: BLUE }}>View →</Link>
                        <a href={`/api/hd/pm-checklist/${pm.id}/pdf`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold" style={{ color: BLUE }}>
                          Print PM report →
                        </a>
                      </div>
                    </div>
                  ))}
                  {dotInspection && (
                    <Link href={`/hd/dot-inspections/${dotInspection.id}`} className="flex items-center justify-between p-4 rounded-lg" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: '#1A1A1A' }}>🔍 DOT Inspection</p>
                        <p className="text-xs" style={{ color: '#6B7280' }}>Annual CVSA inspection attached{dotInspection.overall_result ? ` — ${String(dotInspection.overall_result).toUpperCase()}` : ''}</p>
                      </div>
                      <span className="text-sm font-semibold" style={{ color: BLUE }}>View DOT Inspection →</span>
                    </Link>
                  )}
                  {aerialInspection && (
                    <Link href={`/hd/aerial-inspections/${aerialInspection.id}`} className="flex items-center justify-between p-4 rounded-lg" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: '#1A1A1A' }}>🏗 Aerial Inspection</p>
                        <p className="text-xs" style={{ color: '#6B7280' }}>
                          ANSI A92 {AERIAL_TYPE_LABEL[aerialInspection.inspection_type as AerialInspectionType] ?? ''} inspection attached
                          {aerialInspection.overall_result ? ` — ${String(aerialInspection.overall_result).toUpperCase()}` : ''}
                        </p>
                        {/* OSHA requires a machine with a critical deficiency be taken out of
                            service — that belongs on the customer's copy, not buried in the report. */}
                        {aerialInspection.removed_from_service && (
                          <p className="text-xs font-semibold mt-0.5" style={{ color: '#dc2626' }}>Machine removed from service</p>
                        )}
                      </div>
                      <span className="text-sm font-semibold" style={{ color: BLUE }}>View Aerial Inspection →</span>
                    </Link>
                  )}
                </div>
              </div>
            )}

            {/* Notes */}
            {inv.notes && (
              <div className="p-4 rounded-lg mb-6" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                <h3 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#9CA3AF' }}>Notes</h3>
                <p className="text-sm leading-relaxed" style={{ color: '#374151' }}>{inv.notes}</p>
              </div>
            )}

            {/* Footer */}
            <p className="text-center text-xs" style={{ color: '#9CA3AF' }}>
              National Wrench Index HD Suite &bull; EPA Section 608 certified refrigeration work &bull; All work performed by certified technicians
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
