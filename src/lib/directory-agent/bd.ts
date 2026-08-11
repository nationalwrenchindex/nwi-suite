// Brilliant Directories listing creation for the directory agent.
//
// Same API as src/lib/brilliant-directories/client.ts (which publishes NWI Suite
// subscribers) but a separate entry point: this one authenticates with
// BD_DIRECTORY_AGENT_KEY so outreach-created listings can be keyed, rate-limited
// and revoked independently of subscriber publishing.
//
// Transport notes carried over from the subscriber client, both load-bearing:
//   • BD /api/v2 is form-encoded, NOT JSON, despite the field set being
//     documented as a JSON object.
//   • The base URL MUST be the www host. The apex 301-redirects, and fetch
//     rewrites a redirected POST into a bodyless GET, which BD answers with
//     "405 Invalid Request Method". redirect:'manual' turns that into a loud
//     config error instead of a silent no-op.

import { randomBytes } from 'crypto'

const BASE_URL     = process.env.BD_BASE_URL ?? 'https://www.nationalwrenchindex.com/api/v2'
const DIRECTORY_URL = 'https://www.nationalwrenchindex.com'

export interface AgentListingInput {
  businessName: string
  city:         string | null
  state:        string | null
  phone:        string
}

export interface AgentListingResult {
  listingUrl: string
  email:      string
  rawBody:    string
}

// BD requires an email + password per member. The mechanic never signs in
// through us, so we mint a unique mailbox-less address on our own domain and a
// password we intentionally do not keep — they claim the account through BD's
// password-reset flow if they ever want to edit the listing.
function generateListingEmail(businessName: string): string {
  const slug = businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'mechanic'
  return `${slug}-${randomBytes(4).toString('hex')}@nwi-listing.com`
}

function generatePassword(): string {
  return randomBytes(18).toString('base64url')
}

/**
 * BD renders phone as a display string, so post the US national format rather
 * than E.164 — a visitor should not see a +1 prefix on the directory. Matches
 * toBdPhone in src/lib/hd-directory-agent/bd.ts.
 */
function toBdPhone(e164: string): string {
  const ten = e164.replace(/\D/g, '').slice(-10)
  return ten.length === 10 ? `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}` : e164
}

export function isAgentPublishConfigured(): boolean {
  return !!(process.env.BD_DIRECTORY_AGENT_KEY && process.env.BD_SUBSCRIPTION_ID)
}

export async function createAgentListing(
  input: AgentListingInput,
): Promise<AgentListingResult> {
  const apiKey         = process.env.BD_DIRECTORY_AGENT_KEY
  const subscriptionId = process.env.BD_SUBSCRIPTION_ID
  if (!apiKey || !subscriptionId) throw new Error('BD_AGENT_NOT_CONFIGURED')

  const email = generateListingEmail(input.businessName)

  const body = new URLSearchParams({
    email,
    password:        generatePassword(),
    subscription_id: subscriptionId,
    company:         input.businessName,
    profession_name: 'Mobile Mechanic',
    listing_type:    'Company',
    first_name:      'Business',
    last_name:       'Owner',
    // `phone_number`, NOT `phone`. Confirmed by reading BD's echo of a created
    // user: posting `phone` is silently ignored and the record comes back with
    // phone_number:null, which is why agent-created listings had no phone.
    phone_number:    toBdPhone(input.phone),
    listing_live:    process.env.BD_LISTING_LIVE ?? 'false',
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
      `BD API redirected (${res.status}) to ${res.headers.get('location') ?? 'unknown'} — ` +
      `BD_BASE_URL must point at the canonical host, no redirect.`,
    )
  }

  const rawBody = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(`BD API ${res.status}: ${rawBody || res.statusText}`)
  }

  return { listingUrl: extractListingUrl(rawBody, input.businessName), email, rawBody: rawBody.slice(0, 2000) }
}

// BD's create response shape isn't contractually documented. Use a profile
// permalink if one comes back; otherwise fall back to the directory search URL
// for the business name — which is what the confirmation SMS tells them to do.
function extractListingUrl(rawBody: string, businessName: string): string {
  try {
    const json    = JSON.parse(rawBody) as Record<string, unknown>
    // BD nests the created record under `message`, not `data`, and `filename`
    // is the profile slug ("lexington/minuteman-mobile-mechanics") — the only
    // permalink it returns. There is no /profile/<id> route.
    const message = json.message as Record<string, unknown> | undefined

    const filename = message?.filename
    if (typeof filename === 'string' && filename.length > 0) {
      return `${DIRECTORY_URL}/${filename.replace(/^\//, '')}`
    }
  } catch { /* non-JSON success body — fall through to search URL */ }

  return `${DIRECTORY_URL}/search?q=${encodeURIComponent(businessName)}`
}
