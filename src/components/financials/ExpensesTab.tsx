'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Expense, ExpenseCategory } from '@/types/financials'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

const fmtDate = (s: string) =>
  new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function today() {
  return new Date().toISOString().slice(0, 10)
}

// ─── Category config ──────────────────────────────────────────────────────────

const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'parts',               label: 'Parts' },
  { value: 'tools',               label: 'Tools' },
  { value: 'fuel',                label: 'Fuel' },
  { value: 'insurance',           label: 'Insurance' },
  { value: 'licensing',           label: 'Licensing' },
  { value: 'marketing',           label: 'Marketing' },
  { value: 'software',            label: 'Software' },
  { value: 'training',            label: 'Training' },
  { value: 'vehicle_maintenance', label: 'Vehicle Maintenance' },
  { value: 'office_supplies',     label: 'Office Supplies' },
  { value: 'subcontractor',       label: 'Subcontractor' },
  { value: 'other',               label: 'Other' },
]

const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  parts:               'bg-blue/20 text-blue',
  tools:               'bg-orange/20 text-orange',
  fuel:                'bg-yellow-500/20 text-yellow-400',
  insurance:           'bg-purple-500/20 text-purple-400',
  licensing:           'bg-pink-500/20 text-pink-400',
  marketing:           'bg-green-500/20 text-green-400',
  software:            'bg-cyan-500/20 text-cyan-400',
  training:            'bg-indigo-500/20 text-indigo-400',
  vehicle_maintenance: 'bg-orange/20 text-orange',
  office_supplies:     'bg-white/10 text-white/50',
  subcontractor:       'bg-red-500/20 text-red-400',
  other:               'bg-white/5 text-white/30',
}

function CategoryBadge({ category }: { category: ExpenseCategory }) {
  const cls   = CATEGORY_COLORS[category] ?? 'bg-white/5 text-white/30'
  const label = CATEGORIES.find(c => c.value === category)?.label ?? category
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ExpensesTab() {
  const [expenses,   setExpenses]   = useState<Expense[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [showForm,   setShowForm]   = useState(false)
  const [formError,  setFormError]  = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Filters
  const [catFilter,  setCatFilter]  = useState('')
  const [fromDate,   setFromDate]   = useState('')
  const [toDate,     setToDate]     = useState('')

  // Form
  const [form, setForm] = useState(() => ({
    expense_date: today(),
    category:     'parts' as ExpenseCategory,
    description:  '',
    amount:       '',
    vendor:       '',
    notes:        '',
  }))

  // ── Fetch expenses ──
  const fetchExpenses = useCallback(async (cat: string, from: string, to: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (cat)  params.set('category',  cat)
      if (from) params.set('from_date', from)
      if (to)   params.set('to_date',   to)
      const res  = await fetch(`/api/expenses?${params.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load expenses')
      setExpenses(json.expenses)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchExpenses(catFilter, fromDate, toDate) }, [catFilter, fromDate, toDate, fetchExpenses])

  // ── Submit new expense ──
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0) {
      setFormError('Enter a valid amount greater than 0.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expense_date: form.expense_date,
          category:     form.category,
          description:  form.description,
          amount:       Number(form.amount),
          vendor:       form.vendor || null,
          notes:        form.notes  || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to log expense')
      setExpenses(prev => [json.expense, ...prev])
      setShowForm(false)
      setForm({
        expense_date: today(),
        category:     'parts',
        description:  '',
        amount:       '',
        vendor:       '',
        notes:        '',
      })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  // Totals for filtered results
  const filteredTotal = expenses.reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div className="space-y-4">
      {/* Filters + Log Expense button */}
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="nwi-label">Category</label>
          <select className="nwi-input" value={catFilter}
            onChange={e => setCatFilter(e.target.value)}>
            <option value="">All Categories</option>
            {CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="nwi-label">From</label>
          <input type="date" className="nwi-input" value={fromDate}
            onChange={e => setFromDate(e.target.value)} />
        </div>
        <div>
          <label className="nwi-label">To</label>
          <input type="date" className="nwi-input" value={toDate}
            onChange={e => setToDate(e.target.value)} />
        </div>
        {(catFilter || fromDate || toDate) && (
          <button
            onClick={() => { setCatFilter(''); setFromDate(''); setToDate('') }}
            className="mb-0.5 text-white/40 hover:text-white text-xs underline underline-offset-2 transition-colors whitespace-nowrap">
            Clear filters
          </button>
        )}
        <div className="flex-1 flex justify-end">
          <button
            onClick={() => { setShowForm(v => !v); setFormError(null) }}
            className="flex items-center gap-1.5 px-4 py-2 bg-orange hover:bg-orange-hover text-white font-condensed font-semibold text-sm tracking-wide rounded-lg transition-colors whitespace-nowrap">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Log Expense
          </button>
        </div>
      </div>

      {/* ── Log expense form ── */}
      {showForm && (
        <div className="nwi-card border-orange/30">
          <h3 className="font-condensed font-bold text-lg text-white tracking-wide mb-4">Log Expense</h3>
          {formError && <div className="alert-error mb-4">{formError}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="nwi-label">Date</label>
                <input type="date" className="nwi-input" value={form.expense_date} required
                  onChange={e => setForm(p => ({ ...p, expense_date: e.target.value }))} />
              </div>
              <div>
                <label className="nwi-label">Category</label>
                <select className="nwi-input" value={form.category}
                  onChange={e => setForm(p => ({ ...p, category: e.target.value as ExpenseCategory }))}>
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="nwi-label">Amount ($)</label>
                <input type="number" min="0.01" step="0.01" className="nwi-input" required
                  placeholder="0.00" value={form.amount}
                  onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="nwi-label">Description</label>
                <input className="nwi-input" required placeholder="What was this expense for?"
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div>
                <label className="nwi-label">Vendor <span className="normal-case text-white/20">(optional)</span></label>
                <input className="nwi-input" placeholder="e.g. AutoZone, Shell, Amazon"
                  value={form.vendor}
                  onChange={e => setForm(p => ({ ...p, vendor: e.target.value }))} />
              </div>
            </div>

            <div>
              <label className="nwi-label">Notes <span className="normal-case text-white/20">(optional)</span></label>
              <textarea rows={2} className="nwi-input resize-none" value={form.notes}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={submitting}
                className="px-6 py-2.5 bg-orange hover:bg-orange-hover disabled:opacity-50 text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors">
                {submitting ? 'Saving…' : 'Log Expense'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-6 py-2.5 border border-dark-border hover:border-white/20 text-white/50 hover:text-white text-sm rounded-lg transition-colors">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {error && <div className="alert-error">{error}</div>}

      {/* Totals banner */}
      {!loading && expenses.length > 0 && (
        <div className="flex items-center justify-between px-5 py-3 bg-dark-card/50 border border-dark-border rounded-xl">
          <span className="text-white/40 text-sm">
            {expenses.length} expense{expenses.length !== 1 ? 's' : ''}
            {(catFilter || fromDate || toDate) ? ' (filtered)' : ''}
          </span>
          <span className="font-condensed font-bold text-danger">{fmt(filteredTotal)}</span>
        </div>
      )}

      {/* ── Expense list ── */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="nwi-card animate-pulse h-14 bg-dark-card/50" />
          ))}
        </div>
      ) : expenses.length === 0 ? (
        <div className="nwi-card text-center py-12">
          <svg className="w-10 h-10 text-white/10 mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          <p className="text-white/30 text-sm">No expenses{catFilter ? ` in "${catFilter}"` : ''} found.</p>
          <button onClick={() => setShowForm(true)}
            className="mt-3 text-orange text-xs hover:underline">
            Log your first expense →
          </button>
        </div>
      ) : (
        <div className="nwi-card p-0 overflow-hidden">
          {/* Table header */}
          <div className="hidden sm:grid grid-cols-[120px_1fr_1fr_110px_100px] gap-4 px-5 py-3 border-b border-dark-border">
            {['Date', 'Description', 'Vendor', 'Category', 'Amount'].map(h => (
              <span key={h} className={`text-white/30 text-xs uppercase tracking-widest ${h === 'Amount' ? 'text-right' : ''}`}>{h}</span>
            ))}
          </div>

          <div className="divide-y divide-dark-border">
            {expenses.map(exp => (
              <div key={exp.id}
                className="grid grid-cols-1 sm:grid-cols-[120px_1fr_1fr_110px_100px] gap-2 sm:gap-4 px-5 py-4 hover:bg-white/2 transition-colors items-center">
                <span className="text-white/40 text-xs">{fmtDate(exp.expense_date)}</span>
                <div className="min-w-0">
                  <p className="text-white text-sm truncate">{exp.description}</p>
                  {exp.notes && <p className="text-white/30 text-xs truncate">{exp.notes}</p>}
                </div>
                <span className="text-white/50 text-sm truncate">{exp.vendor ?? '—'}</span>
                <CategoryBadge category={exp.category} />
                <span className="font-condensed font-bold text-danger sm:text-right">{fmt(exp.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
