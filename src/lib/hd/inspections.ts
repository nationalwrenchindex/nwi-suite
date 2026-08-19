// Aerial (099) and DOT (049/083/100) inspections live in two tables but read as one
// compliance stream — everything performed on a job, or everything ever performed on
// a unit, newest first. The split is a schema detail, not something a tech thinks
// about, so the normalising happens once here rather than in every page that wants
// the combined view.

import type { AerialInspectionType } from '@/types/aerial'
import { AERIAL_TYPE_LABEL } from '@/lib/hd/aerial/forms'
import type { EquipmentType } from '@/types/equipment'
import { EQUIPMENT_TYPE_LABEL } from '@/lib/hd/equipment/forms'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export type InspectionFamily = 'aerial' | 'dot' | 'equipment'

/** The shape both tables collapse into. */
export interface InspectionSummary {
  id:     string
  family: InspectionFamily
  /** e.g. "Aerial Annual", "DOT Annual" — family + cadence, since DOT has only one. */
  typeLabel: string
  /** Stored DATE, still as YYYY-MM-DD; render it with `inspectionDateLabel`. */
  date:   string
  result: 'pass' | 'fail'
  inspectorName: string | null
  /** Detail route for this record. */
  href:   string
  /** Tie-breaker only — two inspections on the same day still need a stable order. */
  createdAt: string
}

interface AerialRow {
  id:              string
  inspection_type: AerialInspectionType
  inspection_date: string
  overall_result:  string | null
  inspector_name:  string | null
  operator_name:   string | null
  created_at:      string
}

interface DotRow {
  id:              string
  inspection_date: string
  overall_result:  string | null
  inspector_name:  string | null
  created_at:      string
}

interface EquipmentRow {
  id:              string
  equipment_type:  EquipmentType
  inspection_date: string
  overall_result:  string | null
  inspector_name:  string | null
  operator_name:   string | null
  created_at:      string
}

/** Anything that is not an explicit pass is treated as a fail — never silently green. */
function toResult(value: string | null): 'pass' | 'fail' {
  return value === 'pass' ? 'pass' : 'fail'
}

/**
 * Inspection dates are DATE columns, so `new Date('2026-01-05')` parses as UTC
 * midnight and renders as the 4th anywhere west of Greenwich. Midday sidesteps it.
 */
export function inspectionDateLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

/**
 * Both families, filtered on the same column name (`work_order_id` or `unit_id`),
 * always scoped to the signed-in user so a guessed id returns nothing.
 *
 * A missing table or column resolves to an empty list rather than throwing: 099 and
 * 100 may not have been applied to a given environment yet, and a work order that
 * cannot render is a worse failure than one that shows no inspections.
 */
async function loadInspections(
  supabase: SupabaseServerClient,
  userId:   string,
  column:   'work_order_id' | 'unit_id',
  value:    string,
): Promise<InspectionSummary[]> {
  const [aerialRes, dotRes, equipRes] = await Promise.all([
    supabase
      .from('hd_aerial_inspections')
      .select('id, inspection_type, inspection_date, overall_result, inspector_name, operator_name, created_at')
      .eq('user_id', userId)
      .eq(column, value),
    supabase
      .from('hd_dot_inspections')
      .select('id, inspection_date, overall_result, inspector_name, created_at')
      .eq('user_id', userId)
      .eq(column, value),
    supabase
      .from('hd_equipment_inspections')
      .select('id, equipment_type, inspection_date, overall_result, inspector_name, operator_name, created_at')
      .eq('user_id', userId)
      .eq(column, value),
  ])

  if (aerialRes.error) console.error('[hd inspections] aerial load failed:', aerialRes.error.message)
  if (dotRes.error)    console.error('[hd inspections] dot load failed:',    dotRes.error.message)
  if (equipRes.error)  console.error('[hd inspections] equipment load failed:', equipRes.error.message)

  const aerial = (aerialRes.data ?? []) as unknown as AerialRow[]
  const dot    = (dotRes.data    ?? []) as unknown as DotRow[]
  const equip  = (equipRes.data  ?? []) as unknown as EquipmentRow[]

  const combined: InspectionSummary[] = [
    ...aerial.map(row => ({
      id:        row.id,
      family:    'aerial' as const,
      typeLabel: `Aerial ${AERIAL_TYPE_LABEL[row.inspection_type] ?? ''}`.trim(),
      date:      row.inspection_date,
      result:    toResult(row.overall_result),
      // Pre-use inspections are signed by the operator, not an inspector.
      inspectorName: row.inspector_name ?? row.operator_name,
      href:      `/hd/aerial-inspections/${row.id}`,
      createdAt: row.created_at,
    })),
    ...dot.map(row => ({
      id:        row.id,
      family:    'dot' as const,
      typeLabel: 'DOT Annual',
      date:      row.inspection_date,
      result:    toResult(row.overall_result),
      inspectorName: row.inspector_name,
      href:      `/hd/dot-inspections/${row.id}`,
      createdAt: row.created_at,
    })),
    ...equip.map(row => ({
      id:        row.id,
      family:    'equipment' as const,
      typeLabel: EQUIPMENT_TYPE_LABEL[row.equipment_type] ?? 'Equipment',
      date:      row.inspection_date,
      result:    toResult(row.overall_result),
      // Daily pre-use forms are signed by the operator, not an inspector.
      inspectorName: row.inspector_name ?? row.operator_name,
      href:      `/hd/equipment-inspections/${row.id}`,
      createdAt: row.created_at,
    })),
  ]

  return combined.sort((a, b) =>
    b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  )
}

export function fetchWorkOrderInspections(
  supabase:    SupabaseServerClient,
  userId:      string,
  workOrderId: string,
): Promise<InspectionSummary[]> {
  return loadInspections(supabase, userId, 'work_order_id', workOrderId)
}

export function fetchUnitInspections(
  supabase: SupabaseServerClient,
  userId:   string,
  unitId:   string,
): Promise<InspectionSummary[]> {
  return loadInspections(supabase, userId, 'unit_id', unitId)
}
