// GET /api/fleet-pro/replacement — the replacement recommendation list.
//
// ── ROLE GATE: REFUSE, NOT STRIP ─────────────────────────────────────────────
// The dashboard strips spend_mtd/spend_ytd to null for a read-only viewer because
// the rest of that payload (PM state, inspections, plates) is still useful without
// money. This report is not like that. Its headline metric IS money — repair spend
// as a percent of value — and the ratio leaks the spend just as surely as the
// figure does, because the estimated value is on the same card. Stripping would
// leave a page that says "three units need review" and refuses to say why.
//
// So this endpoint refuses viewers outright with a 403, matching
// /api/fleet-pro/reports, which is the other surface that is nothing but cost. The
// page redirects them before the shell renders so nobody meets a bare 403.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { buildReplacementReport } from '@/lib/fleet-pro/replacement'
import { canEditUnits, canViewCosts } from '@/types/fleet-pro'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProMember(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { membership } = gate

  if (!canViewCosts(membership.role)) {
    return NextResponse.json(
      { error: 'Cost data is not available to read-only viewers' },
      { status: 403 },
    )
  }

  // Service client from here down: RLS on hd_units / hd_work_orders routes through
  // fleet_pro_account_ids(), and every query inside buildReplacementReport is scoped
  // to the RESOLVED fleet id instead — never to anything supplied by the request.
  const svc = createServiceClient()

  try {
    const report = await buildReplacementReport(svc, membership)
    return NextResponse.json({
      report,
      // Whether this caller may type an estimated value. Sent so the client does not
      // have to re-derive the role rule, and so the button and the endpoint it calls
      // can never disagree about who is allowed to press it.
      can_edit_values: canEditUnits(membership.role),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not build the replacement report'
    console.error('[fleet-pro/replacement]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
