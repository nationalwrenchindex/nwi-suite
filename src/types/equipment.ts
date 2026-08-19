// Construction and heavy-equipment inspection types.
//
// Deliberately mirrors src/types/aerial.ts: same section/item/result model, same
// signing and deficiency semantics, so equipment inspections print, attach to
// work orders and flag overdue exactly the way aerial inspections already do.
//
// One record shape covers every machine class. The classes differ only in which
// sections they carry, which is a data question answered by the form definitions
// in lib/hd/equipment/forms.ts — not a schema question. That is why there is one
// hd_equipment_inspections table rather than eleven, the same call migration 099
// made for the three aerial cadences.

export type EquipmentType =
  | 'excavator'
  | 'mini_excavator'
  | 'skid_steer'
  | 'dozer'
  | 'backhoe'
  | 'trencher'
  | 'telehandler'
  | 'forklift'
  | 'crane_frequent'
  | 'crane_annual'
  | 'compactor'
  | 'utv'

export type ItemResult = 'pass' | 'fail' | 'na'

export interface EquipmentItemState {
  result: ItemResult | ''
  notes:  string
}

export interface EquipmentItem {
  id:    string
  label: string
  /**
   * A machine failing one of these may not be operated. Failing it forces the
   * removal-from-service determination and fails the whole inspection.
   */
  safetyCritical?: boolean
}

export interface EquipmentSection {
  id:    string
  num:   number
  label: string
  items: EquipmentItem[]
}

export interface EquipmentFormDef {
  type:     EquipmentType
  title:    string
  /** Regulatory citation printed on the document. */
  citation: string
  /** Shown under the title; states the cadence requirement. */
  cadence:  string
  sections: EquipmentSection[]
  /** Crane annual (ASME B30.5) requires a qualified inspector credential. */
  requiresInspectorCert: boolean
  /** Periodic cadences capture hour meter and prior inspection dates. */
  requiresServiceHistory: boolean
  /** Daily pre-use forms are run by the operator and capture shift context. */
  requiresOperatorContext: boolean
  /** Crane inspections record load-test documentation on sign-off. */
  requiresLoadTest?: boolean
}

/** Persisted payload — `inspection_data` in hd_equipment_inspections. */
export interface EquipmentInspectionData {
  sections: Record<string, { items: Record<string, EquipmentItemState> }>
}

export interface EquipmentDeficiency {
  sectionId: string
  itemId:    string
  label:     string
  notes:     string
  safetyCritical: boolean
}

export interface EquipmentInspectionRecord {
  id:                    string
  user_id:               string
  unit_id:               string | null
  fleet_account_id:      string | null
  work_order_id:         string | null
  invoice_id:            string | null
  equipment_type:        EquipmentType
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
  load_test_performed:   boolean | null
  load_test_date:        string | null
  load_test_notes:       string | null
  inspection_data:       EquipmentInspectionData
  deficiencies:          EquipmentDeficiency[]
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
export function allItems(def: EquipmentFormDef): Array<EquipmentItem & { sectionId: string }> {
  return def.sections.flatMap(s => s.items.map(i => ({ ...i, sectionId: s.id })))
}

/** Collects failed items, so the record carries them without re-deriving. */
export function collectDeficiencies(
  def:  EquipmentFormDef,
  data: EquipmentInspectionData,
): EquipmentDeficiency[] {
  const out: EquipmentDeficiency[] = []
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

/** Any failure fails the inspection — there is no partial pass on a machine. */
export function overallResult(deficiencies: EquipmentDeficiency[]): 'pass' | 'fail' {
  return deficiencies.length > 0 ? 'fail' : 'pass'
}

export function hasCriticalDeficiency(deficiencies: EquipmentDeficiency[]): boolean {
  return deficiencies.some(d => d.safetyCritical)
}

/** Count of items still unanswered — submission is blocked while > 0. */
export function unansweredCount(def: EquipmentFormDef, data: EquipmentInspectionData): number {
  return allItems(def).filter(i => {
    const st = data.sections[i.sectionId]?.items[i.id]
    return !st || st.result === ''
  }).length
}

export function emptyData(def: EquipmentFormDef): EquipmentInspectionData {
  const sections: EquipmentInspectionData['sections'] = {}
  for (const s of def.sections) {
    sections[s.id] = { items: Object.fromEntries(s.items.map(i => [i.id, { result: '' as const, notes: '' }])) }
  }
  return { sections }
}
