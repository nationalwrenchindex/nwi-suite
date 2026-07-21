import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import QuoteListActions from './QuoteListActions'

const ORANGE = '#16a34a'
const BLUE   = '#15803d'

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  draft:    { bg: '#F3F4F6', color: '#6B7280' },
  sent:     { bg: '#DBEAFE', color: '#15803d' },
  approved: { bg: '#DCFCE7', color: '#16a34a' },
  declined: { bg: '#FEE2E2', color: '#dc2626' },
}

function fmt(n: number | null) {
  return `$${(n ?? 0).toFixed(2)}`
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function QuotesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) redirect('/hd/signup')

  const { data: quotes } = await supabase
    .from('hd_quotes')
    .select('id, quote_number, customer_name, unit_manufacturer, unit_model, total, status, created_at, valid_until')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  const rows = quotes ?? []

  return (
    <div style={{ background: '#F4F5F7', minHeight: '100dvh', padding: '24px 20px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="font-condensed text-3xl font-bold" style={{ color: '#1A1A1A', letterSpacing: '0.5px' }}>
              QUOTES
            </h1>
            <p style={{ color: '#6B7280', fontSize: 14, marginTop: 2 }}>
              {rows.length} quote{rows.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Link
            href="/hd/quotes/new"
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-sm text-white"
            style={{ background: ORANGE, minHeight: 44 }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Quote
          </Link>
        </div>

        {/* Table */}
        <div style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
          {rows.length === 0 ? (
            <div className="text-center py-16">
              <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="#D1D5DB" strokeWidth={1.5} viewBox="0 0 24 24">
                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p style={{ color: '#6B7280', fontSize: 15 }}>No quotes yet</p>
              <Link
                href="/hd/quotes/new"
                className="inline-block mt-4 px-5 py-2 rounded-lg font-semibold text-sm text-white"
                style={{ background: ORANGE }}
              >
                Create your first quote
              </Link>
            </div>
          ) : (
            <>
              {/* Table header */}
              <div
                className="grid gap-3 px-4 py-3 text-xs font-semibold uppercase tracking-wide"
                style={{
                  gridTemplateColumns: '140px 1fr 1fr 90px 90px 120px auto',
                  background: '#F9FAFB',
                  borderBottom: '1px solid #E5E7EB',
                  color: '#6B7280',
                }}
              >
                <span>Quote #</span>
                <span>Customer</span>
                <span>Unit</span>
                <span>Total</span>
                <span>Status</span>
                <span>Date</span>
                <span>Actions</span>
              </div>

              {/* Rows */}
              {rows.map(q => {
                const st = STATUS_STYLE[q.status] ?? STATUS_STYLE.draft
                return (
                  <div
                    key={q.id}
                    className="grid gap-3 px-4 py-3 items-center"
                    style={{
                      gridTemplateColumns: '140px 1fr 1fr 90px 90px 120px auto',
                      borderBottom: '1px solid #F3F4F6',
                    }}
                  >
                    <span className="font-mono text-xs font-semibold" style={{ color: ORANGE }}>{q.quote_number}</span>
                    <span className="text-sm font-medium truncate" style={{ color: '#1A1A1A' }}>{q.customer_name}</span>
                    <span className="text-sm truncate" style={{ color: '#6B7280' }}>
                      {[q.unit_manufacturer, q.unit_model].filter(Boolean).join(' ') || '—'}
                    </span>
                    <span className="text-sm font-semibold" style={{ color: '#1A1A1A' }}>{fmt(q.total)}</span>
                    <span>
                      <span
                        className="text-xs font-semibold px-2 py-1 rounded-full capitalize"
                        style={{ background: st.bg, color: st.color }}
                      >
                        {q.status}
                      </span>
                    </span>
                    <span className="text-xs" style={{ color: '#9CA3AF' }}>{fmtDate(q.created_at)}</span>
                    <QuoteListActions quoteId={q.id} quoteNumber={q.quote_number} />
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* Summary row */}
        {rows.length > 0 && (
          <div className="flex gap-6 mt-4">
            {(['draft','sent','approved','declined'] as const).map(s => {
              const count = rows.filter(q => q.status === s).length
              const st = STATUS_STYLE[s]
              return (
                <div key={s} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: st.color }} />
                  <span className="text-xs" style={{ color: '#6B7280' }}>
                    {count} {s}
                  </span>
                </div>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}
