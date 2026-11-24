import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  HD_DOC_KINDS, isHdDocKind, readDocNumberState, setNextDocNumber, formatDocNumber,
  type DocNumberState,
} from '@/lib/hd/document-number-start'

// GET  /api/hd/settings/document-numbers  -> the next invoice, quote and work order number
// POST /api/hd/settings/document-numbers  { kind, next } -> set one of them, forward only
//
// Always the signed-in account's own counters: the user id comes from the session, never
// from the body, and the service client is used only because the counter table is closed
// to the browser keys (migration 186). See lib/hd/document-number-start.

function view(s: DocNumberState) {
  const year = new Date().getFullYear()
  return {
    kind: s.kind,
    next: s.next,
    next_formatted: formatDocNumber(s.kind, year, s.next),
    highest_issued: s.highest?.number ?? null,
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const svc = createServiceClient()
    const states = await Promise.all(HD_DOC_KINDS.map(k => readDocNumberState(svc, user.id, k)))
    return NextResponse.json({ numbers: states.map(view) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { kind?: unknown; next?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  if (!isHdDocKind(body.kind)) {
    return NextResponse.json({ error: "kind must be 'hd_invoice', 'hd_quote' or 'hd_work_order'" }, { status: 400 })
  }
  try {
    const r = await setNextDocNumber(createServiceClient(), user.id, body.kind, body.next)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ ok: true, number: view(r.state) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
