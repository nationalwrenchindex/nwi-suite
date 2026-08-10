// Google Places lookup for heavy-duty service providers.
//
// Same Places API (New) searchText endpoint as the LD agent
// (src/lib/directory-agent/places.ts), but sweeping ~33 category-tagged queries
// per city instead of three. That volume is why queries run concurrently and
// why the caller gets a time budget — see searchCity below.

import { normalizeUsPhone } from '@/lib/directory-agent/config'
import {
  HD_MIN_RATING_MOBILE,
  HD_MIN_RATING_SHOP,
  HD_SEARCH_TERMS,
  type HdSearchTerm,
  type HdServiceCategory,
} from './config'

export interface HdProspect {
  placeId:         string
  businessName:    string
  phone:           string        // E.164
  rating:          number | null
  city:            string | null
  state:           string | null
  address:         string | null
  website:         string | null
  serviceCategory: HdServiceCategory
}

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.rating',
  'places.websiteUri',
  'places.addressComponents',
  'places.location',
].join(',')

// How many Places calls are in flight at once for a single city. Kept well
// under Google's per-project QPS so a 15-city sweep doesn't trip rate limiting.
const QUERY_CONCURRENCY = 8

interface AddressComponent {
  longText?:  string
  shortText?: string
  types?:     string[]
}

interface PlaceNew {
  id?:                       string
  displayName?:              { text?: string }
  formattedAddress?:         string
  nationalPhoneNumber?:      string
  internationalPhoneNumber?: string
  rating?:                   number
  websiteUri?:               string
  addressComponents?:        AddressComponent[]
  location?:                 { latitude?: number; longitude?: number }
}

async function searchText(
  key: string,
  textQuery: string,
  bias: { lat: number; lng: number; radius: number } | null,
  fieldMask: string,
): Promise<PlaceNew[]> {
  const body: Record<string, unknown> = { textQuery, maxResultCount: 20 }
  if (bias) {
    body.locationBias = {
      circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: bias.radius },
    }
  }

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'X-Goog-Api-Key':   key,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    console.error(`[hd-directory-agent/places] searchText ${res.status}:`, errBody)
    throw new Error(`Google Places error: ${res.status}${errBody ? ` — ${errBody}` : ''}`)
  }

  const data = await res.json() as { places?: PlaceNew[] }
  return data.places ?? []
}

// Best effort: if geocoding fails we still search, just without a radius bias
// (the city name is in every query string either way).
async function geocodeCity(key: string, city: string, state: string) {
  try {
    const places = await searchText(key, `${city}, ${state}`, null, 'places.location')
    const loc = places[0]?.location
    if (typeof loc?.latitude === 'number' && typeof loc?.longitude === 'number') {
      return { lat: loc.latitude, lng: loc.longitude }
    }
  } catch (err) {
    console.warn(
      `[hd-directory-agent/places] geocode failed for ${city}, ${state}:`,
      err instanceof Error ? err.message : String(err),
    )
  }
  return null
}

function componentOf(components: AddressComponent[] | undefined, type: string, short = false) {
  const match = components?.find(c => c.types?.includes(type))
  if (!match) return null
  return (short ? match.shortText : match.longText) ?? null
}

// Runs `worker` over `items` with at most `limit` in flight. Results keep input
// order; a worker that throws yields null rather than sinking the batch.
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<(R | null)[]> {
  const results = new Array<R | null>(items.length).fill(null)
  let cursor = 0

  async function runner() {
    while (cursor < items.length) {
      const index = cursor++
      try {
        results[index] = await worker(items[index], index)
      } catch (err) {
        console.warn(
          '[hd-directory-agent/places] query failed:',
          err instanceof Error ? err.message : String(err),
        )
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner))
  return results
}

function minRatingFor(term: HdSearchTerm): number {
  return term.mobile ? HD_MIN_RATING_MOBILE : HD_MIN_RATING_SHOP
}

// Sweeps every HD search term for one city. Dedupes by place id across terms —
// first match wins, which is why HD_SEARCH_TERMS is ordered specific-first, so
// a reefer shop is not miscategorized as a generic 'shop'.
export async function searchCity(
  city: string,
  state: string,
  radiusMeters: number,
): Promise<HdProspect[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) throw new Error('GOOGLE_PLACES_NOT_CONFIGURED')

  const center = await geocodeCity(key, city, state)
  const bias   = center ? { ...center, radius: radiusMeters } : null

  const perTerm = await mapWithConcurrency(
    HD_SEARCH_TERMS,
    QUERY_CONCURRENCY,
    term => searchText(key, `${term.query} in ${city}, ${state}`, bias, FIELD_MASK),
  )

  const byPlaceId = new Map<string, HdProspect>()

  HD_SEARCH_TERMS.forEach((term, i) => {
    const places = perTerm[i]
    if (!places) return
    const floor = minRatingFor(term)

    for (const p of places) {
      if (!p.id || byPlaceId.has(p.id)) continue

      // Rating floor — unrated businesses are excluded, not defaulted in.
      if (typeof p.rating !== 'number' || p.rating < floor) continue

      const phone = normalizeUsPhone(p.nationalPhoneNumber ?? p.internationalPhoneNumber)
      if (!phone) continue

      byPlaceId.set(p.id, {
        placeId:         p.id,
        businessName:    p.displayName?.text ?? 'Heavy Duty Service',
        phone,
        rating:          p.rating,
        city:            componentOf(p.addressComponents, 'locality') ?? city,
        state:           componentOf(p.addressComponents, 'administrative_area_level_1', true) ?? state,
        address:         p.formattedAddress ?? null,
        website:         p.websiteUri ?? null,
        serviceCategory: term.category,
      })
    }
  })

  // Highest rated first — the invite batch drains this order.
  return [...byPlaceId.values()].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
}
