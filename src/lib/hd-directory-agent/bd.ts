// Brilliant Directories listing creation for the HD directory agent.
//
// Same API shape as the LD agent's client (src/lib/directory-agent/bd.ts) but
// pointed at the HD directory (nwihd.com) with its own key and subscription id,
// so HD outreach can be keyed, rate-limited and revoked independently.
//
// Transport notes carried over from the LD clients, both load-bearing:
//   • BD /api/v2 is form-encoded, NOT JSON.
//   • The base URL MUST be the www host. The apex 301-redirects, and fetch
//     rewrites a redirected POST into a bodyless GET, which BD answers with
//     "405 Invalid Request Method". redirect:'manual' turns that into a loud
//     config error instead of a silent no-op.

import { randomBytes } from 'crypto'
import { HD_PROFESSION_NAME, type HdServiceCategory } from './config'

const BASE_URL      = process.env.BD_HD_BASE_URL ?? 'https://www.nwihd.com/api/v2'
const DIRECTORY_URL = 'https://www.nwihd.com'

export interface HdListingInput {
  businessName:    string
  city:            string | null
  state:           string | null
  phone:           string
  serviceCategory: string | null
}

export interface HdListingResult {
  listingUrl: string
  email:      string
  rawBody:    string
  /**
   * BD's id for the created member. Store it: BD's update API keys on user_id
   * and offers no way to look one up beyond the first 100 members, so a listing
   * whose id was never captured becomes permanently un-editable.
   */
  userId:     string | null
}

// BD requires an email + password per member. The provider never signs in
// through us, so we mint a unique mailbox-less address and a password we
// intentionally do not keep — they claim the account through BD's
// password-reset flow if they ever want to edit the listing.
function generateListingEmail(businessName: string): string {
  const slug = businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'provider'
  return `${slug}-${randomBytes(4).toString('hex')}@nwihd-listing.com`
}

function generatePassword(): string {
  return randomBytes(18).toString('base64url')
}

/**
 * BD renders phone as a display string, so send the national format rather than
 * E.164 — a driver should not see a +1 prefix on the directory.
 */
function toBdPhone(e164: string): string {
  const ten = e164.replace(/\D/g, '').slice(-10)
  return ten.length === 10 ? `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}` : e164
}

export function isHdPublishConfigured(): boolean {
  return !!(process.env.BD_HD_DIRECTORY_AGENT_KEY && process.env.BD_HD_SUBSCRIPTION_ID)
}

function professionFor(category: string | null): string {
  if (category && category in HD_PROFESSION_NAME) {
    return HD_PROFESSION_NAME[category as HdServiceCategory]
  }
  return 'Heavy Duty Service'
}

export async function createHdListing(input: HdListingInput): Promise<HdListingResult> {
  const apiKey         = process.env.BD_HD_DIRECTORY_AGENT_KEY
  const subscriptionId = process.env.BD_HD_SUBSCRIPTION_ID
  if (!apiKey || !subscriptionId) throw new Error('BD_HD_NOT_CONFIGURED')

  const email = generateListingEmail(input.businessName)

  const body = new URLSearchParams({
    email,
    password:        generatePassword(),
    subscription_id: subscriptionId,
    company:         input.businessName,
    profession_name: professionFor(input.serviceCategory),
    listing_type:    'Company',
    first_name:      'Business',
    last_name:       'Owner',
    // `phone_number`, NOT `phone`. Confirmed by reading BD's echo of a created
    // user: posting `phone` is silently ignored and the record comes back with
    // phone_number:null, which is why early HD listings had no phone at all.
    phone_number:    toBdPhone(input.phone),
    // Falls back to the LD flag so one switch can gate both directories until
    // HD gets its own.
    listing_live:    process.env.BD_HD_LISTING_LIVE ?? process.env.BD_LISTING_LIVE ?? 'false',
    bdapi_model:     'user',
  })

  if (input.city)  body.set('city', input.city)
  // `state_code`, NOT `state` — same finding as phone_number above. Posting
  // `state` comes back as state_code:"" on the created record.
  if (input.state) body.set('state_code', input.state)

  const res = await fetch(`${BASE_URL}/user/create`, {
    method: 'POST',
    headers: {
      'X-Api-Key':    apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
      accept:         'application/json',
    },
    body:     body.toString(),
    redirect: 'manual',
    signal:   AbortSignal.timeout(15_000),
  })

  if (res.status >= 300 && res.status < 400) {
    throw new Error(
      `BD HD API redirected (${res.status}) to ${res.headers.get('location') ?? 'unknown'} — ` +
      `BD_HD_BASE_URL must point at the canonical host, no redirect.`,
    )
  }

  const rawBody = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(`BD HD API ${res.status}: ${rawBody || res.statusText}`)
  }

  return {
    listingUrl: extractListingUrl(rawBody, input.businessName),
    email,
    rawBody:    rawBody.slice(0, 2000),
    userId:     extractUserId(rawBody),
  }
}

function extractUserId(rawBody: string): string | null {
  try {
    const json    = JSON.parse(rawBody) as Record<string, unknown>
    const message = json.message as Record<string, unknown> | undefined
    const id      = message?.user_id
    if (typeof id === 'string' || typeof id === 'number') return String(id)
  } catch { /* non-JSON success body */ }
  return null
}

// BD's create response shape isn't contractually documented. Use a profile
// permalink if one comes back; otherwise fall back to the directory search URL
// for the business name — which is what the confirmation SMS tells them to do.
function extractListingUrl(rawBody: string, businessName: string): string {
  try {
    const json    = JSON.parse(rawBody) as Record<string, unknown>
    // BD nests the created record under `message`, and `filename` is the profile
    // slug ("kenly/flying-j-travel-center") — the only permalink it returns.
    const message = json.message as Record<string, unknown> | undefined

    const filename = message?.filename
    if (typeof filename === 'string' && filename.length > 0) {
      return `${DIRECTORY_URL}/${filename.replace(/^\//, '')}`
    }
  } catch { /* non-JSON success body — fall through to search URL */ }

  return `${DIRECTORY_URL}/search?q=${encodeURIComponent(businessName)}`
}
