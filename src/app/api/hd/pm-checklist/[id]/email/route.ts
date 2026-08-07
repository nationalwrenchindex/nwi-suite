import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { sendPmReportEmail } from '@/lib/hd/pm-report-email'

export const dynamic = 'force-dynamic'

// POST /api/hd/pm-checklist/[id]/email — re-send the PM completion report.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  // sendPmReportEmail verifies the checklist belongs to this user before sending.
  const result = await sendPmReportEmail({ userId: user.id, checklistId: id })
  if (!result.success) return NextResponse.json({ error: result.error ?? 'Email failed' }, { status: 502 })
  return NextResponse.json({ ok: true })
}
