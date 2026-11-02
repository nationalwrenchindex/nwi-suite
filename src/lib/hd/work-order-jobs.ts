// Jobs on an HD work order (migration 177): one work order, several separate repairs.
//
// A JOB IS A GROUPING OF LINES, nothing more. It carries no money of its own. A job's
// subtotal is the sum of its lines' stored totals; tax, markup, shop supplies, travel,
// mileage, the fees and the discount stay on the WORK ORDER exactly as before. So the
// job subtotals always add up to the lines' labor + parts, and the work order's total
// is figured the same way it always was - jobs cannot move it by a cent.
//
// Not built, deliberately: per-job authorization (status, approved_at and approved_by
// are on the row, wired to nothing), reordering jobs, templates, per-job tech or
// schedule, copying a job between work orders.

export type JobStatus = 'open' | 'complete'
export const JOB_STATUSES: readonly JobStatus[] = ['open', 'complete']

export interface WorkOrderJob {
  id?: string
  job_number: number
  description: string | null
  status: JobStatus
}

const r2 = (n: number): number => Math.round(n * 100) / 100

/** "Job 2 - Replace compressor", or "Job 2" with no description. */
export function jobLabel(job: { job_number: number; description?: string | null }): string {
  const d = (job.description ?? '').trim()
  return d ? `Job ${job.job_number} - ${d}` : `Job ${job.job_number}`
}

export function isJobStatus(v: unknown): v is JobStatus {
  return v === 'open' || v === 'complete'
}

/**
 * True when the database does not have migration 177 yet: the jobs table or the
 * line's job_id column is missing. Code deploys before Brock applies the migration, so
 * every reader treats that as "no jobs" and every writer as "one job" until it is there.
 */
export function isMissingJobsSchema(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null
  if (!e) return false
  const msg = String(e.message ?? '')
  return e.code === '42P01' || e.code === 'PGRST205' || e.code === '42703' || e.code === 'PGRST204'
    ? /hd_work_order_jobs|job_id/.test(msg)
    : false
}

/** One job's slice of an invoice: its heading, its lines, and their sum. */
export interface InvoiceJobGroup<L> {
  /** null for lines that belong to no job (a late fee, a line added on the invoice). */
  job: number | null
  label: string | null
  lines: L[]
  subtotal: number
}

/**
 * The invoice's lines grouped by job, for every place an HD invoice is shown.
 *
 * Returns null when the invoice has fewer than two jobs, so a single-job invoice - every
 * invoice written before jobs existed, and every new one with one repair on it - renders
 * exactly as it always has, with no heading. Lines with no job (a late fee, a line added
 * in the invoice editor) come last, under no heading, so nothing is ever dropped.
 *
 * The subtotal is the sum of the lines' stored `amount`, the figure each line already
 * shows. It is display only; no total on the invoice is derived from it.
 */
export function invoiceJobGroups<L extends { job?: unknown; job_label?: unknown; amount?: unknown }>(
  lines: L[],
): InvoiceJobGroup<L>[] | null {
  const jobOf = (l: L): number | null => {
    const n = Number(l.job)
    return l.job != null && Number.isInteger(n) && n > 0 ? n : null
  }
  const numbers = new Set(lines.map(jobOf).filter((n): n is number => n != null))
  if (numbers.size < 2) return null

  const groups = new Map<number | null, InvoiceJobGroup<L>>()
  for (const l of lines) {
    const job = jobOf(l)
    const g = groups.get(job) ?? { job, label: null, lines: [], subtotal: 0 }
    if (job != null && !g.label) {
      g.label = typeof l.job_label === 'string' && l.job_label.trim() ? l.job_label.trim() : `Job ${job}`
    }
    g.lines.push(l)
    g.subtotal = r2(g.subtotal + (Number(l.amount) || 0))
    groups.set(job, g)
  }
  const ordered = [...groups.values()].filter(g => g.job != null).sort((a, b) => (a.job as number) - (b.job as number))
  const loose = groups.get(null)
  return loose ? [...ordered, loose] : ordered
}
