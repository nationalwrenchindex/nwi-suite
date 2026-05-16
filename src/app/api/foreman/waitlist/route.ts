import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(req: NextRequest) {
  let body: {
    email?:         string
    mechanic_name?: string
    business_name?: string
    phone?:         string
    notes?:         string
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { email, mechanic_name, business_name, phone, notes } = body

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 })
  }

  const normalizedEmail = email.toLowerCase().trim()
  const svc = createServiceClient()

  // Idempotent: already on waitlist
  const { data: existing } = await svc
    .from('foreman_waitlist')
    .select('id')
    .eq('email', normalizedEmail)
    .single()

  if (existing) {
    return NextResponse.json({ ok: true, already_listed: true })
  }

  const { count } = await svc
    .from('foreman_waitlist')
    .select('*', { count: 'exact', head: true })

  const { error } = await svc.from('foreman_waitlist').insert({
    email:         normalizedEmail,
    mechanic_name: mechanic_name ?? null,
    business_name: business_name ?? null,
    phone:         phone ?? null,
    notes:         notes ?? null,
  })

  if (error) {
    console.error('[waitlist] insert error:', error)
    return NextResponse.json({ error: 'Failed to join waitlist.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, position: (count ?? 0) + 1 })
}
