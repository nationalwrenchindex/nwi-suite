'use client'

import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_HD_PARTS_MARKUP } from '@/lib/hd/parts-pricing'
import {
  lineTotal,
  lineUnitPrice,
  sumLines,
  type WorkOrderLine,
  type WorkOrderLineType,
} from '@/lib/hd/work-order-lines'
import AddPartToWorkOrder from '@/components/parts/AddPartToWorkOrder'
import type { PickedPart } from '@/components/parts/PartsFinder'
import { money } from '@/lib/format'
import { tint } from '@/lib/hd/text-tone'
import { JOB_STATUSES, type JobStatus, type WorkOrderJob } from '@/lib/hd/work-order-jobs'

// Parts and labor priced on the job itself, instead of first appearing at the
// invoice form. Self-contained: it fetches and saves its own rows, so the work order
// page does not have to thread them through the server component.
//
// The columns mirror the invoice form's parts entry deliberately — part number,
// description, quantity, Your Cost, Markup %, read-only Sell, line total. A tech who
// has priced a part on one form should not have to relearn the other, and the sell
// column is read-only in both so cost and sell can never be typed out of step.

const HD_ORANGE = '#E85D24'
const CARD      = 'var(--hd-card)'
const HEAD      = 'var(--hd-inner)'
const BORDER    = 'var(--hd-border)'
const BLUE      = '#3B82F6'

// Rows are edited as strings so a half-typed "1." or a cleared field does not snap
// back to 0 under the tech's cursor; they are parsed at save.
interface DraftLine {
  key: string
  /** The job this line is on (migration 177). Job 1 when the work order has no jobs. */
  job_number: number
  type: WorkOrderLineType
  description: string
  part_number: string
  quantity: string
  unit_cost: string
  unit_price: string
  markup_percent: string
}

function fmt(n: number) { return `${money(n)}` }
function num(v: string) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }

// A job on the card. Description and status only - a job carries no money.
interface DraftJob {
  job_number: number
  description: string
  status: JobStatus
}

const FIRST_JOB: DraftJob = { job_number: 1, description: '', status: 'open' }

function toDraftJobs(jobs: WorkOrderJob[] | undefined): DraftJob[] {
  const out = (jobs ?? []).map(j => ({ job_number: j.job_number, description: j.description ?? '', status: j.status }))
  return out.length ? out.sort((a, b) => a.job_number - b.job_number) : [FIRST_JOB]
}

// Lines with their job number, from the server's job ids. A line with no job (a work
// order from before migration 177) sits on the first job.
function toDrafts(lines: Array<WorkOrderLine & { job_id?: string | null }>, jobs: WorkOrderJob[] | undefined): DraftLine[] {
  const byId = new Map((jobs ?? []).filter(j => j.id).map(j => [j.id as string, j.job_number]))
  const first = toDraftJobs(jobs)[0].job_number
  return lines.map(l => toDraft(l, (l.job_id && byId.get(l.job_id)) || first))
}

function toDraft(l: WorkOrderLine, jobNumber: number): DraftLine {
  return {
    key:            l.id,
    job_number:     jobNumber,
    type:           l.type,
    description:    l.description ?? '',
    part_number:    l.part_number ?? '',
    quantity:       String(l.quantity ?? 0),
    unit_cost:      l.unit_cost      == null ? '' : String(l.unit_cost),
    unit_price:     l.unit_price     == null ? '' : String(l.unit_price),
    markup_percent: l.markup_percent == null ? '' : String(l.markup_percent),
  }
}

// The same rule the server applies, run locally so the tech sees the number that
// will be stored rather than one this card invented.
function draftTotal(d: DraftLine): number {
  const hasCost = d.type === 'part' && d.unit_cost.trim() !== '' && d.markup_percent.trim() !== ''
  return lineTotal({
    type:           d.type,
    quantity:       num(d.quantity),
    unit_cost:      hasCost ? num(d.unit_cost) : null,
    unit_price:     d.unit_price.trim() === '' ? null : num(d.unit_price),
    markup_percent: hasCost ? num(d.markup_percent) : null,
  })
}

function draftSell(d: DraftLine): number {
  if (d.type !== 'part') return num(d.unit_price)
  if (d.unit_cost.trim() === '') return num(d.unit_price)
  return lineUnitPrice(num(d.unit_cost), d.markup_percent.trim() === '' ? 0 : num(d.markup_percent))
}

const inputCls = 'w-full px-2 py-2 rounded-lg text-base sm:text-sm text-white placeholder-white/20'
const inputStyle = { background: HEAD, border: `1px solid ${BORDER}` } as React.CSSProperties
const thCls = 'px-3 py-2 text-left text-[10px] uppercase tracking-widest font-semibold'

export default function WorkOrderLineItems({
  workOrderId,
  canEdit,
  unit,
}: {
  workOrderId: string
  canEdit: boolean
  /** The unit on the job, so the parts picker opens already filtered to it. */
  unit?: { manufacturer: string | null; model: string | null; serial: string | null }
}) {
  const [lines, setLines]     = useState<DraftLine[]>([])
  const [jobs, setJobs]       = useState<DraftJob[]>([FIRST_JOB])
  // false until migration 177 is applied: the card then works as one job, as before.
  const [hasJobs, setHasJobs] = useState(false)
  // Where a part picked from the catalog lands.
  const [catalogJob, setCatalogJob] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [dirty, setDirty]     = useState(false)
  const [error, setError]     = useState<string | null>(null)
  // Confirmation, and what the save did to any empty rows. Separate from `error`
  // because dropping a blank line is not a failure.
  const [note, setNote]       = useState<string | null>(null)
  const [markupDefault, setMarkupDefault] = useState(DEFAULT_HD_PARTS_MARKUP)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/hd/work-orders/${workOrderId}/line-items`)
        if (!res.ok) throw new Error('Could not load line items')
        const json = await res.json() as { line_items: WorkOrderLine[]; jobs?: WorkOrderJob[]; has_jobs?: boolean }
        if (cancelled) return
        const loadedJobs = toDraftJobs(json.jobs)
        setJobs(loadedJobs)
        setHasJobs(!!json.has_jobs)
        setCatalogJob(loadedJobs[loadedJobs.length - 1].job_number)
        setLines(toDrafts(json.line_items ?? [], json.jobs))
      } catch {
        if (!cancelled) setError('Could not load line items.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [workOrderId])

  // Same profile-backed markup the quote and invoice forms seed from, so one
  // subscriber gets one markup regardless of which form the part was entered on.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user/profile')
        if (!res.ok) return
        const json = await res.json()
        // hd_parts_markup_percent, not default_parts_markup_percent: the latter is the
        // LD column (defaults 20) and reading it here would price a work order at 20%
        // while the quote and invoice built from it price at 30.
        const n = Number(json.hd_parts_markup_percent)
        if (!cancelled && Number.isFinite(n)) setMarkupDefault(n)
      } catch {
        // Fall back to the shared default rather than blocking parts entry.
      }
    })()
    return () => { cancelled = true }
  }, [])

  const update = useCallback((key: string, patch: Partial<DraftLine>) => {
    setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)))
    setDirty(true)
    // A "Saved." sitting above rows that have since been edited is a lie about the
    // current state, so the first keystroke clears it.
    setNote(null)
  }, [])

  function addLine(type: WorkOrderLineType, jobNumber: number) {
    setLines(ls => [...ls, {
      key: crypto.randomUUID(),
      job_number: jobNumber,
      type,
      description: '',
      part_number: '',
      quantity: '1',
      unit_cost: '',
      unit_price: '',
      markup_percent: type === 'part' ? String(markupDefault) : '',
    }])
    setDirty(true)
    setNote(null)
  }

  // A part chosen from the catalog becomes an ordinary draft line. The COST goes in
  // unit_cost and the markup is the work order's own - exactly what addLine does for a
  // hand-typed part, so the saved row and its arithmetic are identical either way.
  // Nothing here computes a price.
  function addPartFromCatalog(part: PickedPart) {
    setLines(ls => [...ls, {
      key: crypto.randomUUID(),
      job_number: jobs.some(j => j.job_number === catalogJob) ? catalogJob : jobs[jobs.length - 1].job_number,
      type: 'part' as WorkOrderLineType,
      description: part.description,
      part_number: part.part_number,
      quantity: String(part.quantity),
      // Empty, not '0', when no cost is on record. A zero would bill the job as pure
      // profit on that line; empty makes the tech enter what they paid.
      unit_cost: part.unit_cost == null ? '' : String(part.unit_cost),
      unit_price: '',
      markup_percent: String(markupDefault),
    }])
    setDirty(true)
  }

  function removeLine(key: string) {
    setLines(ls => ls.filter(l => l.key !== key))
    setDirty(true)
  }

  // Position in the array is the sort order the server stores, so moving a row is
  // just a swap — no index bookkeeping on either side. A row moves within its own job:
  // it swaps with the nearest row of the same job above or below it.
  function move(key: string, delta: number) {
    setLines(ls => {
      const from = ls.findIndex(l => l.key === key)
      if (from < 0) return ls
      let to = from + delta
      while (to >= 0 && to < ls.length && ls[to].job_number !== ls[from].job_number) to += delta
      if (to < 0 || to >= ls.length) return ls
      const next = [...ls]
      ;[next[from], next[to]] = [next[to], next[from]]
      return next
    })
    setDirty(true)
  }

  // ── Jobs. A job groups lines and carries no money; see lib/hd/work-order-jobs. ──
  function addJob() {
    const n = Math.max(0, ...jobs.map(j => j.job_number)) + 1
    setJobs(js => [...js, { job_number: n, description: '', status: 'open' }])
    setCatalogJob(n)
    setDirty(true)
    setNote(null)
  }

  function updateJob(n: number, patch: Partial<DraftJob>) {
    setJobs(js => js.map(j => (j.job_number === n ? { ...j, ...patch } : j)))
    setDirty(true)
    setNote(null)
  }

  // Only an EMPTY job can be removed. A job's lines are billable work; removing the job
  // must never take them with it, so the tech removes or moves the lines first.
  function removeJob(n: number) {
    if (jobs.length < 2 || lines.some(l => l.job_number === n)) return
    setJobs(js => js.filter(j => j.job_number !== n))
    if (catalogJob === n) setCatalogJob(jobs.find(j => j.job_number !== n)!.job_number)
    setDirty(true)
  }

  // ===========================================================================
  // A BLANK LINE IS NOT A LINE.
  // ===========================================================================
  //
  // "+ Add Labor" appends an empty row for the tech to type into, and an empty row
  // left alone used to SAVE - landing in the line items as a LAB row at $0.00 that
  // looks exactly like a bug. Two of them were added by accident in one evening.
  //
  // Empty means: nothing identifying it (no description, no part number) AND no money
  // on it (no cost, no price, zero total). Both halves are required. A line that says
  // "shop supplies" with no price yet is unfinished work the tech is in the middle of
  // and must survive a save; a line with a price and no description is someone's
  // shorthand and is not ours to drop.
  function isBlank(d: DraftLine): boolean {
    const hasText  = d.description.trim() !== '' || d.part_number.trim() !== ''
    const hasMoney = d.unit_cost.trim() !== '' || d.unit_price.trim() !== '' || draftTotal(d) !== 0
    return !hasText && !hasMoney
  }

  const blankCount = lines.filter(isBlank).length

  async function save() {
    setSaving(true)
    setError(null)
    try {
      // Dropped here rather than refusing the save: the tech asked to save the work he
      // did, and an empty row is not work. Refusing would make him hunt for a row that
      // shows nothing wrong.
      // In job order, so the stored sort_order reads job by job.
      const jobRank = new Map(jobs.map((j, i) => [j.job_number, i]))
      const keep = lines.filter(d => !isBlank(d))
        .map((d, i) => ({ d, i }))
        .sort((a, b) => (jobRank.get(a.d.job_number) ?? 0) - (jobRank.get(b.d.job_number) ?? 0) || a.i - b.i)
        .map(x => x.d)
      const dropped = lines.length - keep.length

      const payload = keep.map(d => ({
        job_number:     d.job_number,
        type:           d.type,
        description:    d.description,
        part_number:    d.part_number,
        quantity:       num(d.quantity),
        // Empty stays empty: a blank cost means "not known", and sending 0 would
        // book the line as pure profit.
        unit_cost:      d.unit_cost.trim()      === '' ? null : num(d.unit_cost),
        unit_price:     d.unit_price.trim()     === '' ? null : num(d.unit_price),
        markup_percent: d.markup_percent.trim() === '' ? null : num(d.markup_percent),
      }))
      const res = await fetch(`/api/hd/work-orders/${workOrderId}/line-items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          line_items: payload,
          jobs: jobs.map(j => ({ job_number: j.job_number, description: j.description, status: j.status })),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      // Re-seed from the server's answer so the ids, and any number it rounded
      // differently, are what the card is now showing.
      if (json.has_jobs) setJobs(toDraftJobs(json.jobs))
      setLines(toDrafts(json.line_items ?? [], json.has_jobs ? json.jobs : undefined))
      setDirty(false)
      // Said out loud. A row vanishing on save with no explanation is its own small
      // mystery, and the tech should know it was the empty one and not his part line.
      setNote(dropped > 0
        ? `Saved. ${dropped} empty ${dropped === 1 ? 'line was' : 'lines were'} dropped.`
        : 'Saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // One summing rule for the card and for each job, so the job subtotals add up to the
  // card's LINE TOTAL by construction.
  const draftTotals = (ds: DraftLine[]) => sumLines(ds.map(d => ({
    type:      d.type,
    quantity:  num(d.quantity),
    unit_cost: d.unit_cost.trim() === '' ? null : num(d.unit_cost),
    total:     draftTotal(d),
  })))
  const totals = draftTotals(lines)
  const cols = canEdit ? 9 : 8

  return (
    <div className="rounded-xl overflow-hidden mb-6" style={{ border: `1px solid ${BORDER}` }}>
      <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-2" style={{ background: 'var(--hd-sunken)', borderBottom: `1px solid ${BORDER}` }}>
        <p className="font-condensed font-bold text-white text-sm tracking-widest">PARTS &amp; LABOR</p>
        <span className="text-xs" style={{ color: 'var(--hd-text-faint)' }}>
          {lines.length} line{lines.length !== 1 ? 's' : ''}
        </span>
      </div>

      {canEdit && (
        <div className="px-5 py-3 flex flex-wrap items-center gap-2" style={{ background: 'var(--hd-sunken)', borderBottom: `1px solid ${BORDER}` }}>
          {/* With jobs, lines are added inside each job (its header row below), and this
              bar adds jobs. Before migration 177 the card is one job, as it always was. */}
          {hasJobs ? (
            <button
              type="button" onClick={addJob}
              className="px-4 py-2 rounded-lg text-xs font-condensed font-bold tracking-wide"
              style={{ background: 'transparent', color: 'var(--hd-text)', border: `1px solid ${BORDER}` }}
            >
              + Add Job
            </button>
          ) : (
            <>
              <button
                type="button" onClick={() => addLine('labor', jobs[0].job_number)}
                className="px-4 py-2 rounded-lg text-xs font-condensed font-bold tracking-wide"
                style={{ background: `${tint(HD_ORANGE, 9)}`, color: 'var(--hd-text)', border: `1px solid ${tint(HD_ORANGE, 33)}` }}
              >
                + Add Labor
              </button>
              <button
                type="button" onClick={() => addLine('part', jobs[0].job_number)}
                className="px-4 py-2 rounded-lg text-xs font-condensed font-bold tracking-wide"
                style={{ background: `${tint(BLUE, 9)}`, color: 'var(--hd-info)', border: `1px solid ${tint(BLUE, 33)}` }}
              >
                + Add Part
              </button>
            </>
          )}
          <div className="flex-1" />
          {/* A warning, so it reads like one: the amber token (AA in both themes). */}
          {dirty && (
            <span className="text-xs" style={{ color: 'var(--hd-warn)' }}>Unsaved changes</span>
          )}
          <button
            type="button" onClick={save} disabled={saving || !dirty}
            className="px-5 py-2 rounded-lg text-xs font-condensed font-bold tracking-wide text-on-accent disabled:opacity-40"
            style={{ background: HD_ORANGE }}
          >
            {saving ? 'Saving…' : 'Save Lines'}
          </button>
        </div>
      )}

      {/* SCREEN 4: the catalog, already filtered to the unit on this job. Placed with
          the add buttons because it is an alternative to typing a part number from
          memory - which is where a wrong part number comes from. */}
      {canEdit && unit && (
        <div className="px-5 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          {jobs.length > 1 && (
            <label className="flex items-center gap-2 mb-2 text-xs" style={{ color: 'var(--hd-text-muted)' }}>
              Catalog parts go on
              <select
                value={catalogJob} onChange={e => setCatalogJob(Number(e.target.value))}
                className="px-2 py-1 rounded text-xs text-white" style={inputStyle}
              >
                {jobs.map(j => <option key={j.job_number} value={j.job_number}>Job {j.job_number}{j.description ? ` - ${j.description}` : ''}</option>)}
              </select>
            </label>
          )}
          <AddPartToWorkOrder
            unit={unit}
            markupPercent={markupDefault}
            onAdd={addPartFromCatalog}
          />
        </div>
      )}

      <div style={{ background: CARD }}>
        {error && (
          <p className="mx-5 mt-4 text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--hd-negative)', border: '1px solid rgba(239,68,68,0.3)' }}>
            {error}
          </p>
        )}

        {note && !error && (
          <p className="mx-5 mt-4 text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--hd-positive)', border: '1px solid rgba(34,197,94,0.3)' }}>
            {note}
          </p>
        )}

        {/* Before the save, not after. A row the tech can still fill in gets told it
            needs something rather than being deleted out from under him. */}
        {blankCount > 0 && (
          <p className="mx-5 mt-4 text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--hd-warn)', border: '1px solid rgba(245,158,11,0.3)' }}>
            {blankCount === 1
              ? 'One line has no description and no price. It will not be saved.'
              : `${blankCount} lines have no description and no price. They will not be saved.`}
          </p>
        )}

        {loading ? (
          <p className="p-5 text-xs" style={{ color: 'var(--hd-text-faint)' }}>Loading line items…</p>
        ) : lines.length === 0 && !hasJobs ? (
          <div className="p-5">
            <p className="text-xs py-4 text-center" style={{ color: 'var(--hd-text-faint)', border: `1px dashed ${BORDER}`, borderRadius: 8 }}>
              {canEdit ? 'No parts or labor on this job yet — add a line above' : 'No parts or labor on this job'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 860 }}>
              <thead style={{ background: HEAD }}>
                <tr style={{ color: 'var(--hd-text-faint)' }}>
                  <th className={thCls} style={{ width: 60 }}>Type</th>
                  <th className={thCls} style={{ width: 130 }}>Part #</th>
                  <th className={thCls}>Description</th>
                  <th className={thCls} style={{ width: 80 }}>Qty</th>
                  <th className={thCls} style={{ width: 100 }}>Your Cost</th>
                  <th className={thCls} style={{ width: 90 }}>Markup %</th>
                  <th className={thCls} style={{ width: 100 }}>Sell / Unit</th>
                  <th className={thCls} style={{ width: 100, textAlign: 'right' }}>Total</th>
                  {canEdit && <th className={thCls} style={{ width: 80 }} />}
                </tr>
              </thead>
              <tbody>
                {jobs.flatMap(job => {
                  const jobLines = lines.filter(l => l.job_number === job.job_number)
                  const jt = draftTotals(jobLines)
                  // The job's header: what the repair is, where it stands, its own add
                  // buttons, and its subtotal. Shown once migration 177 is in.
                  const header = hasJobs ? [(
                    <tr key={`job-${job.job_number}`} style={{ borderTop: `2px solid ${BORDER}`, background: 'var(--hd-sunken)' }}>
                      <td colSpan={cols} className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-condensed font-bold text-sm tracking-widest text-white">JOB {job.job_number}</span>
                          <input
                            className="flex-1 min-w-[180px] px-2 py-1.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20"
                            style={inputStyle} disabled={!canEdit}
                            value={job.description} onChange={e => updateJob(job.job_number, { description: e.target.value })}
                            placeholder="What this repair is, e.g. Replace compressor"
                          />
                          <select
                            value={job.status} disabled={!canEdit}
                            onChange={e => updateJob(job.job_number, { status: e.target.value as JobStatus })}
                            className="px-2 py-1.5 rounded-lg text-xs text-white" style={inputStyle}
                          >
                            {JOB_STATUSES.map(s => <option key={s} value={s}>{s === 'open' ? 'Open' : 'Complete'}</option>)}
                          </select>
                          {canEdit && (
                            <>
                              <button type="button" onClick={() => addLine('labor', job.job_number)}
                                className="px-3 py-1.5 rounded-lg text-xs font-condensed font-bold tracking-wide"
                                style={{ background: `${tint(HD_ORANGE, 9)}`, color: 'var(--hd-text)', border: `1px solid ${tint(HD_ORANGE, 33)}` }}>
                                + Labor
                              </button>
                              <button type="button" onClick={() => addLine('part', job.job_number)}
                                className="px-3 py-1.5 rounded-lg text-xs font-condensed font-bold tracking-wide"
                                style={{ background: `${tint(BLUE, 9)}`, color: 'var(--hd-info)', border: `1px solid ${tint(BLUE, 33)}` }}>
                                + Part
                              </button>
                              {jobs.length > 1 && jobLines.length === 0 && (
                                <button type="button" onClick={() => removeJob(job.job_number)}
                                  className="px-2 py-1.5 rounded-lg text-xs" style={{ color: 'var(--hd-negative)', border: '1px solid rgba(239,68,68,0.3)' }}
                                  title="Remove this empty job">Remove job</button>
                              )}
                            </>
                          )}
                          <span className="ml-auto text-xs" style={{ color: 'var(--hd-text-muted)' }}>
                            Labor {fmt(jt.labor)} · Parts {fmt(jt.parts)} · <span className="font-semibold text-white">Job subtotal {fmt(jt.total)}</span>
                          </span>
                        </div>
                      </td>
                    </tr>
                  )] : []
                  const empty = hasJobs && jobLines.length === 0 ? [(
                    <tr key={`job-${job.job_number}-empty`}>
                      <td colSpan={cols} className="px-3 py-3 text-xs" style={{ color: 'var(--hd-text-faint)' }}>
                        No lines on this job yet.
                      </td>
                    </tr>
                  )] : []
                  return [...header, ...empty, ...jobLines.map((d, i) => {
                  const isPart = d.type === 'part'
                  return (
                    <tr key={d.key} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <td className="px-3 py-2">
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                          style={isPart
                            ? { background: `${tint(BLUE, 13)}`, color: 'var(--hd-info)' }
                            // Small text that says which line is labor: dark ink, not orange.
                            : { background: `${tint(HD_ORANGE, 13)}`, color: 'var(--hd-text)' }}
                        >
                          {isPart ? 'PRT' : 'LAB'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {isPart ? (
                          <input
                            className={inputCls} style={inputStyle} disabled={!canEdit}
                            value={d.part_number} onChange={e => update(d.key, { part_number: e.target.value })}
                            placeholder="37-33-6021"
                          />
                        ) : (
                          <span style={{ color: 'var(--hd-text-faint)' }}>—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className={inputCls} style={inputStyle} disabled={!canEdit}
                          value={d.description} onChange={e => update(d.key, { description: e.target.value })}
                          placeholder={isPart ? 'Part description' : 'R&R fuel filter primary'}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {/* Labor bills by the hour, so quantity IS hours and the step
                            matches how a tech books time. */}
                        <input
                          type="number" min="0" step={isPart ? '1' : '0.25'}
                          className={inputCls} style={inputStyle} disabled={!canEdit}
                          value={d.quantity} onChange={e => update(d.key, { quantity: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {isPart ? (
                          <input
                            type="number" min="0" step="0.01"
                            className={inputCls} style={inputStyle} disabled={!canEdit}
                            value={d.unit_cost} onChange={e => update(d.key, { unit_cost: e.target.value })}
                            placeholder="0.00"
                          />
                        ) : (
                          <span style={{ color: 'var(--hd-text-faint)' }}>—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isPart ? (
                          <input
                            type="number" min="0" step="1"
                            className={inputCls} style={inputStyle} disabled={!canEdit}
                            value={d.markup_percent} onChange={e => update(d.key, { markup_percent: e.target.value })}
                          />
                        ) : (
                          <span style={{ color: 'var(--hd-text-faint)' }}>—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {/* A part's sell price is computed from cost + markup and is
                            never typed, so the two can never disagree. Labor has no
                            markup — the hourly rate is already the sell price, so it
                            stays an editable field. */}
                        {isPart ? (
                          <span className="font-semibold" style={{ color: 'rgba(var(--hd-ink-rgb), 0.85)' }}>{fmt(draftSell(d))}</span>
                        ) : (
                          <input
                            type="number" min="0" step="0.01"
                            className={inputCls} style={inputStyle} disabled={!canEdit}
                            value={d.unit_price} onChange={e => update(d.key, { unit_price: e.target.value })}
                            placeholder="Rate/hr"
                          />
                        )}
                      </td>
                      {/* An empty row reads as "needs a description", not $0.00. A
                          money figure on a line that carries nothing is what made two
                          blank LAB rows look like a billing bug rather than a row
                          nobody had filled in yet. */}
                      {isBlank(d) ? (
                        <td className="px-3 py-2 text-right text-xs" style={{ color: 'var(--hd-warn)' }}>needs a description</td>
                      ) : (
                        <td className="px-3 py-2 text-right font-semibold text-white">{fmt(draftTotal(d))}</td>
                      )}
                      {canEdit && (
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => move(d.key, -1)} disabled={i === 0}
                              className="px-1.5 py-0.5 rounded text-xs disabled:opacity-25" style={{ color: 'var(--hd-text-muted)', border: `1px solid ${BORDER}` }} title="Move up">↑</button>
                            <button type="button" onClick={() => move(d.key, 1)} disabled={i === jobLines.length - 1}
                              className="px-1.5 py-0.5 rounded text-xs disabled:opacity-25" style={{ color: 'var(--hd-text-muted)', border: `1px solid ${BORDER}` }} title="Move down">↓</button>
                            <button type="button" onClick={() => removeLine(d.key)}
                              className="px-1.5 py-0.5 rounded text-xs" style={{ color: 'var(--hd-negative)', border: '1px solid rgba(239,68,68,0.3)' }} title="Remove line">×</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                  })]
                })}
              </tbody>
            </table>
          </div>
        )}

        {lines.length > 0 && (
          <div className="px-5 py-4 flex justify-end" style={{ borderTop: `1px solid ${BORDER}` }}>
            <div style={{ width: 260 }}>
              {/* Each job's subtotal, so the tech can see they add up to the line total. */}
              {hasJobs && jobs.length > 1 && jobs.map(j => (
                <div key={`sub-${j.job_number}`} className="flex justify-between py-1 text-xs" style={{ color: 'var(--hd-text-muted)' }}>
                  <span>Job {j.job_number}{j.description ? ` - ${j.description}` : ''}</span>
                  <span>{fmt(draftTotals(lines.filter(l => l.job_number === j.job_number)).total)}</span>
                </div>
              ))}
              <div className="flex justify-between py-1 text-sm" style={{ color: 'var(--hd-text-muted)' }}>
                <span>Labor</span><span>{fmt(totals.labor)}</span>
              </div>
              <div className="flex justify-between py-1 text-sm" style={{ color: 'var(--hd-text-muted)' }}>
                <span>Parts</span><span>{fmt(totals.parts)}</span>
              </div>
              {/* Margin is the tech's own figure, shown here because this screen is
                  the internal job sheet. It is not on any customer-facing document. */}
              {totals.partsCost > 0 && (
                <div className="flex justify-between py-1 text-xs" style={{ color: 'var(--hd-text-faint)' }}>
                  <span>Parts cost (your margin {fmt(totals.parts - totals.partsCost)})</span><span>{fmt(totals.partsCost)}</span>
                </div>
              )}
              <div className="flex justify-between items-center pt-2 mt-1" style={{ borderTop: `2px solid ${HD_ORANGE}` }}>
                <span className="font-condensed font-bold text-sm tracking-widest text-white">LINE TOTAL</span>
                <span className="font-bold text-xl" style={{ color: 'var(--hd-text)' }}>{fmt(totals.total)}</span>
              </div>
              {/* The work order's own total_amount is a separate stored figure that
                  predates these rows. It is left untouched on purpose so the
                  financials pages that read it do not shift under a saved line.

                  SAYING WHAT THIS COVERS, because the details block above shows the
                  Quoted Total and the two do not match. They are not supposed to:
                  that figure came off the quote and includes tax, travel, mileage and
                  fees, and this one is parts and labor. Both were labelled as totals,
                  so a correct pair of numbers read as a billing error. */}
              <p className="text-xs mt-2" style={{ color: 'var(--hd-text-faint)' }}>
                Parts and labor only. Tax, travel and fees are added when you bill
                this job, so this will not match the Quoted Total above.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
