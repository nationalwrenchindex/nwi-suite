import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import InvoiceListActions from './InvoiceListActions'

const ORANGE = '#FF6600'

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  unpaid:  { bg: '#FEE2E2', color: '#dc2626' },
  sent:    { bg: '#DBEAFE', color: '#2563eb' },
  overdue: { bg: '#FEE2E2', color: '#b91c1c' },
  paid:    { bg: '#DCFCE7', color: '#16a34a' },
  partial: { bg: '#FEF3C7', color: '#d97706' },
  void:    { bg: '#F3F4F6', color: '#6B7280' },
}

function fmt(n: number | null) {
  return `$${(n ?? 0).toFixed(2)}`
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) redirect('/hd/signup')

  const { filter } = await searchParams

  const { data: invoices } = await supabase
    .from('hd_invoices')
    .select('id, invoice_number, customer_name, unit_manufacturer, unit_model, total, status, payment_terms, due_date, created_at, paid_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  const todayStr = new Date().toISOString().slice(0, 10)
  const allRows = invoices ?? []
  const rows = filter === 'overdue'
    ? allRows.filter(i => i.status === 'overdue' || (i.due_date && String(i.due_date) < todayStr && i.status !== 'paid' && i.status !== 'void'))
    : allRows
  const totalUnpaid = rows.filter(i => i.status === 'unpaid' || i.status === 'sent' || i.status === 'overdue').reduce((s, i) => s + (i.total ?? 0), 0)

  return (
    <div style={{ background: '#F4F5F7', minHeight: '100dvh', padding: '24px 20px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="font-condensed text-3xl font-bold" style={{ color: '#1A1A1A', letterSpacing: '0.5px' }}>
              INVOICES
            </h1>
            <p style={{ color: '#6B7280', fontSize: 14, marginTop: 2 }}>
              {filter === 'overdue' && <span className="font-semibold" style={{ color: '#b91c1c' }}>Overdue · </span>}
              {rows.length} invoice{rows.length !== 1 ? 's' : ''}
              {filter === 'overdue' && <Link href="/hd/invoices" className="ml-2 underline" style={{ color: '#6B7280' }}>show all</Link>}
              {totalUnpaid > 0 && (
                <span className="ml-3 font-semibold" style={{ color: '#dc2626' }}>
                  {fmt(totalUnpaid)} outstanding
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <Link
              href="/hd/quotes/new"
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm"
              style={{ background: '#FFFFFF', color: ORANGE, border: `1px solid ${ORANGE}`, minHeight: 44 }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Quote
            </Link>
            <Link
              href="/hd/invoices/new"
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm text-white"
              style={{ background: ORANGE, minHeight: 44 }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Invoice
            </Link>
          </div>
        </div>

        {/* Table */}
        <div style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
          {rows.length === 0 ? (
            <div className="text-center py-16">
              <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="#D1D5DB" strokeWidth={1.5} viewBox="0 0 24 24">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              <p style={{ color: '#6B7280', fontSize: 15 }}>No invoices yet</p>
              <p style={{ color: '#9CA3AF', fontSize: 13, marginTop: 4 }}>Create a direct invoice, or build a quote and convert it</p>
              <div className="flex items-center justify-center gap-3 mt-4">
                <Link
                  href="/hd/invoices/new"
                  className="inline-block px-5 py-2 rounded-lg font-semibold text-sm text-white"
                  style={{ background: ORANGE }}
                >
                  Create an invoice
                </Link>
                <Link
                  href="/hd/quotes/new"
                  className="inline-block px-5 py-2 rounded-lg font-semibold text-sm"
                  style={{ background: '#FFFFFF', color: ORANGE, border: `1px solid ${ORANGE}` }}
                >
                  Create a quote
                </Link>
              </div>
            </div>
          ) : (
            <>
              {/* Desktop table (md+) */}
              <div className="hidden md:block">
                <div
                  className="grid gap-3 px-4 py-3 text-xs font-semibold uppercase tracking-wide"
                  style={{ gridTemplateColumns: '160px 1fr 1fr 90px 90px 120px auto', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', color: '#6B7280' }}
                >
                  <span>Invoice #</span>
                  <span>Customer</span>
                  <span>Unit</span>
                  <span>Total</span>
                  <span>Status</span>
                  <span>Date</span>
                  <span>Actions</span>
                </div>
                {rows.map(inv => {
                  const st = STATUS_STYLE[inv.status] ?? STATUS_STYLE.unpaid
                  return (
                    <div
                      key={inv.id}
                      className="grid gap-3 px-4 py-3 items-center"
                      style={{ gridTemplateColumns: '160px 1fr 1fr 90px 90px 120px auto', borderBottom: '1px solid #F3F4F6' }}
                    >
                      <span className="font-mono text-xs font-semibold" style={{ color: ORANGE }}>{inv.invoice_number}</span>
                      <span className="text-sm font-medium truncate" style={{ color: '#1A1A1A' }}>{inv.customer_name}</span>
                      <span className="text-sm truncate" style={{ color: '#6B7280' }}>
                        {[inv.unit_manufacturer, inv.unit_model].filter(Boolean).join(' ') || '—'}
                      </span>
                      <span className="text-sm font-semibold" style={{ color: '#1A1A1A' }}>{fmt(inv.total)}</span>
                      <span>
                        <span className="text-xs font-semibold px-2 py-1 rounded-full capitalize" style={{ background: st.bg, color: st.color }}>
                          {inv.status}
                        </span>
                      </span>
                      <span className="text-xs" style={{ color: '#9CA3AF' }}>
                        {inv.status === 'paid' && inv.paid_at ? fmtDate(inv.paid_at) : fmtDate(inv.created_at)}
                      </span>
                      <InvoiceListActions invoiceId={inv.id} invoiceNumber={inv.invoice_number} currentStatus={inv.status} />
                    </div>
                  )
                })}
              </div>

              {/* Mobile cards (below md) */}
              <div className="block md:hidden">
                {rows.map(inv => {
                  const st = STATUS_STYLE[inv.status] ?? STATUS_STYLE.unpaid
                  const unit = [inv.unit_manufacturer, inv.unit_model].filter(Boolean).join(' ')
                  return (
                    <div key={inv.id} className="p-4" style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-mono text-xs font-semibold" style={{ color: ORANGE }}>{inv.invoice_number}</span>
                        <span className="text-xs font-semibold px-2 py-1 rounded-full capitalize" style={{ background: st.bg, color: st.color }}>{inv.status}</span>
                      </div>
                      <p className="text-sm font-medium" style={{ color: '#1A1A1A' }}>{inv.customer_name}</p>
                      {unit && <p className="text-xs" style={{ color: '#6B7280' }}>{unit}</p>}
                      <p className="text-sm mt-1" style={{ color: '#1A1A1A' }}>
                        <span className="font-semibold">{fmt(inv.total)}</span>
                        <span style={{ color: '#9CA3AF' }}> • {inv.status === 'paid' && inv.paid_at ? fmtDate(inv.paid_at) : fmtDate(inv.created_at)}</span>
                      </p>
                      <div className="mt-3">
                        <InvoiceListActions invoiceId={inv.id} invoiceNumber={inv.invoice_number} currentStatus={inv.status} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Summary */}
        {rows.length > 0 && (
          <div className="flex gap-6 mt-4">
            {(['unpaid','sent','overdue','paid','partial','void'] as const).map(s => {
              const count = rows.filter(i => i.status === s).length
              const st = STATUS_STYLE[s]
              return (
                <div key={s} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: st.color }} />
                  <span className="text-xs" style={{ color: '#6B7280' }}>{count} {s}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
