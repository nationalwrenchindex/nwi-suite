// GET /api/hd/reports/audit-schedule?from=YYYY-MM-DD&to=YYYY-MM-DD&format=pdf|csv
//
// The equipment schedule for an insurance audit (spec 5.2): the category table and
// the per-unit appendix for the policy period. PDF and CSV carry the same figures -
// both are drawn from one buildAuditSchedule() result, whose numbers all come from
// the equipment rollup. Recorded values only; nothing recomputed.

import { type NextRequest } from 'next/server'
import { prepareAuditRequest, fileResponse, textResponse } from '@/lib/hd/audit-route'
import { buildAuditSchedule, auditScheduleCsv } from '@/lib/hd/audit-schedule'
import { renderAuditSchedulePdf } from '@/lib/hd/audit-pdf'
import { exportFilename } from '@/lib/hd/audit-csv'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const prep = await prepareAuditRequest(new URL(req.url))
  if (!prep.ok) return prep.response

  try {
    const schedule = buildAuditSchedule(prep.rollup, prep.ctx.shop, prep.ctx.labels)
    const { from, to } = schedule.range
    if (prep.format === 'csv') {
      return fileResponse(auditScheduleCsv(schedule), 'csv', exportFilename('audit-schedule', from, to, 'csv'))
    }
    const bytes = await renderAuditSchedulePdf(schedule)
    return fileResponse(bytes, 'pdf', exportFilename('audit-schedule', from, to, 'pdf'))
  } catch (err) {
    console.error('[hd audit-schedule]', err instanceof Error ? err.message : err)
    return textResponse(500, 'Could not build the audit schedule')
  }
}
