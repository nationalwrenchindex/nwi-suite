// GET /api/hd/reports/audit-packet?from=YYYY-MM-DD&to=YYYY-MM-DD&format=pdf|csv
//
// The documentation packet for a care, custody and control audit (spec 5.3): a cover
// summary, then one work order per page - unit, customer, dates, the authorization
// record, the approved quote as presented, parts and labor as recorded, the tech and
// the invoice. The CSV is the same rows, one per work order.
//
// Work orders opened in the period, cancelled and imported history excluded (the
// cover says how many). Who approved a quote is not recorded anywhere in NWI; the
// packet prints "Not recorded" rather than a name it does not have.

import { type NextRequest } from 'next/server'
import { prepareAuditRequest, fileResponse, textResponse } from '@/lib/hd/audit-route'
import { loadPacketInput } from '@/lib/hd/audit-load'
import { buildAuditPacket, auditPacketCsv } from '@/lib/hd/audit-packet'
import { renderAuditPacketPdf } from '@/lib/hd/audit-pdf'
import { exportFilename } from '@/lib/hd/audit-csv'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const prep = await prepareAuditRequest(new URL(req.url))
  if (!prep.ok) return prep.response

  try {
    const input = await loadPacketInput(prep.supabase, prep.rollup)
    const packet = buildAuditPacket(input, prep.ctx.shop, prep.ctx.labels)
    const { from, to } = packet.range
    if (prep.format === 'csv') {
      return fileResponse(auditPacketCsv(packet), 'csv', exportFilename('audit-packet', from, to, 'csv'))
    }
    const bytes = await renderAuditPacketPdf(packet)
    return fileResponse(bytes, 'pdf', exportFilename('audit-packet', from, to, 'pdf'))
  } catch (err) {
    console.error('[hd audit-packet]', err instanceof Error ? err.message : err)
    return textResponse(500, 'Could not build the audit packet')
  }
}
