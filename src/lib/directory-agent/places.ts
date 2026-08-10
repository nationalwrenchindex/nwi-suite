// Google Places lookup for mobile mechanics in a target city.
//
// Uses Places API (New) — places.googleapis.com/v1/places:searchText — the same
// endpoint family as src/lib/roadie/nearby-stores.ts, but keyed on
// GOOGLE_PLACES_API_KEY as specified for the directory agent.
//
// Three queries are run per city ("mobile mechanic", "mobile auto repair",
// "mobile car repair") because Places ranks text queries independently and each
// phrasing surfaces businesses the others miss. Results are merged by place id.

import { normalizeUsPhone } from './config'

export interface PlaceProspect {
  placeId:      string
  businessName: string
  phone:        string        // E.164
  rating:       number | null
  city:         string | null
  state:        string | null
  address:      string | null
  website:      string | null
}

const SEARCH_QUERIES = ['mobile mechanic', 'mobile auto repair', 'mobile car repair'] as const

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

interface AddressComponent {
  longText?:  string
  shortText?: string
  types?:     string[]
}

interface PlaceNew {
  id?:                        string
  displayName?:               { text?: string }
  formattedAddress?:          string
  nationalPhoneNumber?:       string
  internationalPhoneNumber?:  string
  rating?:                    number
  websiteUri?:                string
  addressComponents?:         AddressComponent[]
  location?:                  { latitude?: number; longitude?: number }
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
    console.error(`[directory-agent/places] searchText ${res.status}:`, errBody)
    throw new Error(`Google Places error: ${res.status}${errBody ? ` — ${errBody}` : ''}`)
  }

  const data = await res.json() as { places?: PlaceNew[] }
  return data.places ?? []
}

// Resolve "Winston-Salem, NC" to a lat/lng so the three business queries can be
// radius-biased. Best effort: if it fails we still search, just without a bias
// (the city name is in the query text either way).
async function geocodeCity(key: string, city: string, state: string) {
  try {
    const places = await searchText(key, `${city}, ${state}`, null, 'places.location')
    const loc = places[0]?.location
    if (typeof loc?.latitude === 'number' && typeof loc?.longitude === 'number') {
      return { lat: loc.latitude, lng: loc.longitude }
    }
  } catch (err) {
    console.warn(
      `[directory-agent/places] geocode failed for ${city}, ${state}:`,
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

// Finds candidate businesses in a city. Applies only the filters that depend on
// Google's data (rating floor, valid US phone) — opt-out and already-contacted
// filtering happens in the route, against the database.
export async function findMobileMechanics(
  city: string,
  state: string,
  radiusMeters: number,
  minRating: number,
): Promise<PlaceProspect[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) throw new Error('GOOGLE_PLACES_NOT_CONFIGURED')

  const center = await geocodeCity(key, city, state)
  const bias   = center ? { ...center, radius: radiusMeters } : null

  const byPlaceId = new Map<string, PlaceProspect>()

  for (const query of SEARCH_QUERIES) {
    const places = await searchText(key, `${query} in ${city}, ${state}`, bias, FIELD_MASK)

    for (const p of places) {
      if (!p.id || byPlaceId.has(p.id)) continue

      // Rating floor — unrated businesses are excluded, not defaulted in.
      if (typeof p.rating !== 'number' || p.rating < minRating) continue

      const phone = normalizeUsPhone(p.nationalPhoneNumber ?? p.internationalPhoneNumber)
      if (!phone) continue

      byPlaceId.set(p.id, {
        placeId:      p.id,
        businessName: p.displayName?.text ?? 'Mobile Mechanic',
        phone,
        rating:       p.rating,
        city:         componentOf(p.addressComponents, 'locality') ?? city,
        state:        componentOf(p.addressComponents, 'administrative_area_level_1', true) ?? state,
        address:      p.formattedAddress ?? null,
        website:      p.websiteUri ?? null,
      })
    }
  }

  // Highest rated first — the invite batch drains this order.
  return [...byPlaceId.values()].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
}
