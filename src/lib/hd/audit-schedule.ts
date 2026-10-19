// The audit schedule (spec 5.2): one category table and a per-unit appendix, as data.
//
// PURE. Every number here comes from equipment-rollup.ts - jobsFor, rollupByCategory,
// rollupByUnit - so the schedule cannot disagree with the By Equipment screen. This
// file only chooses what to print and in what words. The PDF (audit-pdf.ts) and the
// CSV (below) are both drawn from the one AuditSchedule object, so they hold the same
// figures by construction.
//
// Unknown is not zero: a class or a unit whose jobs recorded no labor hours prints "-"
// (PDF) or an empty field (CSV), and the count of jobs without hours travels with it.

import {
  jobsFor, rollupByCategory, rollupByUnit, NO_UNIT,
  type RollupInput, type Job,
} from './equipment-rollup'
import { categoryLabel, type AuditLabels } from './audit-labels'
import { toCsv, type CsvValue } from './audit-csv'

export interface ShopHeader {
  /** Legal / business name as recorded on the profile. */
  name: string
  addressLines: string[]
}

export interface ScheduleCategoryRow {
  key: string
  label: string
  /** null for "No unit recorded": jobs with no unit have no class to count units in. */
  unitsInClass: number | null
  unitsServiced: number | null
  jobs: number
  laborHours: number | null
  jobsWithoutHours: number
  invoiced: number
}

export interface ScheduleUnitRow {
  unitId: string | null
  classLabel: string
  unitIdentifier: string | null
  make: string | null
  model: string | null
  year: number | null
  serial: string | null
  jobs: number
  laborHours: number | null
  jobsWithoutHours: number
  invoiced: number
}

export interface AuditSchedule {
  range: { from: string; to: string }
  timeZone: string
  generatedAt: string
  shop: ShopHeader
  labels: AuditLabels
  categories: ScheduleCategoryRow[]
  units: ScheduleUnitRow[]
  total: Omit<ScheduleCategoryRow, 'key' | 'label'>
  /** Jobs that are a closed work order with a recorded total and no NWI invoice. */
  jobsFromWorkOrders: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

function hoursOf(jobs: Job[]): { value: number | null; missing: number } {
  let total = 0, known = 0, missing = 0
  for (const j of jobs) { if (j.laborHours == null) missing++; else { total += j.laborHours; known++ } }
  return { value: known ? r2(total) : null, missing }
}

export function buildAuditSchedule(
  input: RollupInput,
  shop: ShopHeader,
  labels: AuditLabels,
  now: Date = new Date(),
): AuditSchedule {
  const jobs = jobsFor(input)
  const cats = rollupByCategory(input, jobs)
  const units = rollupByUnit(input, jobs)

  const categories: ScheduleCategoryRow[] = cats.map(c => ({
    key: c.key,
    label: categoryLabel(labels, c.key, c.name),
    unitsInClass: c.key === NO_UNIT ? null : c.unitsInClass,
    unitsServiced: c.key === NO_UNIT ? null : c.unitsServiced,
    jobs: c.jobs,
    laborHours: c.laborHours.value,
    jobsWithoutHours: c.laborHours.missing,
    invoiced: c.invoiced,
  }))

  // The appendix runs in the category table's order, then by unit identifier, so a
  // reader can find a unit under the class it was counted in.
  const order = new Map(cats.map((c, i) => [c.key, i]))
  const unitRows: ScheduleUnitRow[] = [...units]
    .sort((a, b) =>
      (order.get(a.categoryKey) ?? 999) - (order.get(b.categoryKey) ?? 999) ||
      String(a.unitNumber ?? '').localeCompare(String(b.unitNumber ?? ''), 'en', { numeric: true }) ||
      a.unitId.localeCompare(b.unitId))
    .map(u => ({
      unitId: u.unitId,
      classLabel: categoryLabel(labels, u.categoryKey, u.categoryName),
      unitIdentifier: u.unitNumber,
      make: u.manufacturer,
      model: u.model,
      year: u.year,
      serial: u.serial,
      jobs: u.jobs,
      laborHours: u.laborHours.value,
      jobsWithoutHours: u.laborHours.missing,
      invoiced: u.invoiced,
    }))

  // Jobs with no unit are not a unit, but leaving them out of the appendix would make
  // it total less than the category table. One row, said plainly.
  const noUnit = cats.find(c => c.key === NO_UNIT)
  if (noUnit && noUnit.jobs > 0) {
    unitRows.push({
      unitId: null,
      classLabel: categoryLabel(labels, NO_UNIT, noUnit.name),
      unitIdentifier: null, make: null, model: null, year: null, serial: null,
      jobs: noUnit.jobs,
      laborHours: noUnit.laborHours.value,
      jobsWithoutHours: noUnit.laborHours.missing,
      invoiced: noUnit.invoiced,
    })
  }

  const h = hoursOf(jobs)
  const known = (xs: Array<number | null>) => xs.reduce<number>((s, x) => s + (x ?? 0), 0)
  return {
    range: { ...input.range },
    timeZone: input.timeZone,
    generatedAt: now.toISOString(),
    shop,
    labels,
    categories,
    units: unitRows,
    total: {
      unitsInClass: known(categories.map(c => c.unitsInClass)),
      unitsServiced: known(categories.map(c => c.unitsServiced)),
      jobs: jobs.length,
      laborHours: h.value,
      jobsWithoutHours: h.missing,
      invoiced: r2(jobs.reduce((s, j) => s + j.invoiced, 0)),
    },
    jobsFromWorkOrders: jobs.filter(j => j.source === 'work_order').length,
  }
}

/**
 * The schedule as ONE CSV: a `section` column says which table a row belongs to
 * ("category", "total", "unit"), so the whole schedule is one file an auditor can
 * filter, and both tables share the header the labels define.
 */
export function auditScheduleCsv(s: AuditSchedule): string {
  const L = s.labels.text
  const header = [
    'section', L.classColumn, L.unitsInClass, L.unitsServiced,
    L.unitIdentifier, L.make, L.model, L.year, L.serial,
    L.jobs, L.laborHours, 'jobs_without_recorded_hours', L.totalInvoiced,
    'policy_period_from', 'policy_period_to',
  ]
  const tail = [s.range.from, s.range.to]
  const rows: CsvValue[][] = []
  for (const c of s.categories) {
    rows.push(['category', c.label, c.unitsInClass, c.unitsServiced, null, null, null, null, null,
      c.jobs, c.laborHours, c.jobsWithoutHours, c.invoiced, ...tail])
  }
  rows.push(['total', 'Total', s.total.unitsInClass, s.total.unitsServiced, null, null, null, null, null,
    s.total.jobs, s.total.laborHours, s.total.jobsWithoutHours, s.total.invoiced, ...tail])
  for (const u of s.units) {
    rows.push(['unit', u.classLabel, null, null, u.unitIdentifier, u.make, u.model, u.year, u.serial,
      u.jobs, u.laborHours, u.jobsWithoutHours, u.invoiced, ...tail])
  }
  return toCsv(header, rows)
}
