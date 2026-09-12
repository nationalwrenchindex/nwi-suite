// GET /api/hd/pm-checklist/[id]/pdf — the printable PM inspection report.
//
// Same generation approach as /api/hd/invoices/[id]/pdf and
// /api/hd/dot-inspections/[id]/pdf: a self-contained HTML document served as text/html
// with a print button, which the browser turns into a PDF. No PDF library is involved
// on purpose — those routes set the pattern and a second mechanism would mean two ways
// for the same signed record to render.
//
// The document itself is built in src/lib/hd/pm-report-attachment.ts, which the invoice
// email also calls, so the copy the tech prints and the copy the customer receives are
// the same document.
//
// Three audiences reach this record, matching the DOT route: the mechanic who performed
// the PM, the fleet whose unit it is, and the partner who resells that fleet. Anyone
// else gets a 403, including a signed-in mechanic who guessed the uuid. hd_pm_checklists
// has no fleet_account_id of its own — the fleet is reached through the unit, exactly as
// the RLS policy in migration 105 does it.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getFleetProMembership } from '@/lib/fleet-pro/access'
import { getPartner, partnerOwnsAccount } from '@/lib/fleet-pro/partner-access'
import { renderPMReportDocumentForChecklists } from '@/lib/hd/pm-report-attachment'

export const dynamic = 'force-dynamic'

function str(value: unknown): string | null {
  const s = value == null ? '' : String(value).trim()
  return s.length ? s : null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  // Read through the service client, then decide. Reading under the caller's own RLS
  // would hand the mechanic his row and leave the fleet and partner with a 404, which
  // is the wrong answer for two audiences that are entitled to the record.
  const svc = createServiceClient()
  const { data: pm } = await svc
    .from('hd_pm_checklists')
    .select('id, user_id, unit_id, invoice_id')
    .eq('id', id)
    .maybeSingle()

  if (!pm) return new NextResponse('Not found', { status: 404 })

  let allowed = str(pm.user_id) === user.id

  if (!allowed && pm.unit_id) {
    const { data: unit } = await svc
      .from('hd_units')
      .select('fleet_account_id')
      .eq('id', pm.unit_id)
      .maybeSingle()

    const fleetId = str(unit?.fleet_account_id)
    if (fleetId) {
      const membership = await getFleetProMembership(user.id)
      if (membership?.fleet_account_id === fleetId) allowed = true

      if (!allowed) {
        const partner = await getPartner(user.id)
        if (partner && await partnerOwnsAccount(partner.id, fleetId)) allowed = true
      }
    }
  }

  if (!allowed) return new NextResponse('Forbidden', { status: 403 })

  // The invoice number heads the document when the PM is attached to one, so a customer
  // holding both pages can tell at a glance that they belong to the same job.
  let invoiceNumber: string | null = null
  if (pm.invoice_id) {
    const { data: inv } = await svc
      .from('hd_invoices')
      .select('invoice_number')
      .eq('id', pm.invoice_id)
      .maybeSingle()
    invoiceNumber = str(inv?.invoice_number)
  }

  const doc = await renderPMReportDocumentForChecklists(svc, [String(pm.id)], { invoiceNumber })
  if (!doc) return new NextResponse('Not found', { status: 404 })

  return new NextResponse(doc.html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
