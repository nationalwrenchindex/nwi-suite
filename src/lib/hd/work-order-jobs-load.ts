// SERVER ONLY. Reading an HD work order's lines together with its jobs (migration 177).
//
// Code deploys before the migration is applied, so both reads fall back: without the
// job_id column the lines are read exactly as before, and without the jobs table there
// are no jobs. `hasJobs` says which world this is, so a writer can refuse to save
// several jobs into a database that cannot hold them.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isJobStatus, isMissingJobsSchema, type WorkOrderJob } from '@/lib/hd/work-order-jobs'
import { isMissingRepairItemColumn } from '@/lib/hd/labor-card-link'

export const LINE_SELECT = 'id, work_order_id, type, description, part_number, quantity, unit_cost, unit_price, markup_percent, total, sort_order'

export interface LinesAndJobs {
  lines: Array<Record<string, unknown>>
  jobs: WorkOrderJob[]
  /** false until migration 177 is applied. */
  hasJobs: boolean
  error: { message: string } | null
}

export async function loadLinesAndJobs(supabase: SupabaseClient, workOrderId: string): Promise<LinesAndJobs> {
  let hasJobs = true
  const read = (cols: string) => supabase
    .from('hd_work_order_line_items')
    .select(cols)
    .eq('work_order_id', workOrderId)
    .order('sort_order', { ascending: true })
    .then(r => ({ data: r.data as unknown as Array<Record<string, unknown>> | null, error: r.error }))
  // job_id (177) and repair_item_id (187) are each dropped from the read when the
  // database does not have them yet; the lines come back exactly as before.
  let cols = [LINE_SELECT, 'job_id', 'repair_item_id']
  let res = await read(cols.join(', '))
  for (let tries = 0; res.error && tries < 2; tries++) {
    if (cols.includes('repair_item_id') && isMissingRepairItemColumn(res.error)) {
      cols = cols.filter(c => c !== 'repair_item_id')
    } else if (cols.includes('job_id') && isMissingJobsSchema(res.error)) {
      hasJobs = false
      cols = cols.filter(c => c !== 'job_id')
    } else break
    res = await read(cols.join(', '))
  }
  if (res.error) return { lines: [], jobs: [], hasJobs, error: res.error }

  let jobs: WorkOrderJob[] = []
  if (hasJobs) {
    const j = await supabase
      .from('hd_work_order_jobs')
      .select('id, job_number, description, status')
      .eq('work_order_id', workOrderId)
      .order('job_number', { ascending: true })
    if (j.error) {
      if (!isMissingJobsSchema(j.error)) return { lines: [], jobs: [], hasJobs, error: j.error }
      hasJobs = false
    } else {
      jobs = (j.data ?? []).map(r => ({
        id: String(r.id),
        job_number: Number(r.job_number),
        description: (r.description as string | null) ?? null,
        status: isJobStatus(r.status) ? r.status : 'open',
      }))
    }
  }

  return { lines: (res.data ?? []) as Array<Record<string, unknown>>, jobs, hasJobs, error: null }
}
