import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

type RouteContext = { params: Promise<{ slug: string }> }

const MAX_BYTES = 5 * 1024 * 1024  // 5 MB

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { slug } = await params
  const supabase  = createServiceClient()

  let body: { image?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.image || typeof body.image !== 'string') {
    return NextResponse.json({ error: 'image (base64) is required' }, { status: 400 })
  }

  const base64  = body.image.replace(/^data:image\/\w+;base64,/, '')
  const buffer  = Buffer.from(base64, 'base64')

  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: 'Image exceeds 5 MB limit' }, { status: 413 })
  }

  // Ensure bucket exists (idempotent — ignore "already exists" errors)
  const { error: bucketErr } = await supabase.storage.createBucket('booking-photos', {
    public: true,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  })
  if (bucketErr && !/already exist|duplicate/i.test(bucketErr.message)) {
    console.error('[POST /api/book/photos] bucket create error:', bucketErr.message)
  }

  const uid      = Math.random().toString(36).slice(2)
  const filename = `${slug}/${Date.now()}-${uid}.jpg`

  const { error: uploadErr } = await supabase.storage
    .from('booking-photos')
    .upload(filename, buffer, { contentType: 'image/jpeg', upsert: false })

  if (uploadErr) {
    console.error('[POST /api/book/photos] upload error:', JSON.stringify(uploadErr))
    return NextResponse.json({ error: 'Photo upload failed' }, { status: 500 })
  }

  const { data: { publicUrl } } = supabase.storage
    .from('booking-photos')
    .getPublicUrl(filename)

  return NextResponse.json({ url: publicUrl })
}
