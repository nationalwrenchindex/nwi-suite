import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { authorizeAgentRequest } from '@/lib/directory-agent/config'
import { searchCity, type HdProspect } from '@/lib/hd-directory-agent/places'
import {
  HD_DEFAULT_RADIUS_METERS,
  HD_SEARCH_CITIES,
  HD_SEARCH_TERMS,
} from '@/lib/hd-directory-agent/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// A full sweep is ~33 Places queries per city across 15 corridor cities. Queries
// within a city run concurrently (see places.ts), but the whole run still has to
// fit inside maxDuration, so we stop starting new cities once this much of the
// budget is gone and report which cities were skipped. The Tuesday cron then
// picks them up on its next pass, and the admin page can run any city by hand.
const TIME_BUDGET_MS = 45_000

// Supabase filters go in the query string; chunk the exclusion lookups so a
// large sweep can't produce an over-long URL.
const LOOKUP_CHUNK = 100

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// ─── POST /api/hd-directory-agent/search ─────────────────────────────────────
// Finds heavy-duty service providers on Google Places and banks them as pending
// prospects, tagged with the service category of the term that surfaced them.
//
// Body (optional): { city, state, radius }. With no body — how the Tuesday cron
// calls it — it sweeps HD_SEARCH_CITIES.
export async function POST(request: NextRequest) {
  const denied = await authorizeAgentRequest(request)
  if (denied) return denied

  const startedAt = Date.now()

  const body = await request.json().catch(() => null) as
    { city?: unknown; state?: unknown; radius?: unknown } | null

  const city  = typeof body?.city  === 'string' ? body.city.trim()  : ''
  const state = typeof body?.state === 'string' ? body.state.trim() : ''
  const radius = typeof body?.radius === 'number' && body.radius > 0
    ? body.radius
    : HD_DEFAULT_RADIUS_METERS

  if ((city && !state) || (state && !city)) {
    return NextResponse.json({ error: 'city and state must be provided together' }, { status: 400 })
  }

  const targets = city && state ? [{ city, state }] : HD_SEARCH_CITIES

  const supabase = createServiceClient()
  const businessNames: string[] = []
  const perCity: Array<{ city: string; state: string; found: number; error?: string }> = []
  const skipped: Array<{ city: string; state: string }> = []
  let newProspects = 0

  for (const target of targets) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      skipped.push({ city: target.city, state: target.state })
      continue
    }

    try {
      const candidates = await searchCity(target.city, target.state, radius)
      if (candidates.length === 0) {
        perCity.push({ ...target, found: 0 })
        continue
      }

      const fresh = await filterKnown(supabase, candidates)
      if (fresh.length === 0) {
        perCity.push({ ...target, found: 0 })
        continue
      }

      // ignoreDuplicates so a concurrent run — or the same business surfacing in
      // two cities' radii — can't fail the batch on the unique phone index.
      const { data: inserted, error: insertErr } = await supabase
        .from('hd_directory_prospects')
        .upsert(
          fresh.map(c => ({
            phone:            c.phone,
            business_name:    c.businessName,
            rating:           c.rating,
            google_place_id:  c.placeId,
            city:             c.city,
            state:            c.state,
            address:          c.address,
            website:          c.website,
            service_category: c.serviceCategory,
            status:           'pending',
          })),
          { onConflict: 'phone', ignoreDuplicates: true },
        )
        .select('business_name')

      if (insertErr) {
        console.error(`[hd-directory-agent/search] insert failed for ${target.city}:`, insertErr.message)
        perCity.push({ ...target, found: 0, error: insertErr.message })
        continue
      }

      const names = (inserted ?? []).map(r => (r.business_name as string) ?? 'Unknown')
      businessNames.push(...names)
      newProspects += names.length
      perCity.push({ ...target, found: names.length })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[hd-directory-agent/search] ${target.city}, ${target.state} failed:`, msg)
      perCity.push({ ...target, found: 0, error: msg })
    }
  }

  if (skipped.length > 0) {
    console.warn(
      `[hd-directory-agent/search] time budget reached — skipped ${skipped.length} city/cities:`,
      skipped.map(s => `${s.city}, ${s.state}`).join(' · '),
    )
  }

  console.log(
    `[hd-directory-agent/search] done: newProspects=${newProspects} ` +
    `cities=${perCity.length}/${targets.length} terms=${HD_SEARCH_TERMS.length} ` +
    `elapsed=${Date.now() - startedAt}ms`,
  )

  return NextResponse.json({ newProspects, businessNames, cities: perCity, skipped })
}

// Two exclusion lists, both checked before we write anything: opted-out numbers
// are permanently off limits, and any phone or place id already banked is a
// prospect we've seen (possibly already contacted).
async function filterKnown(
  supabase: ReturnType<typeof createServiceClient>,
  candidates: HdProspect[],
): Promise<HdProspect[]> {
  const phones   = candidates.map(c => c.phone)
  const placeIds = candidates.map(c => c.placeId)

  const blockedPhones = new Set<string>()
  const knownPlaceIds = new Set<string>()

  for (const phoneChunk of chunk(phones, LOOKUP_CHUNK)) {
    const [{ data: optouts }, { data: existing }] = await Promise.all([
      supabase.from('hd_directory_optouts').select('phone').in('phone', phoneChunk),
      supabase.from('hd_directory_prospects').select('phone').in('phone', phoneChunk),
    ])
    for (const r of optouts  ?? []) blockedPhones.add(r.phone as string)
    for (const r of existing ?? []) blockedPhones.add(r.phone as string)
  }

  for (const idChunk of chunk(placeIds, LOOKUP_CHUNK)) {
    const { data } = await supabase
      .from('hd_directory_prospects')
      .select('google_place_id')
      .in('google_place_id', idChunk)
    for (const r of data ?? []) knownPlaceIds.add(r.google_place_id as string)
  }

  return candidates.filter(c => !blockedPhones.has(c.phone) && !knownPlaceIds.has(c.placeId))
}

// Vercel cron issues GET. Delegate so one path serves both the schedule and the
// admin dashboard's manual search.
export async function GET(request: NextRequest) {
  return POST(request)
}
