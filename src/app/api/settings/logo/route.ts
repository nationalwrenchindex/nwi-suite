import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const MAX_BYTES = 5 * 1024 * 1024

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { image?: string; ext?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.image) return NextResponse.json({ error: 'image required' }, { status: 400 })

  const base64 = body.image.replace(/^data:image\/\w+;base64,/, '')
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length > MAX_BYTES) return NextResponse.json({ error: 'Image exceeds 5 MB' }, { status: 413 })

  const ext      = (body.ext ?? 'jpg').toLowerCase()
  const path     = `${user.id}/logo.${ext}`
  const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'

  const { error: uploadErr } = await supabase.storage
    .from('business-logos')
    .upload(path, buffer, { contentType: mimeType, upsert: true })

  if (uploadErr) {
    console.error('[api/settings/logo] upload:', uploadErr)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  const { data: { publicUrl } } = supabase.storage.from('business-logos').getPublicUrl(path)

  const { error: profileErr } = await supabase
    .from('profiles')
    .update({ business_logo_url: publicUrl, business_logo_storage_path: path })
    .eq('id', user.id)

  if (profileErr) {
    console.error('[api/settings/logo] profile update:', profileErr)
    return NextResponse.json({ error: 'Profile update failed' }, { status: 500 })
  }

  return NextResponse.json({ url: publicUrl })
}

export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_logo_storage_path')
    .eq('id', user.id)
    .single()

  if (profile?.business_logo_storage_path) {
    await supabase.storage.from('business-logos').remove([profile.business_logo_storage_path as string])
  }

  await supabase
    .from('profiles')
    .update({ business_logo_url: null, business_logo_storage_path: null })
    .eq('id', user.id)

  return NextResponse.json({ ok: true })
}
