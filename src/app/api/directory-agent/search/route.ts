import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { findMobileMechanics } from '@/lib/directory-agent/places'
import {
  authorizeAgentRequest,
  DEFAULT_RADIUS_METERS,
  DEFAULT_SEARCH_CITIES,
  MIN_RATING,
} from '@/lib/directory-agent/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── POST /api/directory-agent/search ────────────────────────────────────────
// Finds mobile mechanics on Google Places and banks them as pending prospects.
//
// Body (optional): { city, state, radius }. With no body — how the Monday cron
// calls it — it sweeps DEFAULT_SEARCH_CITIES one city at a time.
//
// Nothing here sends a message; the invite route does that on its own schedule,
// which keeps discovery volume decoupled from outreach volume.
export async function POST(request: NextRequest) {
  const denied = await authorizeAgentRequest(request)
  if (denied) return denied

  const body = await request.json().catch(() => null) as
    { city?: unknown; state?: unknown; radius?: unknown } | null

  const city  = typeof body?.city  === 'string' ? body.city.trim()  : ''
  const state = typeof body?.state === 'string' ? body.state.trim() : ''
  const radius = typeof body?.radius === 'number' && body.radius > 0
    ? body.radius
    : DEFAULT_RADIUS_METERS

  if ((city && !state) || (state && !city)) {
    return NextResponse.json({ error: 'city and state must be provided together' }, { status: 400 })
  }

  const targets = city && state ? [{ city, state }] : DEFAULT_SEARCH_CITIES

  const supabase     = createServiceClient()
  const businessNames: string[] = []
  const perCity: Array<{ city: string; state: string; found: number; error?: string }> = []
  let newProspects = 0

  for (const target of targets) {
    try {
      const candidates = await findMobileMechanics(target.city, target.state, radius, MIN_RATING)
      if (candidates.length === 0) {
        perCity.push({ ...target, found: 0 })
        continue
      }

      const phones   = candidates.map(c => c.phone)
      const placeIds = candidates.map(c => c.placeId)

      // Two exclusion lists, both checked before we write anything:
      // opted-out numbers are permanently off limits, and any phone or place id
      // already banked is a prospect we've seen (possibly already contacted).
      const [{ data: optouts }, { data: existingPhones }, { data: existingPlaces }] = await Promise.all([
        supabase.from('directory_optouts').select('phone').in('phone', phones),
        supabase.from('directory_prospects').select('phone').in('phone', phones),
        supabase.from('directory_prospects').select('google_place_id').in('google_place_id', placeIds),
      ])

      const blockedPhones = new Set([
        ...(optouts        ?? []).map(r => r.phone as string),
        ...(existingPhones ?? []).map(r => r.phone as string),
      ])
      const knownPlaceIds = new Set((existingPlaces ?? []).map(r => r.google_place_id as string))

      const fresh = candidates.filter(c => !blockedPhones.has(c.phone) && !knownPlaceIds.has(c.placeId))
      if (fresh.length === 0) {
        perCity.push({ ...target, found: 0 })
        continue
      }

      // ignoreDuplicates so a concurrent run (or the same business surfacing in
      // two cities' radii) can't fail the whole batch on the unique phone index.
      const { data: inserted, error: insertErr } = await supabase
        .from('directory_prospects')
        .upsert(
          fresh.map(c => ({
            phone:           c.phone,
            business_name:   c.businessName,
            rating:          c.rating,
            google_place_id: c.placeId,
            city:            c.city,
            state:           c.state,
            address:         c.address,
            website:         c.website,
            status:          'pending',
          })),
          { onConflict: 'phone', ignoreDuplicates: true },
        )
        .select('business_name')

      if (insertErr) {
        console.error(`[directory-agent/search] insert failed for ${target.city}:`, insertErr.message)
        perCity.push({ ...target, found: 0, error: insertErr.message })
        continue
      }

      const names = (inserted ?? []).map(r => (r.business_name as string) ?? 'Unknown')
      businessNames.push(...names)
      newProspects += names.length
      perCity.push({ ...target, found: names.length })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[directory-agent/search] ${target.city}, ${target.state} failed:`, msg)
      perCity.push({ ...target, found: 0, error: msg })
    }
  }

  console.log(`[directory-agent/search] done: newProspects=${newProspects} cities=${targets.length}`)
  return NextResponse.json({ newProspects, businessNames, cities: perCity })
}

// Vercel cron issues GET. Delegate so one path serves both the schedule and the
// admin dashboard's manual search.
export async function GET(request: NextRequest) {
  return POST(request)
}
