// Google Places (New) lookup for nearby auto-parts stores. Server-side only —
// uses GOOGLE_MAPS_API_KEY. Returns the closest chain parts retailers.
//
// Uses the Places API (New) endpoint places.googleapis.com/v1/places:searchNearby
// (the API confirmed enabled in Google Cloud), with the phone number returned in
// the same response via the field mask — no separate Place Details call needed.
//
// searchNearby also surfaces repair shops / restoration companies, so we filter
// the results down to recognized parts chains by name.

interface StoreResult {
  name:          string
  address:       string
  phone:         string
  placeId:       string
  distanceMiles: number
  lat:           number
  lng:           number
  note?:         string
}

// Case-insensitive chain-name matches. Includes the broad 'auto parts' catch-all so
// regional "<Town> Auto Parts" retailers also pass.
const CHAIN_NAMES = [
  'autozone', "o'reilly", 'napa', 'advance auto', 'advance auto parts', 'carquest',
  "o'reilly auto parts", 'autozone auto parts', 'napa auto parts', 'pep boys',
  'discount auto', 'auto parts',
]
const isChain = (name: string) => {
  const n = name.toLowerCase()
  return CHAIN_NAMES.some(c => n.includes(c))
}

function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 3958.8 // Earth radius in miles
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

interface PlaceNew {
  id?:                  string
  displayName?:         { text?: string }
  formattedAddress?:    string
  nationalPhoneNumber?: string
  location?:            { latitude?: number; longitude?: number }
  types?:               string[]
}

async function searchNearby(key: string, lat: number, lng: number, includedTypes: string[]): Promise<PlaceNew[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'X-Goog-Api-Key':   key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.location,places.types',
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount:      20,
      rankPreference:      'DISTANCE', // closest-first
      locationRestriction: {
        circle: {
          // Widest net Places API (New) allows (50 km); the haversine sort below
          // still puts the closest results first regardless of radius.
          center: { latitude: lat, longitude: lng },
          radius: 50000,
        },
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // Log the exact Google error body so the specific 400 reason is visible.
    console.error(`[nearby-stores] Google Places ${res.status} error body:`, body)
    throw new Error(`Google Places error: ${res.status}${body ? ` — ${body}` : ''}`)
  }
  const data = await res.json() as { places?: PlaceNew[] }
  return data.places ?? []
}

export async function getNearbyPartsStores(lat: number, lng: number): Promise<StoreResult[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) throw new Error('GOOGLE_MAPS_NOT_CONFIGURED')

  // Single search on auto_parts_store (one confirmed-valid type per request).
  const partsResults = await searchNearby(key, lat, lng, ['auto_parts_store'])

  const toStore = (p: PlaceNew, note?: string): StoreResult | null => {
    const rlat = p.location?.latitude
    const rlng = p.location?.longitude
    if (typeof rlat !== 'number' || typeof rlng !== 'number' || !p.id) return null
    return {
      name:          p.displayName?.text ?? 'Auto Parts Store',
      address:       p.formattedAddress ?? '',
      phone:         p.nationalPhoneNumber ?? '',
      placeId:       p.id,
      lat:           rlat,
      lng:           rlng,
      distanceMiles: Math.round(distanceMiles(lat, lng, rlat, rlng) * 10) / 10,
      ...(note ? { note } : {}),
    }
  }

  // Filter results to recognized parts chains, closest-first.
  const chains = partsResults
    .map(p => toStore(p))
    .filter((s): s is StoreResult => s !== null && isChain(s.name))
    .sort((a, b) => a.distanceMiles - b.distanceMiles)

  if (chains.length >= 2) return chains.slice(0, 5)

  // Fallback: too few chains matched — show ALL auto_parts_store results unfiltered
  // so the tech always sees something, flagged to verify before dispatching.
  return partsResults
    .map(p => toStore(p, 'Verify this is an auto parts retailer before sending a driver'))
    .filter((s): s is StoreResult => s !== null)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
}
