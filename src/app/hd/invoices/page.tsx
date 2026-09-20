import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import {
  HD_INVOICE_LIST_SELECT,
  HD_INVOICE_PAGE_SIZE,
  HD_INVOICE_STATUSES,
  applyHDInvoiceListFilter,
  type HDInvoiceListRow,
} from '@/app/api/hd/invoices/list'
import InvoiceList from './InvoiceList'

const ORANGE = '#FF6600'

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  unpaid:  { bg: '#FEE2E2', color: '#dc2626' },
  sent:    { bg: '#DBEAFE', color: '#2563eb' },
  overdue: { bg: '#FEE2E2', color: '#b91c1c' },
  paid:    { bg: '#DCFCE7', color: '#16a34a' },
  partial: { bg: '#FEF3C7', color: '#d97706' },
  void:    { bg: '#F3F4F6', color: '#6B7280' },
}

/** Statuses that still owe money — the "outstanding" figure in the header. */
const OUTSTANDING_STATUSES = new Set(['unpaid', 'sent', 'overdue'])

function fmt(n: number) {
  return `$${n.toFixed(2)}`
}

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) redirect('/hd/signup')

  const { filter } = await searchParams
  const listFilter = filter === 'overdue' ? 'overdue' : null

  // The list is paged. It previously pulled a flat .limit(200) and filtered
  // "overdue" in memory, which stopped being honest the moment a tech crossed
  // 200 invoices — and PostgREST would have capped it at 1,000 regardless.
  //
  // Three separate reads, all carrying the same filter so they describe the same
  // set of rows:
  //   1. the first page of rows;
  //   2. an exact/head count, which is the header total — it stays correct no
  //      matter how few rows are actually loaded;
  //   3. status + total for every matching invoice, paged to exhaustion, which is
  //      what the outstanding figure and the status strip are summed from. This
  //      cannot be a PostgREST aggregate: this project's API rejects those with
  //      PGRST123, so the rows have to come back and be added up here.
  const [{ data: invoices }, { count: invoiceCount }, summaryRows] = await Promise.all([
    applyHDInvoiceListFilter(
      supabase.from('hd_invoices').select(HD_INVOICE_LIST_SELECT).eq('user_id', user.id),
      listFilter,
    )
      // Must match the API's ordering exactly, or the offsets the client sends
      // would page through a different sequence than this first page came from.
      .order('created_at', { ascending: false })
      .order('id',         { ascending: false })
      .range(0, HD_INVOICE_PAGE_SIZE - 1),

    applyHDInvoiceListFilter(
      supabase.from('hd_invoices').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      listFilter,
    ),

    fetchAllRows<{ status: string; total: number | null }>((from, to) =>
      applyHDInvoiceListFilter(
        supabase.from('hd_invoices').select('status, total').eq('user_id', user.id),
        listFilter,
      )
        .order('created_at', { ascending: false })
        .order('id',         { ascending: false })
        .range(from, to),
    ),
  ])

  const rows  = (invoices ?? []) as HDInvoiceListRow[]
  const total = invoiceCount ?? rows.length

  const totalUnpaid = summaryRows
    .filter(i => OUTSTANDING_STATUSES.has(i.status))
    .reduce((s, i) => s + Number(i.total ?? 0), 0)

  const statusCounts = summaryRows.reduce<Record<string, number>>((acc, i) => {
    acc[i.status] = (acc[i.status] ?? 0) + 1
    return acc
  }, {})

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
              {listFilter === 'overdue' && <span className="font-semibold" style={{ color: '#b91c1c' }}>Overdue · </span>}
              {total.toLocaleString()} invoice{total !== 1 ? 's' : ''}
              {listFilter === 'overdue' && <Link href="/hd/invoices" className="ml-2 underline" style={{ color: '#6B7280' }}>show all</Link>}
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

        {/* Table.
            key: switching between all and overdue is a URL navigation, not a
            remount, so without it the client would keep the previous filter's
            accumulated rows and append the new filter's pages onto them. total is
            in the key so a newly created invoice re-seeds the list too. */}
        <InvoiceList
          key={`${listFilter ?? 'all'}:${total}`}
          initialRows={rows}
          total={total}
          filter={listFilter}
        />

        {/* Summary — counted across every matching invoice, not just the loaded page. */}
        {total > 0 && (
          <div className="flex gap-6 mt-4">
            {HD_INVOICE_STATUSES.map(s => (
              <div key={s} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: STATUS_STYLE[s].color }} />
                <span className="text-xs" style={{ color: '#6B7280' }}>{statusCounts[s] ?? 0} {s}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
