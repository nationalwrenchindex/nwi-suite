// GET  /api/hd/invoices/[id]/return   what the ledger holds for this invoice, by part
// POST /api/hd/invoices/[id]/return   { returns: [{ part_id, quantity }], note }
//
// RETURN PARTS TO STOCK (Nov 15). The customer refused a repair, the job was dismissed
// or never finished, and the parts physically came back - on an invoice that is
// permanent (sent, paid, partial, void, overdue). An unsent draft is corrected by
// Refresh instead, which already puts parts back by the difference.
//
// BY PART, with a quantity, capped at what the LEDGER holds for that part on this
// invoice right now - after every refresh and every earlier return - never what the
// invoice originally took. The lines each part appears on are shown for context only.
//
// STOCK ONLY. New 'customer_returned' movements (migration 189), each with the note, a
// timestamp and who did it. The invoice row is not written at all: its total, tax,
// lines, number, pay link and status stay exactly as they were.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkHDAccess, reeferStandaloneCan } from '@/lib/hd-access'
import { canCustomerReturn, customerReturnRefusedMessage } from '@/lib/hd/invoice-lock'
import {
  CUSTOMER_RETURN_REASON, readInvoiceMovements, returnInvoiceStock, summarizeInvoiceStock,
} from '@/lib/inventory/ledger'
import { normalizePartNumber } from '@/lib/parts/search'

export const dynamic = 'force-dynamic'

const NOTE_MAX = 300

async function gate(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const hasAccess = (await checkHDAccess(user.id)) || (await reeferStandaloneCan(user.id, 'reefer_invoices'))
  if (!hasAccess) return { res: NextResponse.json({ error: 'HD subscription required' }, { status: 403 }) }
  const { data } = await supabase.from('hd_invoices').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!data) return { res: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { userId: user.id, invoice: data as Record<string, unknown> }
}

/** The ledger's view of this invoice, by part, with the lines each part is on. */
async function stockView(userId: string, invoice: Record<string, unknown>) {
  const service = createServiceClient()
  const read = await readInvoiceMovements(service, userId, 'hd', String(invoice.id))
  if (read.error) return { error: read.error }
  const parts = summarizeInvoiceStock(read.movements, pid => read.partNumbers.get(pid) ?? pid)

  const lines = Array.isArray(invoice.line_items) ? invoice.line_items as Array<Record<string, unknown>> : []
  const onLines = (partNumber: string) => lines
    .filter(l => typeof l.part_number === 'string' && l.part_number && normalizePartNumber(String(l.part_number)) === normalizePartNumber(partNumber))
    .map(l => ({
      description: String(l.description ?? l.part_number ?? ''),
      quantity: Number(l.quantity ?? 0),
      job: l.job != null ? Number(l.job) : null,
      job_label: typeof l.job_label === 'string' ? l.job_label : null,
    }))

  const returns = read.movements.filter(m => m.reason === CUSTOMER_RETURN_REASON)
  const who = [...new Set(returns.map(m => m.createdBy).filter((x): x is string => !!x))]
  const names = new Map<string, string>()
  if (who.length) {
    const { data: ps } = await service.from('profiles').select('id, full_name, business_name, hd_tech_name, email').in('id', who)
    for (const p of ps ?? []) names.set(String(p.id), String(p.hd_tech_name || p.full_name || p.business_name || p.email || 'this account'))
  }

  return {
    parts: parts.map(p => ({
      part_id: p.partId, part_number: p.partNumber,
      taken: p.taken, customer_returned: p.customerReturned, returnable: Math.max(0, p.taken),
      lines: onLines(p.partNumber),
    })),
    returns: returns.map(m => ({
      part_number: read.partNumbers.get(m.partId) ?? m.partId,
      quantity: m.delta, at: m.createdAt, note: m.note, by: m.createdBy ? (names.get(m.createdBy) ?? 'this account') : null,
    })),
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await gate(id)
  if ('res' in g) return g.res
  const view = await stockView(g.userId, g.invoice)
  if ('error' in view) return NextResponse.json({ error: `Could not read this invoice's stock: ${view.error}` }, { status: 500 })
  const can = canCustomerReturn(g.invoice)
  return NextResponse.json({
    invoice_number: g.invoice.invoice_number ?? null,
    can_return: can,
    refused: can ? null : customerReturnRefusedMessage(g.invoice),
    ...view,
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await gate(id)
  if ('res' in g) return g.res
  if (!canCustomerReturn(g.invoice)) {
    return NextResponse.json({ error: customerReturnRefusedMessage(g.invoice), reason: 'draft' }, { status: 409 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, NOTE_MAX) : ''
  if (!note) {
    return NextResponse.json({ error: 'Say why the parts came back - which job was refused, dismissed or not finished. It is recorded with the return.' }, { status: 422 })
  }
  if (!Array.isArray(body.returns)) return NextResponse.json({ error: 'returns must be a list of { part_id, quantity }.' }, { status: 400 })
  const requests = (body.returns as Array<Record<string, unknown>>).map(r => ({ partId: String(r?.part_id ?? ''), quantity: Number(r?.quantity) }))

  const res = await returnInvoiceStock({
    userId: g.userId, invoiceId: id, invoiceRef: (g.invoice.invoice_number as string | null) ?? null,
    requests, note, createdBy: g.userId,
  })
  if (!res.ok) {
    return NextResponse.json({ error: res.errors.join(' '), errors: res.errors, written: res.written }, { status: res.status })
  }

  const view = await stockView(g.userId, g.invoice)
  return NextResponse.json({
    returned: res.written.map(w => ({ part_id: w.partId, part_number: w.partNumber, quantity: w.delta })),
    ...('error' in view ? {} : view),
  }, { status: 201 })
}
