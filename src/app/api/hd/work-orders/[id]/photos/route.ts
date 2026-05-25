import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workOrderId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify work order belongs to user
  const { data: wo } = await supabase
    .from('hd_work_orders')
    .select('id')
    .eq('id', workOrderId)
    .eq('user_id', user.id)
    .single()
  if (!wo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { file_url: string; file_name?: string; category: string; caption?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const { file_url, file_name, category, caption } = body
  if (!file_url || !category) return NextResponse.json({ error: 'Missing file_url or category' }, { status: 400 })

  const { data: photo, error } = await supabase
    .from('hd_work_order_photos')
    .insert({
      user_id:       user.id,
      work_order_id: workOrderId,
      category,
      file_url,
      file_name:     file_name ?? null,
      caption:       caption   ?? null,
      taken_at:      new Date().toISOString(),
    })
    .select('id, category, file_url, file_name, caption, taken_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ photo })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workOrderId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const photoId = searchParams.get('photoId')
  if (!photoId) return NextResponse.json({ error: 'Missing photoId' }, { status: 400 })

  // Fetch photo to get file path for storage deletion
  const { data: photo } = await supabase
    .from('hd_work_order_photos')
    .select('id, file_url, user_id')
    .eq('id', photoId)
    .eq('work_order_id', workOrderId)
    .eq('user_id', user.id)
    .single()
  if (!photo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Delete from storage
  await supabase.storage.from('hd-work-order-photos').remove([photo.file_url])

  // Delete metadata row
  await supabase.from('hd_work_order_photos').delete().eq('id', photoId)

  return NextResponse.json({ ok: true })
}
