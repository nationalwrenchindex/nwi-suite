'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Inspection, InspectionItem, InspectionItemStatus } from '@/types/jobs'
import { INSPECTION_POINTS, CATEGORY_LABELS, type InspectionCategory } from '@/lib/mpi-catalog'

// ─── Status button group ──────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: InspectionItemStatus; label: string; colors: string }[] = [
  { value: 'pass',            label: 'Pass',           colors: 'border-success/50 text-success bg-success/10'       },
  { value: 'needs_attention', label: 'Attention',       colors: 'border-amber-500/50 text-amber-400 bg-amber-500/10' },
  { value: 'fail',            label: 'Fail',           colors: 'border-danger/50 text-danger bg-danger/10'          },
]

function PointRow({
  item,
  onChange,
}: {
  item: InspectionItem
  onChange: (id: string, status: InspectionItemStatus, notes: string | null) => void
}) {
  const [notesOpen, setNotesOpen] = useState(
    !!(item.notes && item.notes.trim() !== ''),
  )
  const [notes, setNotes] = useState(item.notes ?? '')

  function handleStatus(s: InspectionItemStatus) {
    onChange(item.id, s, notes || null)
  }

  function handleNotes(v: string) {
    setNotes(v)
    onChange(item.id, item.status, v || null)
  }

  return (
    <div className="py-3 border-b border-dark-border last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <span className="text-white/25 text-xs w-5 flex-shrink-0 mt-0.5 font-mono">{item.point_number}</span>
          <p className="text-white/80 text-sm leading-snug">{item.point_name}</p>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleStatus(opt.value)}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-all ${
                item.status === opt.value
                  ? opt.colors
                  : 'border-dark-border text-white/30 hover:text-white/60 hover:border-white/20'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Notes toggle */}
      <div className="ml-7 mt-1.5">
        {notesOpen ? (
          <textarea
            rows={2}
            className="w-full bg-dark-input border border-dark-border rounded-lg px-3 py-2 text-white/70 text-xs resize-none focus:outline-none focus:border-white/20 placeholder:text-white/20"
            placeholder="Add notes…"
            value={notes}
            onChange={(e) => handleNotes(e.target.value)}
            onBlur={() => { if (!notes.trim()) setNotesOpen(false) }}
          />
        ) : (
          <button
            onClick={() => setNotesOpen(true)}
            className="text-white/25 text-xs hover:text-white/50 transition-colors"
          >
            + Add note
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MultiPointInspection({
  inspectionId,
  customerName,
  onClose,
}: {
  inspectionId: string
  customerName: string
  onClose: () => void
}) {
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [items,      setItems]      = useState<InspectionItem[]>([])
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [completing, setCompleting] = useState(false)
  const [genQuote,   setGenQuote]   = useState(false)
  const [quoteId,    setQuoteId]    = useState<string | null>(null)
  const [error,      setError]      = useState<string | null>(null)

  const loadInspection = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/inspections/${inspectionId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load inspection')
      setInspection(data.inspection)
      setItems(data.inspection.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load inspection')
    } finally {
      setLoading(false)
    }
  }, [inspectionId])

  useEffect(() => { loadInspection() }, [loadInspection])

  function handleItemChange(id: string, status: InspectionItemStatus, notes: string | null) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, status, notes: notes ?? null } : it)),
    )
  }

  function handleWaiveToggle() {
    if (!inspection) return
    const newValue = !inspection.labor_charge_applied
    setInspection({ ...inspection, labor_charge_applied: newValue })
    fetch(`/api/inspections/${inspectionId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ labor_charge_applied: newValue }),
    }).catch(() => {})
  }

  async function saveItems(newStatus?: string) {
    const itemUpdates = items.map((it) => ({
      id:     it.id,
      status: it.status,
      notes:  it.notes,
    }))
    const body: Record<string, unknown> = { items: itemUpdates }
    if (newStatus) body.status = newStatus

    const res = await fetch(`/api/inspections/${inspectionId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Save failed')
    setInspection(data.inspection)
    setItems(data.inspection.items ?? [])
  }

  async function handleSaveProgress() {
    setSaving(true)
    setError(null)
    try {
      await saveItems('in_progress')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleComplete() {
    setCompleting(true)
    setError(null)
    try {
      await saveItems('completed')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to complete inspection')
    } finally {
      setCompleting(false)
    }
  }

  async function handleGenerateQuote() {
    setGenQuote(true)
    setError(null)
    try {
      const res = await fetch(`/api/inspections/${inspectionId}/generate-quote`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Quote generation failed')
      setQuoteId(data.quoteId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Quote generation failed')
    } finally {
      setGenQuote(false)
    }
  }

  const isCompleted  = inspection?.status === 'completed'
  const failedCount  = items.filter((it) => it.status === 'fail' || it.status === 'needs_attention').length
  const checkedCount = items.filter((it) => it.status !== 'not_checked').length

  const categorized = INSPECTION_POINTS.reduce<Record<InspectionCategory, InspectionItem[]>>(
    (acc, pt) => {
      const item = items.find((it) => it.point_number === pt.point_number)
      if (item) {
        if (!acc[pt.category]) acc[pt.category] = []
        acc[pt.category].push(item)
      }
      return acc
    },
    {} as Record<InspectionCategory, InspectionItem[]>,
  )

  const categoryOrder: InspectionCategory[] = [
    'fluids_engine',
    'tires_wheels',
    'brakes_underside',
    'lights_safety',
  ]

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-dark overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-dark-border flex-shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-white/40 text-[10px] uppercase tracking-widest">25-Point Multi-Point Inspection</p>
          <h2 className="font-condensed font-bold text-xl text-white tracking-wide truncate">
            {customerName}
          </h2>
          {inspection && (
            <p className={`text-xs mt-0.5 font-medium ${
              isCompleted ? 'text-success' :
              inspection.status === 'in_progress' ? 'text-amber-400' :
              'text-white/40'
            }`}>
              {isCompleted ? 'Completed' :
               inspection.status === 'in_progress' ? 'In Progress' :
               'Pending'}
              {!isCompleted && ` · ${checkedCount}/25 checked`}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="ml-4 p-2 text-white/30 hover:text-white transition-colors rounded-lg hover:bg-dark-border"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <svg className="w-8 h-8 text-orange animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
            {error && (
              <div className="bg-danger/10 border border-danger/30 rounded-xl px-4 py-3 text-danger text-sm">
                {error}
              </div>
            )}

            {/* Quote generated success */}
            {quoteId && (
              <div className="bg-success/10 border border-success/30 rounded-xl px-4 py-4">
                <p className="text-success font-semibold text-sm mb-1">Quote created successfully!</p>
                <p className="text-white/50 text-xs mb-3">
                  A draft quote has been created with {failedCount} service{failedCount !== 1 ? 's' : ''}.
                  Open it to set pricing and send it to the customer.
                </p>
                <a
                  href="/financials?tab=quotes"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-success border border-success/40 rounded-lg px-3 py-2 hover:bg-success/10 transition-colors"
                >
                  View Quote in Financials →
                </a>
              </div>
            )}

            {/* Labor charge waive */}
            {inspection && !isCompleted && (
              <div className="rounded-xl border border-dark-border bg-dark-card px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-white/70 text-sm font-medium">0.5 hr inspection charge</p>
                  <p className="text-white/35 text-xs">
                    {inspection.labor_charge_applied
                      ? 'Will be added to the invoice.'
                      : 'Waived for this job.'}
                  </p>
                </div>
                <button
                  onClick={handleWaiveToggle}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${
                    inspection.labor_charge_applied
                      ? 'border-danger/40 text-danger bg-danger/10 hover:bg-danger/20'
                      : 'border-success/40 text-success bg-success/10 hover:bg-success/20'
                  }`}
                >
                  {inspection.labor_charge_applied ? 'Waive Charge' : 'Restore Charge'}
                </button>
              </div>
            )}

            {/* Inspection points by category */}
            {categoryOrder.map((cat) => {
              const catItems = categorized[cat]
              if (!catItems || catItems.length === 0) return null
              return (
                <div key={cat}>
                  <p className="text-white/40 text-[10px] uppercase tracking-widest mb-3">
                    {CATEGORY_LABELS[cat]}
                  </p>
                  <div className="rounded-xl border border-dark-border bg-dark-card px-4">
                    {catItems.map((item) => (
                      <PointRow
                        key={item.id}
                        item={item}
                        onChange={isCompleted ? () => {} : handleItemChange}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer actions */}
      {!loading && (
        <div className="flex-shrink-0 border-t border-dark-border bg-dark px-4 sm:px-6 py-4">
          <div className="max-w-2xl mx-auto flex flex-wrap gap-3">
            {isCompleted ? (
              <>
                {!quoteId && failedCount > 0 && (
                  <button
                    onClick={handleGenerateQuote}
                    disabled={genQuote}
                    className="flex-1 sm:flex-none sm:px-6 py-3 bg-orange hover:bg-orange/90 disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-xl transition-colors"
                  >
                    {genQuote ? 'Generating…' : `Generate Quote (${failedCount} item${failedCount !== 1 ? 's' : ''})`}
                  </button>
                )}
                {failedCount === 0 && !quoteId && (
                  <p className="text-white/40 text-sm py-3">All items passed — no quote needed.</p>
                )}
                <button
                  onClick={onClose}
                  className="px-6 py-3 border border-dark-border text-white/60 hover:text-white font-condensed font-bold text-sm rounded-xl transition-colors"
                >
                  Close
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleSaveProgress}
                  disabled={saving || completing}
                  className="px-5 py-3 border border-dark-border text-white/60 hover:text-white disabled:opacity-50 font-condensed font-bold text-sm rounded-xl transition-colors"
                >
                  {saving ? 'Saving…' : 'Save Progress'}
                </button>
                <button
                  onClick={handleComplete}
                  disabled={saving || completing || checkedCount < 25}
                  className="flex-1 sm:flex-none sm:px-8 py-3 bg-orange hover:bg-orange/90 disabled:opacity-40 text-white font-condensed font-bold text-sm rounded-xl transition-colors"
                >
                  {completing ? 'Completing…' : `Complete Inspection${checkedCount < 25 ? ` (${checkedCount}/25)` : ''}`}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
