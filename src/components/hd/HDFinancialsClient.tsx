'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface OverviewStats {
  totalRevenue:    number
  outstandingTotal: number
  avgJobValue:     number
  totalLaborHours: number
  laborRevenue:    number
  laborPct:        number
  hourlyRate:      number
  closedCount:     number
  accountRows:     { name: string; revenue: number; count: number }[]
  periodLabel:     string
  periodParam:     string
}

interface HDInvoice {
  id:               string
  invoice_number:   string | null
  customer_name:    string | null
  unit_manufacturer: string | null
  unit_model:       string | null
  total:            number | null
  // Mirrors the hd_invoices status CHECK as widened by migration 077. Keeping this
  // narrower than the DB is what hid the missing 'sent'/'overdue' colour entries
  // from the compiler and crashed /hd/financials at runtime.
  status:           'unpaid' | 'sent' | 'paid' | 'partial' | 'void' | 'overdue'
  created_at:       string
  paid_at:          string | null
}

interface HDQuote {
  id:               string
  quote_number:     string | null
  customer_name:    string | null
  unit_manufacturer: string | null
  unit_model:       string | null
  total:            number | null
  // Mirrors the hd_quotes status CHECK (migration 057). Reads through statusCfg()
  // so a future widening of that CHECK degrades to a grey pill instead of a crash.
  status:           'draft' | 'sent' | 'approved' | 'declined'
  created_at:       string
  valid_until:      string | null
}

// Shape of GET /api/hd/financials/summary. Every cost-derived field is nullable
// because HD cost only exists on invoices written since markup tracking shipped —
// null means "not known", and it must reach the screen as that rather than as 0.
interface CostSummary {
  total_revenue:           number
  parts_revenue:           number
  labor_revenue:           number
  cogs_total:              number | null
  cogs_known:              number
  cogs_unknown:            number
  cogs_partial:            boolean
  revenue_with_known_cost: number
  gross_profit:            number | null
  gross_margin:            number | null
  invoice_count:           number
}

interface HDExpense {
  id:           string
  category:     string
  description:  string
  amount:       number
  expense_date: string
  notes:        string | null
}

type Tab = 'overview' | 'invoices' | 'quotes' | 'expenses' | 'pl'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview',  label: 'Overview'  },
  { id: 'invoices',  label: 'Invoices'  },
  { id: 'quotes',    label: 'Quotes'    },
  { id: 'expenses',  label: 'Expenses'  },
  { id: 'pl',        label: 'P&L'       },
]

const EXPENSE_CATEGORIES = [
  'Parts', 'Tools', 'Fuel', 'Vehicle', 'Insurance', 'Supplies', 'Marketing', 'Software', 'Office', 'Other'
]

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) { return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` }
function fmtDate(iso: string) { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }

function StatCard({ label, value, sub, color = 'white' }: { label: string; value: string; sub?: string; color?: string }) {
  const textColor = color === 'orange' ? HD_ORANGE : color === 'blue' ? '#60A5FA' : color === 'green' ? '#22C55E' : color === 'red' ? '#EF4444' : '#ffffff'
  return (
    <div className="rounded-xl p-5 flex flex-col gap-1" style={{ background: '#111920', border: '1px solid #1e3040' }}>
      <p className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</p>
      <p className="font-condensed font-bold text-3xl leading-none" style={{ color: textColor }}>{value}</p>
      {sub && <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{sub}</p>}
    </div>
  )
}

interface StatusCfg { label: string; color: string; bg: string }

const INVOICE_STATUS: Record<HDInvoice['status'], StatusCfg> = {
  unpaid:  { label: 'Unpaid',  color: '#EF4444', bg: '#EF444420' },
  // Same blue the quote map uses for 'sent', so "sent" means one thing site-wide.
  sent:    { label: 'Sent',    color: '#60A5FA', bg: '#60A5FA20' },
  paid:    { label: 'Paid',    color: '#22C55E', bg: '#22C55E20' },
  partial: { label: 'Partial', color: '#F59E0B', bg: '#F59E0B20' },
  void:    { label: 'Void',    color: '#6B7280', bg: '#6B728020' },
  // Deeper red than unpaid (#EF4444) plus a heavier background tint, so overdue
  // reads as an escalation of unpaid rather than a different colour of the same thing.
  overdue: { label: 'Overdue', color: '#DC2626', bg: '#DC262640' },
}

const QUOTE_STATUS: Record<HDQuote['status'], StatusCfg> = {
  draft:    { label: 'Draft',    color: '#6B7280', bg: '#6B728020' },
  sent:     { label: 'Sent',     color: '#60A5FA', bg: '#60A5FA20' },
  approved: { label: 'Approved', color: '#22C55E', bg: '#22C55E20' },
  declined: { label: 'Declined', color: '#EF4444', bg: '#EF444420' },
}

// Every status pill resolves through here. A CHECK constraint can be widened by a
// migration without this file being touched (that is exactly how 'sent'/'overdue'
// started crashing the page), so an unknown status must still render. It falls back
// to grey and prints the RAW database value: `cfg?.bg` would have rendered an
// invisible pill and nobody would ever learn the status was unmapped.
// hasOwnProperty guard because plain-object lookup on keys like 'constructor' or
// 'toString' returns an inherited member instead of undefined.
function statusCfg(map: Record<string, StatusCfg>, status: string | null | undefined): StatusCfg {
  if (status && Object.prototype.hasOwnProperty.call(map, status)) return map[status]
  return { label: status || 'Unknown', color: '#9CA3AF', bg: '#9CA3AF20' }
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Mirrors the period math in src/app/hd/financials/page.tsx so the margin block
// covers exactly the range the rest of the page is showing.
// Matched with an if-chain, not an object lookup: periodParam comes straight off the
// ?period= query string, and a plain-object lookup on a key like 'constructor' hands
// back an inherited member instead of undefined — the same hazard statusCfg() guards.
function periodRange(periodParam: string): { from: string; to: string } {
  const now = new Date()
  if (periodParam === 'ytd') return { from: ymd(new Date(now.getFullYear(), 0, 1)), to: ymd(now) }
  if (periodParam === '90d') return { from: ymd(new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)), to: ymd(now) }
  return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) }
}

// ─── Cost & margin ─────────────────────────────────────────────────────────────
// The one number on this page a subscriber prices their work off. It is therefore
// allowed to say "unknown" — the API reports how many invoices in the range have no
// recorded parts cost, and anything computed from a partial set is labelled as such
// instead of being printed as if it covered the whole period.

function CostMarginBlock({ periodParam, periodLabel }: { periodParam: string; periodLabel: string }) {
  const [summary, setSummary] = useState<CostSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed,  setFailed]  = useState(false)

  useEffect(() => {
    let cancelled = false
    const { from, to } = periodRange(periodParam)
    fetch(`/api/hd/financials/summary?from_date=${from}&to_date=${to}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { if (!cancelled) setSummary(d.summary ?? null) })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [periodParam])

  if (loading) return <div className="h-32 animate-pulse rounded-xl" style={{ background: '#111920' }} />
  if (failed || !summary) {
    return (
      <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
        <p className="font-condensed font-bold text-white text-lg tracking-wide mb-2">COST &amp; MARGIN</p>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>Margin data is unavailable right now.</p>
      </div>
    )
  }

  const s = summary
  const noCost   = s.cogs_known === 0
  const marginTx = s.gross_margin == null ? '—' : `${s.gross_margin.toFixed(0)}%`

  // Colour the margin only when it is a real, complete figure. A partial or unknown
  // margin rendered in confident green would read as a verdict on the business.
  const marginColor = s.gross_margin == null || s.cogs_partial
    ? 'white'
    : s.gross_margin >= 40 ? 'green' : s.gross_margin >= 20 ? 'orange' : 'red'

  // The qualifier is the honest part. cogs_total covers only the invoices whose cost
  // was recorded, so the margin it produces describes those invoices — not the period.
  const coverage = noCost
    ? 'No parts cost recorded'
    : s.cogs_partial
      ? `Based on ${s.cogs_known} of ${s.invoice_count} invoices`
      : `All ${s.invoice_count} invoice${s.invoice_count !== 1 ? 's' : ''}`

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Total Revenue" value={fmt(s.total_revenue)} color="green"  sub={`${s.invoice_count} invoice${s.invoice_count !== 1 ? 's' : ''} · ${periodLabel}`} />
        <StatCard label="Parts Revenue" value={fmt(s.parts_revenue)} color="orange" sub="Billed to customers" />
        <StatCard label="Labor Revenue" value={fmt(s.labor_revenue)} color="blue"   sub="Incl. diagnostic + road call" />
        <StatCard
          label="Cost of Goods Sold"
          value={s.cogs_total == null ? '—' : fmt(s.cogs_total)}
          color={s.cogs_total == null ? 'white' : 'red'}
          sub={coverage}
        />
        <StatCard
          label="Gross Profit"
          value={s.gross_profit == null ? '—' : fmt(s.gross_profit)}
          color={s.gross_profit == null ? 'white' : s.gross_profit >= 0 ? 'green' : 'red'}
          sub={s.gross_profit == null ? 'Cost unknown' : `On ${fmt(s.revenue_with_known_cost)} of revenue`}
        />
        <StatCard
          label="Gross Margin"
          value={marginTx}
          color={marginColor}
          sub={s.gross_margin == null ? 'Cost unknown' : s.cogs_partial ? 'Partial — see note' : 'Full period'}
        />
      </div>

      {(noCost || s.cogs_partial) && (
        <div className="rounded-xl p-4" style={{ background: '#162030', border: `1px solid ${HD_ORANGE}40` }}>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
            {noCost ? (
              <>
                <span style={{ color: HD_ORANGE }}>Cost not recorded.</span>{' '}
                None of the {s.invoice_count} invoice{s.invoice_count !== 1 ? 's' : ''} in this period has a parts cost on file,
                so margin cannot be calculated. Parts added with a markup on new invoices record their cost automatically.
              </>
            ) : (
              <>
                <span style={{ color: HD_ORANGE }}>Partial figure.</span>{' '}
                {s.cogs_unknown} of {s.invoice_count} invoice{s.invoice_count !== 1 ? 's' : ''} in this period {s.cogs_unknown === 1 ? 'has' : 'have'} no
                parts cost on file. The cost, profit and margin above cover only the {s.cogs_known} invoice{s.cogs_known !== 1 ? 's' : ''} that
                do — treating the rest as zero-cost would report them as pure profit and overstate your margin.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({ stats }: { stats: OverviewStats }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Revenue"      value={fmt(stats.totalRevenue)}    color="green" sub="Invoiced this period" />
        <StatCard label="Outstanding"  value={fmt(stats.outstandingTotal)} color={stats.outstandingTotal > 0 ? 'orange' : 'white'} sub="Completed, not invoiced" />
        <StatCard label="Avg Job"      value={fmt(stats.avgJobValue)}      color="blue"  sub={`${stats.closedCount} jobs closed`} />
        <StatCard label="Labor Hours"  value={stats.totalLaborHours.toFixed(1)} color="white" sub={`@ $${stats.hourlyRate}/hr`} />
      </div>

      {/* Cost of goods and margin. Sourced from the invoices themselves rather than
          from work orders, so it reports what was billed and what it cost to bill it. */}
      <div>
        <p className="font-condensed font-bold text-white text-lg tracking-wide mb-3">COST &amp; MARGIN</p>
        <CostMarginBlock periodParam={stats.periodParam} periodLabel={stats.periodLabel} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by account */}
        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-4">REVENUE BY FLEET ACCOUNT</p>
          {stats.accountRows.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: 'rgba(255,255,255,0.25)' }}>No data for this period</p>
          ) : (
            <div className="space-y-3">
              {stats.accountRows.map(row => {
                const pct = stats.totalRevenue > 0 ? (row.revenue / stats.totalRevenue) * 100 : 0
                return (
                  <div key={row.name}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm text-white truncate">{row.name}</p>
                      <div className="flex items-center gap-3">
                        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{row.count} job{row.count !== 1 ? 's' : ''}</p>
                        <p className="text-sm font-medium" style={{ color: HD_ORANGE }}>{fmt(row.revenue)}</p>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1e3040' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: HD_ORANGE }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Labor efficiency */}
        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-4">LABOR EFFICIENCY</p>
          <div className="space-y-4">
            <div className="rounded-lg p-4" style={{ background: '#162030' }}>
              <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Labor Revenue</p>
              <p className="font-condensed font-bold text-2xl" style={{ color: '#22C55E' }}>{fmt(stats.laborRevenue)}</p>
              <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {stats.totalLaborHours.toFixed(1)} hrs × ${stats.hourlyRate}/hr
              </p>
            </div>
            <div className="rounded-lg p-4" style={{ background: '#162030' }}>
              <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Labor as % of Revenue</p>
              <p className="font-condensed font-bold text-2xl text-white">{stats.laborPct.toFixed(0)}%</p>
              <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: '#1e3040' }}>
                <div className="h-full rounded-full" style={{
                  width: `${Math.min(100, stats.laborPct)}%`,
                  background: stats.laborPct > 80 ? '#22C55E' : stats.laborPct > 50 ? HD_ORANGE : '#EF4444',
                }} />
              </div>
            </div>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Update your rate in <Link href="/hd/settings" style={{ color: HD_ORANGE }}>Settings</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Invoices tab ──────────────────────────────────────────────────────────────

function InvoicesTab() {
  const [invoices, setInvoices] = useState<HDInvoice[]>([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    fetch('/api/hd/invoices')
      .then(r => r.json())
      .then(d => setInvoices(d.invoices ?? []))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="h-40 animate-pulse rounded-xl" style={{ background: '#111920' }} />

  const totalUnpaid = invoices.filter(i => i.status === 'unpaid').reduce((s, i) => s + Number(i.total ?? 0), 0)
  const totalPaid   = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.total ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard label="Total Invoices" value={String(invoices.length)}   color="white" />
        <StatCard label="Outstanding"    value={fmt(totalUnpaid)}           color={totalUnpaid > 0 ? 'red' : 'white'} />
        <StatCard label="Collected"      value={fmt(totalPaid)}             color="green" />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {invoices.length} Invoice{invoices.length !== 1 ? 's' : ''}
        </p>
        <Link
          href="/hd/invoicing"
          className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white"
          style={{ background: HD_ORANGE }}
        >
          + New Invoice
        </Link>
      </div>

      {invoices.length === 0 ? (
        <div className="py-16 text-center rounded-xl" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>No invoices yet</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <div className="divide-y" style={{ borderColor: '#1e3040' }}>
            {invoices.map(inv => {
              const cfg = statusCfg(INVOICE_STATUS, inv.status)
              return (
                <Link
                  key={inv.id}
                  href={`/hd/invoices/${inv.id}`}
                  className="flex items-center justify-between px-5 py-3.5 transition-opacity hover:opacity-70"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-white">
                        {inv.invoice_number ?? `INV-${inv.id.slice(0, 6).toUpperCase()}`}
                      </p>
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: cfg.bg, color: cfg.color }}
                      >
                        {cfg.label}
                      </span>
                    </div>
                    {inv.customer_name && (
                      <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{inv.customer_name}</p>
                    )}
                    {(inv.unit_manufacturer || inv.unit_model) && (
                      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                        {inv.unit_manufacturer} {inv.unit_model}
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <p className="text-sm font-semibold" style={{ color: HD_ORANGE }}>
                      {inv.total != null ? fmt(Number(inv.total)) : '—'}
                    </p>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{fmtDate(inv.created_at)}</p>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Quotes tab ────────────────────────────────────────────────────────────────

function QuotesTab() {
  const [quotes,  setQuotes]  = useState<HDQuote[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/hd/quotes')
      .then(r => r.json())
      .then(d => setQuotes(d.quotes ?? []))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="h-40 animate-pulse rounded-xl" style={{ background: '#111920' }} />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {quotes.length} Quote{quotes.length !== 1 ? 's' : ''}
        </p>
        <Link
          href="/hd/quotes"
          className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white"
          style={{ background: HD_ORANGE }}
        >
          + New Quote
        </Link>
      </div>

      {quotes.length === 0 ? (
        <div className="py-16 text-center rounded-xl" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>No quotes yet</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <div className="divide-y" style={{ borderColor: '#1e3040' }}>
            {quotes.map(q => {
              const cfg = statusCfg(QUOTE_STATUS, q.status)
              return (
                <Link
                  key={q.id}
                  href={`/hd/quotes/${q.id}`}
                  className="flex items-center justify-between px-5 py-3.5 transition-opacity hover:opacity-70"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-white">
                        {q.quote_number ?? `QT-${q.id.slice(0, 6).toUpperCase()}`}
                      </p>
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: cfg.bg, color: cfg.color }}
                      >
                        {cfg.label}
                      </span>
                    </div>
                    {q.customer_name && (
                      <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{q.customer_name}</p>
                    )}
                    {(q.unit_manufacturer || q.unit_model) && (
                      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                        {q.unit_manufacturer} {q.unit_model}
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <p className="text-sm font-semibold" style={{ color: HD_ORANGE }}>
                      {q.total != null ? fmt(Number(q.total)) : '—'}
                    </p>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{fmtDate(q.created_at)}</p>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Expenses tab ──────────────────────────────────────────────────────────────

function ExpensesTab() {
  const [expenses, setExpenses] = useState<HDExpense[]>([])
  const [loading,  setLoading]  = useState(true)
  const [adding,   setAdding]   = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [form, setForm] = useState({
    category: EXPENSE_CATEGORIES[0],
    description: '',
    amount: '',
    expense_date: new Date().toISOString().slice(0, 10),
    notes: '',
  })

  useEffect(() => {
    fetch('/api/hd/expenses')
      .then(r => r.json())
      .then(d => setExpenses(d.expenses ?? []))
      .finally(() => setLoading(false))
  }, [])

  async function handleAdd() {
    if (!form.description || !form.amount) return
    setSaving(true)
    try {
      const res = await fetch('/api/hd/expenses', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      })
      if (res.ok) {
        const { expense } = await res.json()
        setExpenses(prev => [expense, ...prev])
        setForm({ category: EXPENSE_CATEGORIES[0], description: '', amount: '', expense_date: new Date().toISOString().slice(0, 10), notes: '' })
        setAdding(false)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/hd/expenses?id=${id}`, { method: 'DELETE' })
    setExpenses(prev => prev.filter(e => e.id !== id))
  }

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0)

  if (loading) return <div className="h-40 animate-pulse rounded-xl" style={{ background: '#111920' }} />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {expenses.length} Expense{expenses.length !== 1 ? 's' : ''}
          </p>
          {expenses.length > 0 && (
            <p className="text-sm font-semibold mt-0.5" style={{ color: '#EF4444' }}>Total: {fmt(total)}</p>
          )}
        </div>
        <button
          onClick={() => setAdding(a => !a)}
          className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white"
          style={{ background: HD_ORANGE }}
        >
          {adding ? 'Cancel' : '+ Log Expense'}
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <div className="rounded-xl p-5 space-y-3" style={{ background: '#111920', border: `1px solid ${HD_ORANGE}40` }}>
          <p className="font-condensed font-bold text-white tracking-wide">LOG EXPENSE</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'rgba(255,255,255,0.4)' }}>Category</label>
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm text-white"
                style={{ background: '#162030', border: '1px solid #1e3040' }}
              >
                {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'rgba(255,255,255,0.4)' }}>Date</label>
              <input
                type="date"
                value={form.expense_date}
                onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg text-sm text-white"
                style={{ background: '#162030', border: '1px solid #1e3040' }}
              />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'rgba(255,255,255,0.4)' }}>Description *</label>
              <input
                type="text"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="e.g. O'Reilly filters"
                className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/20"
                style={{ background: '#162030', border: '1px solid #1e3040' }}
              />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'rgba(255,255,255,0.4)' }}>Amount *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
                className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/20"
                style={{ background: '#162030', border: '1px solid #1e3040' }}
              />
            </div>
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'rgba(255,255,255,0.4)' }}>Notes (optional)</label>
            <input
              type="text"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Optional notes"
              className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/20"
              style={{ background: '#162030', border: '1px solid #1e3040' }}
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={saving || !form.description || !form.amount}
            className="w-full py-3 rounded-xl font-bold text-white text-sm transition-opacity"
            style={{ background: HD_ORANGE, opacity: saving || !form.description || !form.amount ? 0.5 : 1 }}
          >
            {saving ? 'Saving…' : 'Save Expense'}
          </button>
        </div>
      )}

      {/* List */}
      {expenses.length === 0 ? (
        <div className="py-16 text-center rounded-xl" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>No expenses logged yet</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <div className="divide-y" style={{ borderColor: '#1e3040' }}>
            {expenses.map(exp => (
              <div key={exp.id} className="flex items-center justify-between px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm text-white font-medium">{exp.description}</p>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: `${HD_BLUE}25`, color: '#60A5FA' }}
                    >
                      {exp.category}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{fmtDate(exp.expense_date)}</p>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                  <p className="text-sm font-semibold" style={{ color: '#EF4444' }}>-{fmt(Number(exp.amount))}</p>
                  <button
                    onClick={() => handleDelete(exp.id)}
                    className="text-xs"
                    style={{ color: 'rgba(255,255,255,0.2)' }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── P&L tab ───────────────────────────────────────────────────────────────────

function PLTab({ stats }: { stats: OverviewStats }) {
  const [expenses, setExpenses] = useState<HDExpense[]>([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    fetch('/api/hd/expenses')
      .then(r => r.json())
      .then(d => setExpenses(d.expenses ?? []))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="h-40 animate-pulse rounded-xl" style={{ background: '#111920' }} />

  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const netProfit     = stats.totalRevenue - totalExpenses
  const margin        = stats.totalRevenue > 0 ? (netProfit / stats.totalRevenue) * 100 : 0

  // Map, not a plain object: expense.category is free text out of the database, and
  // a key like '__proto__' or 'constructor' on an object literal either hits the
  // prototype or silently drops the row from Object.entries.
  const byCategory = new Map<string, number>()
  for (const e of expenses) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + Number(e.amount))
  const categoryRows = [...byCategory.entries()].sort((a, b) => b[1] - a[1])

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Revenue"    value={fmt(stats.totalRevenue)} color="green" sub={stats.periodLabel} />
        <StatCard label="Expenses"   value={fmt(totalExpenses)}      color="red"   sub={`${expenses.length} entries`} />
        <StatCard label="Net Profit" value={fmt(netProfit)}          color={netProfit >= 0 ? 'green' : 'red'} />
        <StatCard label="Margin"     value={`${margin.toFixed(0)}%`} color={margin >= 40 ? 'green' : margin >= 20 ? 'orange' : 'red'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-4">INCOME SUMMARY</p>
          <div className="space-y-2.5">
            {[
              { label: 'Invoiced Revenue', val: stats.totalRevenue,    color: '#22C55E' },
              { label: 'Outstanding',      val: stats.outstandingTotal, color: HD_ORANGE },
              { label: 'Labor Revenue',    val: stats.laborRevenue,     color: '#60A5FA' },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: '#1e3040' }}>
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>{row.label}</p>
                <p className="text-sm font-semibold" style={{ color: row.color }}>{fmt(row.val)}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-4">EXPENSES BY CATEGORY</p>
          {categoryRows.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: 'rgba(255,255,255,0.25)' }}>No expenses logged</p>
          ) : (
            <div className="space-y-2.5">
              {categoryRows.map(([cat, amt]) => (
                <div key={cat} className="flex items-center justify-between py-1.5 border-b" style={{ borderColor: '#1e3040' }}>
                  <p className="text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>{cat}</p>
                  <p className="text-sm font-semibold" style={{ color: '#EF4444' }}>-{fmt(amt)}</p>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <p className="text-sm font-bold text-white">Total Expenses</p>
                <p className="text-sm font-bold" style={{ color: '#EF4444' }}>-{fmt(totalExpenses)}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Net profit bar */}
      <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
        <div className="flex items-center justify-between mb-3">
          <p className="font-condensed font-bold text-white text-lg tracking-wide">NET PROFIT — {stats.periodLabel}</p>
          <p className="font-condensed font-bold text-2xl" style={{ color: netProfit >= 0 ? '#22C55E' : '#EF4444' }}>
            {netProfit >= 0 ? '' : '-'}{fmt(Math.abs(netProfit))}
          </p>
        </div>
        <div className="h-3 rounded-full overflow-hidden" style={{ background: '#1e3040' }}>
          <div className="h-full rounded-full" style={{
            width: `${Math.min(100, Math.max(0, margin))}%`,
            background: margin >= 40 ? '#22C55E' : margin >= 20 ? HD_ORANGE : '#EF4444',
          }} />
        </div>
        <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.3)' }}>{margin.toFixed(0)}% profit margin</p>
      </div>
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────────

export default function HDFinancialsClient({ stats }: { stats: OverviewStats }) {
  const [activeTab,  setActiveTab]  = useState<Tab>('overview')

  return (
    <div>
      {/* Period toggle */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex gap-1.5">
          {[
            { key: 'mtd', label: 'MTD' },
            { key: '90d', label: '90D' },
            { key: 'ytd', label: 'YTD' },
          ].map(p => (
            <a
              key={p.key}
              href={`/hd/financials?period=${p.key}`}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={stats.periodParam === p.key
                ? { background: HD_ORANGE, color: '#fff' }
                : { color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }
              }
            >
              {p.label}
            </a>
          ))}
        </div>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>{stats.periodLabel}</p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b overflow-x-auto" style={{ borderColor: '#1e3040' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors relative flex-shrink-0"
            style={activeTab === tab.id ? { color: HD_ORANGE } : { color: 'rgba(255,255,255,0.4)' }}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t" style={{ background: HD_ORANGE }} />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'overview'  && <OverviewTab  stats={stats} />}
      {activeTab === 'invoices'  && <InvoicesTab />}
      {activeTab === 'quotes'    && <QuotesTab />}
      {activeTab === 'expenses'  && <ExpensesTab />}
      {activeTab === 'pl'        && <PLTab stats={stats} />}
    </div>
  )
}
