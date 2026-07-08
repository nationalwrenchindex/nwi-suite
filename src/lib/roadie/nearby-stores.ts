// Google Places lookup for nearby auto-parts stores. Server-side only —
// uses GOOGLE_MAPS_API_KEY. Returns the closest 3 stores (preferring the major
// chains) with a phone number the tech can tap to call the counter.

const PARTS_CHAINS = [
  "o'reilly", 'autozone', 'napa', 'advance auto', 'carquest', 'napa auto parts',
  "o'reilly auto parts", 'advance auto parts',
]

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

export async function getNearbyPartsStores(lat: number, lng: number): Promise<StoreResult[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) throw new Error('GOOGLE_MAPS_NOT_CONFIGURED')

  const nearbyUrl =
    `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
    `?location=${lat},${lng}&rankby=distance&keyword=${encodeURIComponent('auto parts store')}&key=${key}`

  const res = await fetch(nearbyUrl)
  if (!res.ok) throw new Error(`Google Places error: ${res.status}`)
  const data = await res.json() as {
    results?: Array<{
      name?: string
      vicinity?: string
      place_id?: string
      geometry?: { location?: { lat?: number; lng?: number } }
    }>
  }

  const mapped = (data.results ?? [])
    .map(r => {
      const rlat = r.geometry?.location?.lat
      const rlng = r.geometry?.location?.lng
      if (typeof rlat !== 'number' || typeof rlng !== 'number' || !r.place_id) return null
      return {
        name:          r.name ?? 'Auto Parts Store',
        address:       r.vicinity ?? '',
        phone:         '',
        placeId:       r.place_id,
        lat:           rlat,
        lng:           rlng,
        distanceMiles: distanceMiles(lat, lng, rlat, rlng),
      }
    })
    .filter((s): s is StoreResult => s !== null)
    .sort((a, b) => a.distanceMiles - b.distanceMiles)

  // Prefer the recognized parts chains, then fall back to any nearby store.
  const isChain = (s: StoreResult) => PARTS_CHAINS.some(c => s.name.toLowerCase().includes(c))
  const chains  = mapped.filter(isChain)
  const others  = mapped.filter(s => !isChain(s))
  const top     = [...chains, ...others].slice(0, 3)

  // Enrich with phone + formatted address via Place Details.
  return Promise.all(top.map(async s => {
    let phone   = ''
    let address = s.address
    try {
      const detailUrl =
        `https://maps.googleapis.com/maps/api/place/details/json` +
        `?place_id=${s.placeId}&fields=formatted_phone_number,formatted_address&key=${key}`
      const dres = await fetch(detailUrl)
      const dd   = await dres.json() as { result?: { formatted_phone_number?: string; formatted_address?: string } }
      phone   = dd.result?.formatted_phone_number ?? ''
      address = dd.result?.formatted_address ?? s.address
    } catch { /* phone/address are best-effort */ }
    return { ...s, phone, address, distanceMiles: Math.round(s.distanceMiles * 10) / 10 }
  }))
}
