// GET /api/inspections?job_id=xxx — fetch the inspection for a job

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasQuickWrenchAccess } from '@/lib/subscription'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await hasQuickWrenchAccess(user.id)) {
    return NextResponse.json({ error: 'QuickWrench requires QuickWrench or Elite plan.' }, { status: 403 })
  }

  const jobId = request.nextUrl.searchParams.get('job_id')
  if (!jobId) return NextResponse.json({ error: 'job_id is required' }, { status: 400 })

  const { data: inspection, error } = await supabase
    .from('inspections')
    .select(`
      *,
      items:inspection_items(*)
    `)
    .eq('job_id', jobId)
    .eq('mechanic_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[GET /api/inspections]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!inspection) {
    return NextResponse.json({ inspection: null })
  }

  // Sort items by point_number
  if (Array.isArray(inspection.items)) {
    inspection.items.sort(
      (a: { point_number: number }, b: { point_number: number }) => a.point_number - b.point_number,
    )
  }

  return NextResponse.json({ inspection })
}
