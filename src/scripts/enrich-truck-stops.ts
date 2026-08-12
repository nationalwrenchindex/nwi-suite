/**
 * Backfills the data the truck-stop import never captured, on both sides.
 *
 * Every auto-listed venue is on the directory with lat:null, lon:null and
 * website:null — Places returns all three and nothing forwarded them — so none
 * of them can appear in a map or radius search. The earliest ~12 listings also
 * predate the phone_number/state_code/address1 field-name fix and are missing
 * those outright.
 *
 * Run:
 *   npm run enrich-truck-stops -- --probe        # discover BD's update API, writes nothing
 *   npm run enrich-truck-stops -- --dry-run      # show what would change
 *   npm run enrich-truck-stops -- --places-only  # refresh Supabase, never touch BD
 *   npm run enrich-truck-stops -- --limit=10     # first real batch
 *   npm run enrich-truck-stops                   # full pass
 *
 * Two phases, deliberately separable:
 *
 *   A. Places Details -> Supabase. Always safe, always runs.
 *   B. Supabase -> BD update. Needs an update endpoint this codebase has never
 *      confirmed exists; --probe reports exactly what BD says instead of
 *      guessing, the same way --verbose on the import revealed phone_number,
 *      address1 and state_code.
 *
 * Listings are identified by the email the import derived from google_place_id,
 * which is deterministic and therefore recoverable — BD user ids were never
 * stored. Any id BD hands back is saved to bd_user_id so the next pass has a
 * direct handle.
 *
 * Safe to re-run: enriched_at gates the queue, and every write is idempotent.
 */

import { loadEnvConfig } from '@next/env'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

loadEnvConfig(process.cwd())

const BD_BASE     = process.env.BD_HD_BASE_URL ?? 'https://national-wrench-index-hd.directoryup.com/api/v2'
const PLACES_BASE = 'https://places.googleapis.com/v1/places'

const BD_DELAY_MS       = 500
const PLACES_CONCURRENCY = 5

// Tried in order by --probe. BD documents /user/create; these are the plausible
// siblings. Whichever answers with something other than a 404/405 is the one.
const UPDATE_PATH_CANDIDATES = ['user/update', 'user/edit', 'user/save', 'member/update']

const FIELD_MASK = [
  'id', 'displayName', 'formattedAddress', 'nationalPhoneNumber',
  'websiteUri', 'location', 'addressComponents',
].join(',')

interface AddressComponent { longText?: string; shortText?: string; types?: string[] }

interface PlaceDetails {
  id?:                  string
  displayName?:         { text?: string }
  formattedAddress?:    string
  nationalPhoneNumber?: string
  websiteUri?:          string
  location?:            { latitude?: number; longitude?: number }
  addressComponents?:   AddressComponent[]
}

interface Row {
  id:               string
  business_name:    string | null
  phone:            string
  city:             string | null
  state:            string | null
  address:          string | null
  website:          string | null
  google_place_id:  string | null
  service_category: string | null
  bd_user_id:       string | null
  lat:              number | null
  lon:              number | null
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function componentOf(components: AddressComponent[] | undefined, type: string, short = false) {
  const m = components?.find(c => c.types?.includes(type))
  if (!m) return null
  return (short ? m.shortText : m.longText) ?? null
}

/** National format — BD renders phone as a display string. */
function toBdPhone(e164: string): string {
  const ten = e164.replace(/\D/g, '').slice(-10)
  return ten.length === 10 ? `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}` : e164
}

/**
 * Reproduces the address the import assigned. Deterministic from the place id,
 * which is why listings remain addressable despite the user id being discarded.
 * BD lowercases on store, so callers must compare case-insensitively.
 */
function listingEmail(placeId: string): string {
  const local = placeId.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 60)
  return `${local}@nwi-hd-listing.com`.toLowerCase()
}

async function fetchPlace(key: string, placeId: string): Promise<PlaceDetails | null> {
  const res = await fetch(`${PLACES_BASE}/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
    signal:  AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.warn(`   ! Places ${res.status} for ${placeId}: ${body.slice(0, 160)}`)
    return null
  }
  return await res.json() as PlaceDetails
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<(R | null)[]> {
  const out = new Array<R | null>(items.length).fill(null)
  let cursor = 0
  async function runner() {
    while (cursor < items.length) {
      const i = cursor++
      try { out[i] = await worker(items[i]) } catch (e) {
        console.warn(`   ! ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner))
  return out
}

/** Fields BD is missing. Names confirmed from BD's echo of a created user. */
function bdPayload(row: Row, place: PlaceDetails | null): URLSearchParams {
  const body = new URLSearchParams({ bdapi_model: 'user' })

  if (row.bd_user_id) body.set('user_id', row.bd_user_id)
  if (row.google_place_id) body.set('email', listingEmail(row.google_place_id))

  const lat = place?.location?.latitude  ?? row.lat
  const lon = place?.location?.longitude ?? row.lon
  if (typeof lat === 'number') body.set('lat', String(lat))
  if (typeof lon === 'number') body.set('lon', String(lon))

  const website = place?.websiteUri ?? row.website
  if (website) body.set('website', website)

  // Re-sent because the first ~12 listings predate the field-name fix and have
  // these empty. Harmless no-ops on the rest.
  if (row.business_name) body.set('company', row.business_name)
  if (row.phone)         body.set('phone_number', toBdPhone(row.phone))
  if (row.city)          body.set('city', row.city)
  if (row.state)         body.set('state_code', row.state)

  const street = [
    componentOf(place?.addressComponents, 'street_number'),
    componentOf(place?.addressComponents, 'route'),
  ].filter(Boolean).join(' ')
  if (street) body.set('address1', street)
  const zip = componentOf(place?.addressComponents, 'postal_code')
  if (zip) body.set('zip_code', zip)

  return body
}

async function callBd(path: string, body: URLSearchParams, apiKey: string) {
  const res = await fetch(`${BD_BASE}/${path}`, {
    method:  'POST',
    headers: {
      'X-Api-Key':    apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
      accept:         'application/json',
    },
    body:     body.toString(),
    redirect: 'manual',
    signal:   AbortSignal.timeout(20_000),
  })
  const raw = await res.text().catch(() => '')
  return { status: res.status, raw }
}

async function main() {
  const args       = process.argv.slice(2)
  const dryRun     = args.includes('--dry-run')
  const probe      = args.includes('--probe')
  const placesOnly = args.includes('--places-only')
  const verbose    = args.includes('--verbose')
  const limitArg   = args.find(a => a.startsWith('--limit='))
  const limit      = limitArg ? Number.parseInt(limitArg.split('=')[1] ?? '', 10) : Number.POSITIVE_INFINITY
  if (Number.isNaN(limit) || limit <= 0) {
    console.error('--limit must be a positive integer')
    process.exit(1)
  }

  const placesKey  = process.env.GOOGLE_PLACES_API_KEY
  const bdKey      = process.env.BD_HD_DIRECTORY_AGENT_KEY
  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  const missing = [
    !placesKey  && 'GOOGLE_PLACES_API_KEY',
    !url        && 'NEXT_PUBLIC_SUPABASE_URL',
    !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY',
    !placesOnly && !dryRun && !bdKey && 'BD_HD_DIRECTORY_AGENT_KEY',
  ].filter(Boolean)
  if (missing.length > 0) {
    console.error(`Missing required env var(s): ${missing.join(', ')}`)
    process.exit(1)
  }

  const supabase: SupabaseClient = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await supabase
    .from('hd_directory_prospects')
    .select('id, business_name, phone, city, state, address, website, google_place_id, service_category, bd_user_id, lat, lon')
    .eq('service_category', 'truck_stop')
    .eq('bd_listing_created', true)
    .is('enriched_at', null)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('load failed:', error.message)
    process.exit(1)
  }

  const rows = (data ?? []) as Row[]
  console.log('─'.repeat(72))
  console.log(
    `Truck-stop enrichment${dryRun ? '  [DRY RUN]' : ''}${probe ? '  [PROBE]' : ''}` +
    `${placesOnly ? '  [PLACES ONLY]' : ''}`,
  )
  console.log(`${rows.length} listed venue(s) not yet enriched`)
  console.log('─'.repeat(72))
  if (rows.length === 0) return

  // ── Probe: learn BD's update API instead of guessing at it ──
  if (probe) {
    const row = rows[0]
    const place = row.google_place_id ? await fetchPlace(placesKey!, row.google_place_id) : null
    const body = bdPayload(row, place)
    console.log(`Probing with: ${row.business_name} (${row.google_place_id})`)
    console.log(`Payload: ${body.toString()}\n`)
    for (const path of UPDATE_PATH_CANDIDATES) {
      try {
        const { status, raw } = await callBd(path, body, bdKey!)
        console.log(`POST ${BD_BASE}/${path}\n  → ${status}: ${raw.slice(0, 700)}\n`)
      } catch (err) {
        console.log(`POST ${BD_BASE}/${path}\n  → threw: ${err instanceof Error ? err.message : String(err)}\n`)
      }
      await sleep(BD_DELAY_MS)
    }
    console.log('Probe complete. Set BD_HD_UPDATE_PATH to whichever endpoint answered, then re-run.')
    return
  }

  const queue = Number.isFinite(limit) ? rows.slice(0, limit) : rows
  const updatePath = process.env.BD_HD_UPDATE_PATH ?? UPDATE_PATH_CANDIDATES[0]

  // ── Phase A: Places Details ──
  console.log(`Fetching Places details for ${queue.length}…`)
  const places = await mapWithConcurrency(
    queue, PLACES_CONCURRENCY,
    r => r.google_place_id ? fetchPlace(placesKey!, r.google_place_id) : Promise.resolve(null),
  )

  let geo = 0, sites = 0, bdOk = 0, bdFail = 0, noPlace = 0

  for (const [i, row] of queue.entries()) {
    const place = places[i]
    const name  = row.business_name || '(no name)'
    if (!place) { noPlace++; console.log(`  ✗ ${name} — no Places result`) }

    const lat     = place?.location?.latitude
    const lon     = place?.location?.longitude
    const website = place?.websiteUri ?? row.website
    const hasGeo  = typeof lat === 'number' && typeof lon === 'number'
    if (hasGeo)  geo++
    if (website) sites++

    console.log(
      `  ${name} — geo:${hasGeo ? `${lat!.toFixed(4)},${lon!.toFixed(4)}` : 'none'}` +
      ` site:${website ? 'yes' : 'none'}`,
    )
    if (dryRun) continue

    // ── Phase B: push to BD ──
    let bdUserId = row.bd_user_id
    if (!placesOnly) {
      try {
        const { status, raw } = await callBd(updatePath, bdPayload(row, place), bdKey!)
        if (verbose) console.log(`      ← ${status}: ${raw.slice(0, 400)}`)
        if (status >= 200 && status < 300 && !/"status"\s*:\s*"error"/.test(raw)) {
          bdOk++
          try {
            const msg = (JSON.parse(raw) as { message?: { user_id?: string | number } }).message
            if (msg?.user_id != null) bdUserId = String(msg.user_id)
          } catch { /* non-JSON success body */ }
        } else {
          bdFail++
          console.error(`      ! BD ${status}: ${raw.slice(0, 200)}`)
        }
      } catch (err) {
        bdFail++
        console.error(`      ! BD threw: ${err instanceof Error ? err.message : String(err)}`)
      }
      await sleep(BD_DELAY_MS)
    }

    // enriched_at is only stamped when BD actually accepted the update, so a
    // failed push stays in the queue rather than being marked done.
    const { error: updErr } = await supabase
      .from('hd_directory_prospects')
      .update({
        ...(hasGeo ? { lat, lon } : {}),
        ...(website ? { website } : {}),
        ...(bdUserId ? { bd_user_id: bdUserId } : {}),
        ...(placesOnly || bdFail === 0 ? { enriched_at: new Date().toISOString() } : {}),
      })
      .eq('id', row.id)
    if (updErr) console.error(`      ! DB update failed: ${updErr.message}`)
  }

  console.log('')
  console.log('─'.repeat(72))
  console.log('SUMMARY')
  console.log(`  Processed:            ${queue.length}`)
  console.log(`  Coordinates found:    ${geo}`)
  console.log(`  Websites found:       ${sites}`)
  console.log(`  No Places result:     ${noPlace}`)
  if (!placesOnly && !dryRun) {
    console.log(`  BD updates accepted:  ${bdOk}`)
    console.log(`  BD updates failed:    ${bdFail}`)
  }
  console.log('─'.repeat(72))
}

main().catch(err => {
  console.error('Enrichment aborted:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
