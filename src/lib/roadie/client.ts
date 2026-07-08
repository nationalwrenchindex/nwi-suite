// Roadie delivery dispatch client.
//
// Built against the Roadie public API (https://docs.roadie.com). Credentials are
// pending — everything is gated behind the ROADIE_API_KEY feature flag. When the
// key is absent, isRoadieEnabled() is false and every network function throws
// Error('ROADIE_NOT_CONFIGURED') so callers can render a "coming soon" state.
//
// The exact request/response field names below follow Roadie's documented shapes
// and may need minor tweaks once live credentials + the final spec are in hand.

const BASE_URL = 'https://api.roadie.com/v1'

export function isRoadieEnabled(): boolean {
  return !!process.env.ROADIE_API_KEY
}

function apiKey(): string {
  const key = process.env.ROADIE_API_KEY
  if (!key) throw new Error('ROADIE_NOT_CONFIGURED')
  return key
}

async function roadieFetch<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization:  `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Roadie API ${res.status}: ${body || res.statusText}`)
  }
  return res.json() as Promise<T>
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

export async function getRoadieQuote(params: {
  pickupAddress:       string
  pickupLat:           number
  pickupLng:           number
  dropoffLat:          number
  dropoffLng:          number
  pickupContactName:   string
  pickupContactPhone:  string
  dropoffContactName:  string
  dropoffContactPhone: string
  itemDescription:     string
  itemQuantity:        number
}): Promise<{ quoteId: string; feeCents: number; etaMinutes: number; expiresAt: string }> {
  const body = {
    pickup_location: {
      address:   params.pickupAddress,
      latitude:  params.pickupLat,
      longitude: params.pickupLng,
      contact:   { name: params.pickupContactName, phone: params.pickupContactPhone },
    },
    delivery_location: {
      latitude:  params.dropoffLat,
      longitude: params.dropoffLng,
      contact:   { name: params.dropoffContactName, phone: params.dropoffContactPhone },
    },
    items: [{
      description: params.itemDescription,
      quantity:    params.itemQuantity,
      length:      6, width: 6, height: 6, weight: 5,
      value:       50,
    }],
  }
  const data = await roadieFetch<Record<string, unknown>>('/estimates', {
    method: 'POST',
    body:   JSON.stringify(body),
  })
  // Roadie returns price in dollars; convert to integer cents.
  const feeCents    = Math.round(num(data.price ?? data.estimated_price) * 100)
  const etaMinutes  = Math.round(num(data.estimated_delivery_minutes ?? data.eta_minutes))
  const quoteId     = str(data.id ?? data.estimate_id)
  const expiresAt   = str(data.expires_at)
  return { quoteId, feeCents, etaMinutes, expiresAt }
}

export async function acceptRoadieQuote(quoteId: string): Promise<{ deliveryId: string; trackingUrl: string }> {
  const data = await roadieFetch<Record<string, unknown>>('/shipments', {
    method: 'POST',
    body:   JSON.stringify({ estimate_id: quoteId }),
  })
  const tracking = data.tracking as Record<string, unknown> | undefined
  return {
    deliveryId:  str(data.id),
    trackingUrl: str(data.tracking_url ?? tracking?.url),
  }
}

export async function getRoadieDeliveryStatus(deliveryId: string): Promise<{
  status:      string
  driverName?: string
  driverPhone?: string
  etaMinutes?: number
}> {
  const data = await roadieFetch<Record<string, unknown>>(`/shipments/${deliveryId}`, { method: 'GET' })
  const driver = data.driver as Record<string, unknown> | undefined
  const eta = data.eta_minutes ?? data.estimated_delivery_minutes
  return {
    status:      str(data.state ?? data.status) || 'unknown',
    driverName:  driver?.name  ? str(driver.name)  : undefined,
    driverPhone: driver?.phone ? str(driver.phone) : undefined,
    etaMinutes:  eta != null ? Math.round(num(eta)) : undefined,
  }
}
