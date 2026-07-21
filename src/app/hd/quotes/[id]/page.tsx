import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import QuoteDetailActions from './QuoteDetailActions'

const ORANGE = '#16a34a'
const BLUE   = '#15803d'

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  draft:    { bg: '#F3F4F6', color: '#6B7280' },
  sent:     { bg: '#DBEAFE', color: '#15803d' },
  approved: { bg: '#DCFCE7', color: '#16a34a' },
  declined: { bg: '#FEE2E2', color: '#dc2626' },
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
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) redirect('/hd/signup')

  const { data: q } = await supabase
    .from('hd_quotes')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!q) notFound()

  const items: LineItem[] = Array.isArray(q.line_items) ? q.line_items : []
  const st = STATUS_STYLE[q.status] ?? STATUS_STYLE.draft

  return (
    <div style={{ background: '#F4F5F7', minHeight: '100dvh', padding: '24px 20px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-3 flex-1">
            <Link href="/hd/quotes" style={{ color: '#6B7280', fontSize: 13 }}>← Quotes</Link>
            <span style={{ color: '#E5E7EB' }}>/</span>
            <span className="font-condensed font-bold text-2xl" style={{ color: '#1A1A1A' }}>{q.quote_number}</span>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full capitalize" style={{ background: st.bg, color: st.color }}>
              {q.status}
            </span>
          </div>
          <QuoteDetailActions quoteId={q.id} quoteNumber={q.quote_number} quoteData={q} />
        </div>

        <div style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid #E5E7EB', padding: 32, marginBottom: 20 }}>

          {/* Customer + Unit Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mb-8 pb-8" style={{ borderBottom: '1px solid #E5E7EB' }}>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#9CA3AF' }}>Customer</h3>
              <p className="font-semibold text-base" style={{ color: '#1A1A1A' }}>{q.customer_name}</p>
              {q.customer_phone && <p className="text-sm mt-1" style={{ color: '#6B7280' }}>{q.customer_phone}</p>}
              {q.customer_email && <p className="text-sm" style={{ color: '#6B7280' }}>{q.customer_email}</p>}
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#9CA3AF' }}>Service Unit</h3>
              {(q.unit_manufacturer || q.unit_model) && (
                <p className="font-semibold text-base" style={{ color: '#1A1A1A' }}>{[q.unit_manufacturer, q.unit_model].filter(Boolean).join(' ')}</p>
              )}
              {q.unit_serial && <p className="text-sm mt-1" style={{ color: '#6B7280' }}>Serial: {q.unit_serial}</p>}
              {q.unit_year   && <p className="text-sm" style={{ color: '#6B7280' }}>Year: {q.unit_year}</p>}
              {(q.truck_make || q.truck_model) && (
                <p className="text-sm mt-1" style={{ color: '#6B7280' }}>
                  Truck: {[q.truck_year, q.truck_make, q.truck_model].filter(Boolean).join(' ')}
                </p>
              )}
              {q.vin && <p className="text-sm" style={{ color: '#9CA3AF' }}>VIN: {q.vin}</p>}
            </div>
          </div>

          {/* Complaint & Diagnosis */}
          {(q.complaint || q.diagnosis) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8 pb-8" style={{ borderBottom: '1px solid #E5E7EB' }}>
              {q.complaint && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#9CA3AF' }}>Complaint</h3>
                  <p className="text-sm leading-relaxed" style={{ color: '#374151' }}>{q.complaint}</p>
                </div>
              )}
              {q.diagnosis && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#9CA3AF' }}>Diagnosis</h3>
                  <p className="text-sm leading-relaxed" style={{ color: '#374151' }}>{q.diagnosis}</p>
                </div>
              )}
            </div>
          )}

          {/* Line Items */}
          <div className="mb-8">
            <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: '#9CA3AF' }}>Line Items</h3>
            {items.length === 0 ? (
              <p className="text-sm" style={{ color: '#9CA3AF' }}>No line items</p>
            ) : (
              <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
                <div className="grid text-xs font-semibold uppercase tracking-wide px-4 py-2.5" style={{ gridTemplateColumns: '70px 1fr 100px 100px 100px', background: '#F9FAFB', color: '#6B7280', borderBottom: '1px solid #E5E7EB' }}>
                  <span>Type</span><span>Description</span><span className="text-right">Hrs/Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span>
                </div>
                {items.map(item => (
                  <div key={item.id} className="grid px-4 py-3 items-center" style={{ gridTemplateColumns: '70px 1fr 100px 100px 100px', borderBottom: '1px solid #F9FAFB' }}>
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
                      {item.type === 'labor' ? `${fmt(q.labor_rate)}/hr` : fmt(item.unit_cost)}
                    </span>
                    <span className="text-sm font-semibold text-right" style={{ color: '#1A1A1A' }}>{fmt(item.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="flex justify-end mb-8">
            <div style={{ width: 280 }}>
              {[
                { label: 'Labor Subtotal', val: q.subtotal_labor },
                { label: 'Parts Subtotal', val: q.subtotal_parts },
                ...(Number(q.diagnostic_fee) > 0 ? [{ label: 'Diagnostic Fee', val: q.diagnostic_fee }] : []),
                ...(Number(q.road_call_fee) > 0 ? [{ label: 'Road Call Fee', val: q.road_call_fee }] : []),
                ...(Number(q.tax_amount) > 0 ? [{ label: `Tax (${q.tax_rate}%)`, val: q.tax_amount }] : []),
              ].map(r => (
                <div key={r.label} className="flex justify-between py-1.5 text-sm" style={{ color: '#6B7280' }}>
                  <span>{r.label}</span><span>{fmt(r.val)}</span>
                </div>
              ))}
              <div className="flex justify-between items-center pt-3 mt-1" style={{ borderTop: `2px solid ${ORANGE}` }}>
                <span className="font-bold" style={{ color: '#1A1A1A' }}>TOTAL</span>
                <span className="font-bold text-2xl" style={{ color: ORANGE }}>{fmt(q.total)}</span>
              </div>
            </div>
          </div>

          {/* Meta */}
          <div className="flex flex-wrap gap-6 text-xs" style={{ color: '#9CA3AF', borderTop: '1px solid #E5E7EB', paddingTop: 16 }}>
            <span>Created: {fmtDate(q.created_at)}</span>
            {q.valid_until && <span>Valid until: {fmtDate(q.valid_until)}</span>}
            {q.notes && <span className="flex-1">Notes: {q.notes}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
