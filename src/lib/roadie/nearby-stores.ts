// Google Places (New) lookup for nearby auto-parts stores. Server-side only —
// uses GOOGLE_MAPS_API_KEY. Returns the closest 3 stores (closest-first) with a
// phone number the tech can tap to call the counter.
//
// Uses the Places API (New) endpoint places.googleapis.com/v1/places:searchNearby
// (the API confirmed enabled in Google Cloud), with the phone number returned in
// the same response via the field mask — no separate Place Details call needed.

interface StoreResult {
  name:          string
  address:       string
  phone:         string
  placeId:       string
  distanceMiles: number
  lat:           number
  lng:           number
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
}

export async function getNearbyPartsStores(lat: number, lng: number): Promise<StoreResult[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) throw new Error('GOOGLE_MAPS_NOT_CONFIGURED')

  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'X-Goog-Api-Key':   key,
      // Field mask keeps the response (and billing SKU) lean; nationalPhoneNumber
      // means we get the counter phone in this one call.
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.location',
    },
    body: JSON.stringify({
      includedTypes:       ['auto_parts_store'],
      maxResultCount:      20,
      rankPreference:      'DISTANCE', // closest-first
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 50000, // meters (max); DISTANCE rank returns nearest first
        },
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Google Places error: ${res.status}${body ? ` — ${body}` : ''}`)
  }

  const data = await res.json() as { places?: PlaceNew[] }

  return (data.places ?? [])
    .map(p => {
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
      }
    })
    .filter((s): s is StoreResult => s !== null)
    .sort((a, b) => a.distanceMiles - b.distanceMiles) // closest-first
    .slice(0, 3)
}
