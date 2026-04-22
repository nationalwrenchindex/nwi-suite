// Fuel price lookup via EIA (U.S. Energy Information Administration) free API.
// Used to calculate per-job fuel costs when an invoice is marked paid.
//
// PartsTech integration note: this module is part of the pre-launch demo stack.
// The EIA data is free, weekly, and requires a free API key at https://www.eia.gov/opendata/
// Set EIA_API_KEY in environment. Without it, hardcoded fallback prices are used.
//
// TODO (scale): replace module-level cache with Redis/Upstash when moving to
// multi-region deployment, as serverless cold-starts don't share module state.

const FALLBACK_PRICE_GASOLINE = 3.50   // $/gal — updated periodically
const FALLBACK_PRICE_DIESEL   = 3.80   // $/gal — updated periodically

// PADD 1C = Lower Atlantic region (covers NC, SC, VA, GA, FL, MD, DE)
const EIA_AREA            = 'R1C'
const EIA_PRODUCT_GAS     = 'EPM0'    // regular gasoline, all formulations
const EIA_PRODUCT_DIESEL  = 'EPD2D'   // on-highway diesel

const CACHE_TTL_MS = 24 * 60 * 60 * 1000  // 24 hours

interface CacheEntry {
  gasoline:  number
  diesel:    number
  fetchedAt: number
}

let priceCache: CacheEntry | null = null

async function fetchFromEIA(apiKey: string): Promise<{ gasoline: number; diesel: number } | null> {
  function buildUrl(product: string) {
    const params = new URLSearchParams({
      api_key:              apiKey,
      frequency:            'weekly',
      'data[0]':            'value',
      'facets[product][]':  product,
      'facets[area][]':     EIA_AREA,
      'sort[0][column]':    'period',
      'sort[0][direction]': 'desc',
      length:               '1',
    })
    return `https://api.eia.gov/v2/petroleum/pri/gnd/data/?${params}`
  }

  const [gasRes, dslRes] = await Promise.all([
    fetch(buildUrl(EIA_PRODUCT_GAS),    { next: { revalidate: 0 } }),
    fetch(buildUrl(EIA_PRODUCT_DIESEL), { next: { revalidate: 0 } }),
  ])

  if (!gasRes.ok || !dslRes.ok) return null

  const [gasJson, dslJson] = await Promise.all([gasRes.json(), dslRes.json()])

  const gasValue = Number(gasJson?.response?.data?.[0]?.value)
  const dslValue = Number(dslJson?.response?.data?.[0]?.value)

  if (!gasValue || !dslValue || isNaN(gasValue) || isNaN(dslValue)) return null

  return {
    gasoline: Math.round(gasValue * 1000) / 1000,
    diesel:   Math.round(dslValue * 1000) / 1000,
  }
}

export async function getCurrentFuelPrice(fuelType: 'gasoline' | 'diesel' | string): Promise<number> {
  const apiKey = process.env.EIA_API_KEY

  // Return from cache if fresh
  if (priceCache && Date.now() - priceCache.fetchedAt < CACHE_TTL_MS) {
    return fuelType === 'diesel' ? priceCache.diesel : priceCache.gasoline
  }

  if (!apiKey) {
    console.warn('[fuel-price] EIA_API_KEY not set — using fallback prices ($3.50 gas / $3.80 diesel)')
    return fuelType === 'diesel' ? FALLBACK_PRICE_DIESEL : FALLBACK_PRICE_GASOLINE
  }

  try {
    const prices = await fetchFromEIA(apiKey)
    if (!prices) throw new Error('Empty or malformed EIA response')

    priceCache = { ...prices, fetchedAt: Date.now() }
    console.log(`[fuel-price] EIA prices refreshed — gas $${prices.gasoline} / diesel $${prices.diesel} (PADD 1C)`)
    return fuelType === 'diesel' ? prices.diesel : prices.gasoline
  } catch (err) {
    console.warn('[fuel-price] EIA API failed, using fallback prices:', err instanceof Error ? err.message : err)
    return fuelType === 'diesel' ? FALLBACK_PRICE_DIESEL : FALLBACK_PRICE_GASOLINE
  }
}
