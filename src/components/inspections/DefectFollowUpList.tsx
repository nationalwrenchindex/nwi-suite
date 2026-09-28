'use client'

// ─── Inspection defects that did not take the unit out of service ──────────────
//
// The other half of the fail/out-of-service split. A defect that deadlines a machine
// is handled now; one that does not still has to be handled eventually, and until this
// existed it sat on the record with nothing chasing it.
//
// Deliberately its OWN list rather than sharing /work-orders/follow-ups. That query
// reads work_order_segments with a hard-coded ld_work_order_id embed, and FollowUpRow
// is segment-shaped — work_order_number, sequence, grand_total, customer_note. An
// inspection defect has none of those: no work order, no sequence, no dollar figure.
// Forcing both through one query means a union across unrelated tables or fake columns
// on both sides. Same visual shape, separate query — so it reads as one idea to a shop
// without pretending to be one table.

import Link from 'next/link'

export interface DefectRow {
  /** Stable enough for a React key: the inspection plus the checkpoint. */
  key:            string
  inspectionId:   string
  /** Human reference — DOT-260928-AB12, or the uuid head when there is none. */
  reference:      string
  /** "DOT Annual", "Aerial Frequent", "Excavator Pre-Use". */
  formLabel:      string
  inspectionDate: string | null
  unitLabel:      string | null
  /** Checkpoint section, e.g. "Brake System". */
  sectionLabel:   string
  label:          string
  notes:          string
  oosNote:        string
  /** True when no out-of-service determination is on file (pre-141 record). */
  unassessed:     boolean
  href:           string
}

const fmtDate = (s: string | null) =>
  s ? new Date(`${s}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export default function DefectFollowUpList({ rows }: { rows: DefectRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="nwi-card text-center py-10">
        <p className="text-white/50 text-sm">Nothing outstanding.</p>
        <p className="text-white/30 text-xs mt-1">
          Defects that do not take a unit out of service land here so they can be
          scheduled rather than forgotten.
        </p>
      </div>
    )
  }

  // Unassessed first: those are the records where nobody said either way, so they are
  // the ones most worth a human deciding about.
  const sorted = [...rows].sort((a, b) => {
    if (a.unassessed !== b.unassessed) return a.unassessed ? -1 : 1
    return (b.inspectionDate ?? '').localeCompare(a.inspectionDate ?? '')
  })

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <p className="text-white/50 text-sm">
          {rows.length} open defect{rows.length === 1 ? '' : 's'}
        </p>
        {sorted.some(r => r.unassessed) && (
          <p className="text-xs" style={{ color: '#9ca3af' }}>
            {sorted.filter(r => r.unassessed).length} with no out-of-service determination on file
          </p>
        )}
      </div>

      {sorted.map(row => (
        <div key={row.key} className="nwi-card">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <p className="text-white font-semibold text-sm">{row.label}</p>
              <p className="text-white/40 text-xs mt-0.5">{row.sectionLabel}</p>
            </div>
            <span
              className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide flex-shrink-0"
              style={row.unassessed
                ? { background: '#9ca3af20', color: '#9ca3af' }
                : { background: '#d9770620', color: '#f59e0b' }}
            >
              {row.unassessed ? 'Not assessed' : 'In service'}
            </span>
          </div>

          {row.notes && (
            <p className="text-white/60 text-xs mt-2">
              <span className="text-white/35">Tech note: </span>{row.notes}
            </p>
          )}
          {row.oosNote && (
            <p className="text-white/60 text-xs mt-1">
              <span className="text-white/35">Reason: </span>{row.oosNote}
            </p>
          )}

          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/8 flex-wrap text-xs">
            <span className="text-white/40">{row.formLabel}</span>
            <span className="text-white/25">·</span>
            <span className="text-white/40">{fmtDate(row.inspectionDate)}</span>
            {row.unitLabel && (
              <>
                <span className="text-white/25">·</span>
                <span className="text-white/40">{row.unitLabel}</span>
              </>
            )}
            <Link
              href={row.href}
              className="ml-auto text-orange hover:underline font-semibold"
            >
              {row.reference} →
            </Link>
          </div>
        </div>
      ))}
    </div>
  )
}
