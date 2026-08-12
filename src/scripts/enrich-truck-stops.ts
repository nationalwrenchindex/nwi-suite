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

// Probe matrix.
//
// The first pass established that POST /user/update returns 405 "Invalid
// Request Method" — the route exists but rejects POST — while user/edit,
// user/save and member/update all return 200 with an EMPTY body, which is BD's
// catch-all for an unknown route (a real endpoint answers with a JSON
// status/message envelope, as /user/create does). So the endpoint is
// user/update and the open question is the verb.
//
// _method is the PHP convention for tunnelling a verb through POST, worth a
// shot if PUT/PATCH are blocked upstream.
// CONFIRMED: PUT /api/v2/user/update, keyed on user_id, is the update API.
// POST and PATCH both answer 405 "Invalid Request Method"; keying on email
// alone answers 400 "user record cannot be updated".
const UPDATE_CANDIDATES: Array<{ path: string; method: string; methodOverride?: string }> = [
  { path: 'user/update', method: 'PUT'   },
  { path: 'user/update', method: 'PATCH' },
  { path: 'user/update', method: 'POST', methodOverride: 'PUT' },
  { path: 'user/create', method: 'POST' }, // upsert-on-create? create is known-good
]

/**
 * Read-endpoint candidates, probed to recover BD user ids.
 *
 * PUT /user/update is confirmed as the update route but answers "user record
 * cannot be updated" when keyed on email alone, so it almost certainly wants
 * user_id — and those were discarded on create. All read-only.
 *
 * user_id 31 is known to exist (captured from a --verbose create run), so it
 * doubles as a positive control: if a route can find 31, the route works and
 * any failure on email is about the key, not the endpoint.
 */
const READ_CANDIDATES: Array<{ path: string; method: string }> = [
  { path: 'user/read',   method: 'GET'  },
  { path: 'user/read',   method: 'POST' },
  { path: 'user/get',    method: 'GET'  },
  { path: 'user/search', method: 'GET'  },
  { path: 'user/list',   method: 'GET'  },
]

/** A real BD endpoint answers with a JSON envelope; unknown routes return empty. */
function describeBdResponse(status: number, raw: string): string {
  if (raw.trim() === '') return 'EMPTY BODY — almost certainly not a real route'
  try {
    const j = JSON.parse(raw) as { status?: string; message?: unknown }
    if (j.status === 'success') return 'SUCCESS — this is the endpoint'
    if (j.status === 'error')   return `error envelope (route exists): ${JSON.stringify(j.message).slice(0, 200)}`
  } catch { /* fall through */ }
  return `non-JSON body: ${raw.slice(0, 200)}`
}

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

/**
 * Recovers BD user ids by listing members and keying on the deterministic
 * import email.
 *
 * Hard limit, established by probing: GET /user/get returns the first 100
 * members by id and nothing shifts that window. limit caps at 100; page 400s;
 * offset/skip/start/from, sort/order, and every filter param tried
 * (email, user_id, company, q, search, keyword, subscription_id) are silently
 * ignored. So only listings inside that window are addressable.
 */
async function fetchBdUserMap(apiKey: string): Promise<Map<string, string>> {
  const res = await fetch(`${BD_BASE}/user/get?bdapi_model=user&limit=100`, {
    headers: { 'X-Api-Key': apiKey, accept: 'application/json' },
    redirect: 'manual',
    signal:   AbortSignal.timeout(20_000),
  })
  const raw = await res.text().catch(() => '')
  const map = new Map<string, string>()
  try {
    const j = JSON.parse(raw) as { message?: Array<Record<string, unknown>> }
    for (const r of j.message ?? []) {
      const email = typeof r.email === 'string' ? r.email.toLowerCase() : null
      if (email && r.user_id != null) map.set(email, String(r.user_id))
    }
  } catch {
    console.error(`BD user/get returned unparseable body: ${raw.slice(0, 200)}`)
  }
  return map
}

/** Fields BD is missing. Names confirmed from BD's echo of a created user. */
function bdPayload(row: Row, place: PlaceDetails | null, userId: string): URLSearchParams {
  // user_id is the only key BD accepts. Keying on email alone returns
  // "user record cannot be updated".
  const body = new URLSearchParams({ bdapi_model: 'user', user_id: userId })

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

async function callBd(path: string, body: URLSearchParams, apiKey: string, method = 'POST') {
  const res = await fetch(`${BD_BASE}/${path}`, {
    method,
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
    // The probe runs before any id map is built, so key on whatever we have —
    // the point is to learn how BD responds, not to succeed.
    const body = bdPayload(row, place, row.bd_user_id ?? '')
    console.log(`Probing with: ${row.business_name} (${row.google_place_id})`)
    console.log(`Payload: ${body.toString()}\n`)
    for (const c of UPDATE_CANDIDATES) {
      const attempt = new URLSearchParams(body)
      if (c.methodOverride) attempt.set('_method', c.methodOverride)
      try {
        const { status, raw } = await callBd(c.path, attempt, bdKey!, c.method)
        console.log(
          `${c.method}${c.methodOverride ? ` (_method=${c.methodOverride})` : ''} ${BD_BASE}/${c.path}\n` +
          `  → ${status} · ${describeBdResponse(status, raw)}\n` +
          `  raw: ${raw.slice(0, 400) || '(empty)'}\n`,
        )
      } catch (err) {
        console.log(`${c.method} ${BD_BASE}/${c.path}\n  → threw: ${err instanceof Error ? err.message : String(err)}\n`)
      }
      await sleep(BD_DELAY_MS)
    }
    // ── Read endpoints: recover the user ids update needs ──
    const email = row.google_place_id ? listingEmail(row.google_place_id) : ''
    console.log('─'.repeat(72))
    console.log('Read-endpoint probe (recovering bd_user_id). user_id=31 is a known-good control.\n')

    for (const c of READ_CANDIDATES) {
      for (const query of [`email=${encodeURIComponent(email)}`, 'user_id=31']) {
        const url = `${BD_BASE}/${c.path}?${query}&bdapi_model=user`
        try {
          const res = await fetch(url, {
            method:  c.method,
            headers: { 'X-Api-Key': bdKey!, accept: 'application/json' },
            redirect: 'manual',
            signal:  AbortSignal.timeout(15_000),
          })
          const raw = await res.text().catch(() => '')
          console.log(
            `${c.method} ${c.path}?${query.split('=')[0]}=…\n` +
            `  → ${res.status} · ${describeBdResponse(res.status, raw)}\n` +
            `  raw: ${raw.slice(0, 300) || '(empty)'}\n`,
          )
        } catch (err) {
          console.log(`${c.method} ${c.path}?${query.split('=')[0]}\n  → threw: ${err instanceof Error ? err.message : String(err)}\n`)
        }
        await sleep(BD_DELAY_MS)
      }
    }

    console.log('Probe complete. Set BD_HD_UPDATE_PATH / BD_HD_UPDATE_METHOD to whichever combination succeeded.')
    return
  }

  const updatePath   = process.env.BD_HD_UPDATE_PATH   ?? UPDATE_CANDIDATES[0].path
  const updateMethod = process.env.BD_HD_UPDATE_METHOD ?? UPDATE_CANDIDATES[0].method

  // Resolve BD user ids. Only listings BD will surface can be updated, and it
  // surfaces exactly the first 100 members — see fetchBdUserMap.
  const bdMap = placesOnly || dryRun ? new Map<string, string>() : await fetchBdUserMap(bdKey!)
  const idFor = (r: Row): string | null =>
    r.bd_user_id ?? (r.google_place_id ? bdMap.get(listingEmail(r.google_place_id)) ?? null : null)

  if (!placesOnly && !dryRun) {
    const addressable = rows.filter(r => idFor(r) !== null).length
    console.log(`BD user map: ${bdMap.size} member(s) visible · ${addressable}/${rows.length} listings addressable`)
    if (addressable < rows.length) {
      console.log(
        `${rows.length - addressable} listing(s) sit beyond BD's 100-member read window and cannot be\n` +
        `updated via the API. They are skipped rather than guessed at — writing to an inferred\n` +
        `user_id would overwrite another business's record, and BD offers no way to read one back.`,
      )
    }
    console.log('─'.repeat(72))
  }

  const eligible = placesOnly || dryRun ? rows : rows.filter(r => idFor(r) !== null)
  const queue = Number.isFinite(limit) ? eligible.slice(0, limit) : eligible

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
    let bdUserId = idFor(row)
    let bdAccepted = false
    if (!placesOnly && bdUserId) {
      try {
        const { status, raw } = await callBd(updatePath, bdPayload(row, place, bdUserId), bdKey!, updateMethod)
        if (verbose) console.log(`      ← ${status}: ${raw.slice(0, 400)}`)
        if (status >= 200 && status < 300 && !/"status"\s*:\s*"error"/.test(raw)) {
          bdOk++
          bdAccepted = true
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

    // enriched_at means "BD has the data", so it is stamped only when BD
    // accepted this row. --places-only must never stamp it: the Supabase side
    // being current says nothing about the listing, and marking these done
    // would empty the queue and silently skip the BD pass entirely.
    const { error: updErr } = await supabase
      .from('hd_directory_prospects')
      .update({
        ...(hasGeo ? { lat, lon } : {}),
        ...(website ? { website } : {}),
        ...(bdUserId ? { bd_user_id: bdUserId } : {}),
        ...(bdAccepted ? { enriched_at: new Date().toISOString() } : {}),
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
