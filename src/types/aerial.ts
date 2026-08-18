// ANSI A92 / OSHA 1926.453 aerial inspection types.
//
// The three cadences share one shape. A form is a list of sections, each a list
// of items; results are recorded per item exactly as hd_dot_inspections does, so
// the two families print and sign the same way.

export type AerialInspectionType = 'pre_use' | 'frequent' | 'annual'

export type ItemResult = 'pass' | 'fail' | 'na'

export interface AerialItemState {
  result: ItemResult | ''
  notes:  string
}

export interface AerialItem {
  id:    string
  label: string
  /**
   * OSHA requires a machine with a critical deficiency to be removed from
   * service. Failing one of these drives the removed_from_service checkbox and
   * forces the overall result to fail.
   */
  safetyCritical?: boolean
}

export interface AerialSection {
  id:    string
  num:   number
  label: string
  items: AerialItem[]
}

/** A complete form definition — the only thing that differs per cadence. */
export interface AerialFormDef {
  type:     AerialInspectionType
  title:    string
  /** Regulatory citation printed on the document. */
  citation: string
  /** Shown under the title; states the cadence requirement. */
  cadence:  string
  sections: AerialSection[]
  /** Annual (A92.20) requires an inspector credential; pre-use does not. */
  requiresInspectorCert: boolean
  /** Frequent/annual capture hour meter and prior inspection dates. */
  requiresServiceHistory: boolean
  /** Pre-use is performed by the operator and captures shift + certification. */
  requiresOperatorContext: boolean
}

/** Persisted payload — `inspection_data` in hd_aerial_inspections. */
export interface AerialInspectionData {
  sections: Record<string, { items: Record<string, AerialItemState> }>
}

export interface AerialDeficiency {
  sectionId: string
  itemId:    string
  label:     string
  notes:     string
  safetyCritical: boolean
}

export interface AerialInspectionRecord {
  id:                    string
  user_id:               string
  unit_id:               string | null
  fleet_account_id:      string | null
  work_order_id:         string | null
  inspection_type:       AerialInspectionType
  inspection_date:       string
  shift:                 string | null
  operator_name:         string | null
  operator_cert_current: boolean | null
  unit_identifier:       string | null
  unit_make:             string | null
  unit_model:            string | null
  unit_serial:           string | null
  hour_meter:            number | null
  last_frequent_date:    string | null
  last_annual_date:      string | null
  inspection_data:       AerialInspectionData
  deficiencies:          AerialDeficiency[]
  overall_result:        'pass' | 'fail'
  removed_from_service:  boolean
  inspector_name:        string | null
  inspector_cert_number: string | null
  signature_data:        string | null
  locked:                boolean
  locked_at:             string | null
  inspection_id:         string | null
  created_at:            string
}

/** Every item across every section, flattened. */
export function allItems(def: AerialFormDef): Array<AerialItem & { sectionId: string }> {
  return def.sections.flatMap(s => s.items.map(i => ({ ...i, sectionId: s.id })))
}

/** Collects failed items, so the record carries them without re-deriving. */
export function collectDeficiencies(
  def:  AerialFormDef,
  data: AerialInspectionData,
): AerialDeficiency[] {
  const out: AerialDeficiency[] = []
  for (const section of def.sections) {
    for (const item of section.items) {
      const st = data.sections[section.id]?.items[item.id]
      if (st?.result !== 'fail') continue
      out.push({
        sectionId: section.id,
        itemId:    item.id,
        label:     item.label,
        notes:     st.notes ?? '',
        safetyCritical: !!item.safetyCritical,
      })
    }
  }
  return out
}

/**
 * A single failure fails the inspection — an aerial lift with any defective
 * item is not compliant, so there is no partial pass.
 */
export function overallResult(deficiencies: AerialDeficiency[]): 'pass' | 'fail' {
  return deficiencies.length > 0 ? 'fail' : 'pass'
}

export function hasCriticalDeficiency(deficiencies: AerialDeficiency[]): boolean {
  return deficiencies.some(d => d.safetyCritical)
}

/** Count of items still unanswered — submission is blocked while > 0. */
export function unansweredCount(def: AerialFormDef, data: AerialInspectionData): number {
  return allItems(def).filter(i => {
    const st = data.sections[i.sectionId]?.items[i.id]
    return !st || st.result === ''
  }).length
}

export function emptyData(def: AerialFormDef): AerialInspectionData {
  const sections: AerialInspectionData['sections'] = {}
  for (const s of def.sections) {
    sections[s.id] = { items: Object.fromEntries(s.items.map(i => [i.id, { result: '' as const, notes: '' }])) }
  }
  return { sections }
}
