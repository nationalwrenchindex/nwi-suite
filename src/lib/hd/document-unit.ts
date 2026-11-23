// The unit a document names - ONE definition, shared by the work order page's "Unit X is
// not linked to a fleet unit record" line and by the code that links or creates the unit
// when a document is saved (lib/hd/document-links). Moved here from WorkOrderDetail.tsx
// unchanged, so the screen and the save path cannot disagree about whether a document
// names a unit.
//
// THE DOCUMENT'S RECORDED UNIT WINS, field by field; the linked hd_unit only fills what
// the document left empty - the same "recorded beats current" rule the rates, the tax and
// the terms already follow.

export function docFirst(doc: string | number | null | undefined, record: string | number | null | undefined): string | null {
  const d = doc == null ? '' : String(doc).trim()
  if (d) return d
  const r = record == null ? '' : String(record).trim()
  return r || null
}

export interface DocumentUnitFields {
  unit_number?: string | null
  unit_manufacturer?: string | null
  unit_model?: string | null
  unit_year?: string | number | null
  unit_serial?: string | null
  vin?: string | null
}

export interface LinkedUnitFields {
  unit_number?: string | null
  manufacturer?: string | null
  model?: string | null
  year?: string | number | null
  serial_number?: string | null
}

export interface DocumentUnitView {
  number: string | null
  manufacturer: string | null
  model: string | null
  year: string | null
  serial: string | null
  vin: string | null
}

export function documentUnitView(doc: DocumentUnitFields, unit: LinkedUnitFields | null | undefined): DocumentUnitView {
  return {
    number:       docFirst(doc.unit_number,       unit?.unit_number),
    manufacturer: docFirst(doc.unit_manufacturer, unit?.manufacturer),
    model:        docFirst(doc.unit_model,        unit?.model),
    year:         docFirst(doc.unit_year,         unit?.year),
    serial:       docFirst(doc.unit_serial,       unit?.serial_number),
    vin:          docFirst(doc.vin,               null),
  }
}

/** "53132 — Thermo King S-600 (2018)", or '—' when the document names no unit. */
export function unitLabelOf(view: DocumentUnitView): string {
  return [
    view.number,
    [view.manufacturer, view.model].filter(Boolean).join(' ') + (view.year ? ` (${view.year})` : '') || null,
  ].filter(s => s && s.trim()).join(' — ') || '—'
}

/**
 * The document names a unit but is not linked to one - the condition the work order page
 * words as "Unit X is not linked to a fleet unit record". A serial alone also names one.
 */
export function namesUnlinkedUnit(doc: DocumentUnitFields & { unit_id?: string | null }): boolean {
  if (doc.unit_id) return false
  const view = documentUnitView(doc, null)
  return unitLabelOf(view) !== '—' || !!view.serial
}
