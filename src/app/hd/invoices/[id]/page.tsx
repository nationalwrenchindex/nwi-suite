import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import InvoiceDetailActions from './InvoiceDetailActions'

const ORANGE = '#16a34a'
const BLUE   = '#15803d'

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  unpaid:  { bg: '#FEE2E2', color: '#dc2626' },
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

  const [{ data: inv }, { data: profile }] = await Promise.all([
    supabase.from('hd_invoices').select('*').eq('id', id).eq('user_id', user.id).single(),
    supabase.from('profiles').select('business_name, phone').eq('id', user.id).single(),
  ])

  if (!inv) notFound()

  const items: LineItem[] = Array.isArray(inv.line_items) ? inv.line_items : []
  const st = STATUS_STYLE[inv.status] ?? STATUS_STYLE.unpaid

  return (
    <div style={{ background: '#F4F5F7', minHeight: '100dvh', padding: '24px 20px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Page header + actions */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-3 flex-1">
            <Link href="/hd/invoices" style={{ color: '#6B7280', fontSize: 13 }}>← Invoices</Link>
            <span style={{ color: '#E5E7EB' }}>/</span>
            <span className="font-condensed font-bold text-2xl" style={{ color: '#1A1A1A' }}>{inv.invoice_number}</span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full capitalize" style={{ background: st.bg, color: st.color }}>
              {inv.status}
            </span>
          </div>
          <InvoiceDetailActions
            invoiceId={inv.id}
            invoiceNumber={inv.invoice_number}
            currentStatus={inv.status}
            customerPhone={inv.customer_phone}
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
              <p className="text-sm" style={{ color: '#6B7280' }}>Date: {fmtDate(inv.created_at)}</p>
              <p className="text-sm" style={{ color: '#6B7280' }}>Terms: {inv.payment_terms ?? 'Due on receipt'}</p>
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
                  <div className="grid text-xs font-semibold uppercase tracking-wide px-4 py-2.5" style={{ gridTemplateColumns: '70px 1fr 100px 100px 100px', background: '#1A1A1A', color: '#FFFFFF', gap: 8 }}>
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
              </div>
            </div>

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
