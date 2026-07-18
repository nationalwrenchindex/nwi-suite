import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createDirectoryListing, isDirectoryPublishEnabled } from '@/lib/brilliant-directories/client'

// Called by the onboarding form after the profile has been saved. Publishes the
// mechanic's listing to nationalwrenchindex.com via the Brilliant Directories API.
//
// This never fails onboarding: a listing problem returns 200 with published:false
// so the mechanic still lands on the dashboard.

const BOOKING_BASE = 'https://tools.nationalwrenchindex.com/book'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const svc = createServiceClient()

  const { data: profile, error: profileErr } = await svc
    .from('profiles')
    .select('id, email, full_name, business_name, business_type, phone, city, state, slug')
    .eq('id', user.id)
    .single()

  if (profileErr || !profile) {
    console.error('[onboarding/complete] profile load failed:', profileErr?.message)
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  async function log(fields: {
    status: 'created' | 'failed' | 'skipped'
    bd_user_id?: string | null
    skip_reason?: string | null
    error_message?: string | null
    request_payload?: Record<string, unknown> | null
    response_body?: string | null
  }) {
    const { error } = await svc.from('directory_listings').insert({
      profile_id:      user!.id,
      bd_user_id:      fields.bd_user_id ?? null,
      status:          fields.status,
      skip_reason:     fields.skip_reason ?? null,
      error_message:   fields.error_message ?? null,
      request_payload: fields.request_payload ?? null,
      response_body:   fields.response_body ?? null,
    })
    // A duplicate-key error here means a 'created' row already exists, which is
    // the unique index doing its job — not worth surfacing as a failure.
    if (error && error.code !== '23505') {
      console.error('[onboarding/complete] log insert failed:', error.message)
    }
  }

  function skip(reason: string) {
    void log({ status: 'skipped', skip_reason: reason })
    return NextResponse.json({ published: false, reason })
  }

  if (!isDirectoryPublishEnabled()) return skip('publishing_disabled')
  if (profile.business_type === 'hd_tech') return skip('not_a_directory_vertical')
  if (!profile.business_name) return skip('missing_business_name')
  if (!profile.email) return skip('missing_email')

  // Don't republish if this mechanic already has a live listing — covers a
  // re-run of onboarding and the mechanic who listed on the directory first
  // and then subscribed.
  const { data: existing } = await svc
    .from('directory_listings')
    .select('id')
    .eq('profile_id', user.id)
    .eq('status', 'created')
    .maybeSingle()

  if (existing) return NextResponse.json({ published: false, reason: 'already_listed' })

  // profiles stores a single full_name; BD wants the two halves separately.
  // Everything after the first token is the surname, so "Ana Maria Cruz" keeps
  // "Maria Cruz" intact rather than dropping the middle name.
  const nameParts = ((profile.full_name as string | null) ?? '').trim().split(/\s+/).filter(Boolean)
  const payload   = {
    email:        profile.email as string,
    firstName:    nameParts[0] ?? null,
    lastName:     nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
    businessName: profile.business_name as string,
    city:         (profile.city as string | null) ?? null,
    state:        (profile.state as string | null) ?? null,
    phone:        (profile.phone as string | null) ?? null,
    bookingUrl:   profile.slug ? `${BOOKING_BASE}/${profile.slug}` : 'https://tools.nationalwrenchindex.com',
  }

  try {
    const result = await createDirectoryListing(payload)
    await log({
      status:          'created',
      bd_user_id:      result.userId,
      request_payload: payload,
      response_body:   result.rawBody,
    })
    return NextResponse.json({ published: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[onboarding/complete] BD publish failed:', message)
    await log({
      status:          'failed',
      error_message:   message,
      request_payload: payload,
    })
    return NextResponse.json({ published: false, reason: 'publish_failed' })
  }
}
