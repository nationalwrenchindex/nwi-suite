// Reefer unit details (migration 170): setpoint and the tractor a reefer unit rides on.
// hd_units has no column for any of these and is never altered, so they live in
// reefer_unit_details, one row per unit. Pure helpers; the units screen does the I/O.

export interface ReeferUnitDetails {
  setpoint_f:  number | null
  truck_make:  string | null
  truck_model: string | null
  truck_year:  number | null
  vin:         string | null
}

export const REEFER_UNIT_DETAILS_COLUMNS = 'unit_id, setpoint_f, truck_make, truck_model, truck_year, vin'

export const EMPTY_REEFER_UNIT_DETAILS: ReeferUnitDetails = {
  setpoint_f: null, truck_make: null, truck_model: null, truck_year: null, vin: null,
}

const text = (v: FormDataEntryValue | null, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s.slice(0, max) : null
}

/** Read the five fields from the unit form. Out-of-range numbers are dropped, never guessed. */
export function reeferUnitDetailsFromForm(fd: FormData): ReeferUnitDetails {
  const sp = text(fd.get('setpoint_f'), 10)
  const setpoint = sp != null && Number.isFinite(Number(sp)) ? Number(sp) : null
  const yr = text(fd.get('truck_year'), 4)
  const year = yr != null && /^\d{4}$/.test(yr) ? Number(yr) : null
  return {
    setpoint_f:  setpoint != null && setpoint >= -40 && setpoint <= 90 ? Math.round(setpoint * 10) / 10 : null,
    truck_make:  text(fd.get('truck_make'), 60),
    truck_model: text(fd.get('truck_model'), 60),
    truck_year:  year != null && year >= 1950 && year <= 2100 ? year : null,
    vin:         text(fd.get('vin'), 17)?.toUpperCase() ?? null,
  }
}

/** True when nothing was entered - no row is written for an empty form. */
export function isEmptyReeferUnitDetails(d: ReeferUnitDetails): boolean {
  return Object.values(d).every(v => v == null)
}

/** Migration 170 not applied yet: the table is missing. */
export function isMissingReeferUnitDetailsTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  return err.code === '42P01' || err.code === 'PGRST205' || /reefer_unit_details/.test(err.message ?? '') && /does not exist|schema cache/.test(err.message ?? '')
}
