// POST   /api/work-orders/[id]/photos            — record a photo already uploaded
// DELETE /api/work-orders/[id]/photos?photoId=…   — remove one
//
// The client uploads to the 'work-order-photos' bucket and posts the resulting path
// here, matching api/hd/work-orders/[id]/photos. The route records and removes rows;
// it never proxies file bytes.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasWorkOrders } from '@/lib/work-orders'

const BUCKET = 'work-order-photos'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workOrderId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasWorkOrders(supabase, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 403 })
  }

  // Ownership is checked here rather than relied on from RLS because the insert
  // below carries work_order_id from the URL: without this, a valid work_order_id
  // belonging to someone else would attach a photo to their record.
  const { data: wo } = await supabase
    .from('work_orders')
    .select('id')
    .eq('id', workOrderId)
    .eq('user_id', user.id)
    .single()
  if (!wo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { file_url?: string; caption?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!body.file_url) return NextResponse.json({ error: 'Missing file_url' }, { status: 400 })

  const { data: photo, error } = await supabase
    .from('work_order_photos')
    .insert({
      user_id:       user.id,
      work_order_id: workOrderId,
      file_url:      body.file_url,
      caption:       body.caption?.trim() || null,
    })
    .select('id, work_order_id, file_url, caption, created_at')
    .single()

  if (error) {
    console.error('[POST work-order photos]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ photo }, { status: 201 })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: workOrderId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasWorkOrders(supabase, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 403 })
  }

  const photoId = new URL(req.url).searchParams.get('photoId')
  if (!photoId) return NextResponse.json({ error: 'Missing photoId' }, { status: 400 })

  const { data: photo } = await supabase
    .from('work_order_photos')
    .select('id, file_url')
    .eq('id', photoId)
    .eq('work_order_id', workOrderId)
    .eq('user_id', user.id)
    .single()

  if (!photo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Storage first, then the row. The other order can orphan the object with nothing
  // left pointing at it; this order can at worst leave a row whose file is gone,
  // which is visible and fixable.
  await supabase.storage.from(BUCKET).remove([photo.file_url])

  const { error } = await supabase
    .from('work_order_photos')
    .delete()
    .eq('id', photoId)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
