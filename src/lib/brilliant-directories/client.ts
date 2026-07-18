import { randomBytes } from 'crypto'

// Brilliant Directories API client.
//
// Docs: https://support.brilliantdirectories.com/support/solutions/folders/12000019107
// The base URL is the directory's OWN domain, not a shared vendor host —
// BD serves /api/v2/ from each customer site. Requests are form-encoded
// (NOT JSON) and authenticated with an X-Api-Key header.

const BASE_URL = process.env.BD_BASE_URL ?? 'https://nationalwrenchindex.com/api/v2'

// Gated the same way as Roadie (see src/lib/roadie/client.ts): the integration
// stays inert until every credential is present AND it's explicitly switched on,
// so preview/local never writes real listings to the live directory.
export function isDirectoryPublishEnabled(): boolean {
  return !!(
    process.env.BD_API_KEY &&
    process.env.BD_SUBSCRIPTION_ID &&
    process.env.BD_LISTING_LIVE === 'true'
  )
}

// BD member field names come from each site's CSV member-import template, which
// is site-specific and not published in the public API reference. These are the
// BD default import columns; if nationalwrenchindex.com uses custom field keys,
// correct them HERE and nowhere else.
// Verify against: Admin → Members → Import Members → download template.
const FIELDS = {
  companyName: 'company_name',
  city:        'city',
  state:       'state',
  phone:       'phone',
  website:     'website',
  categories:  'categories',
} as const

export interface CreateListingInput {
  email:        string
  businessName: string
  city:         string | null
  state:        string | null
  phone:        string | null
  services:     readonly string[]
  bookingUrl:   string
}

export interface CreateListingResult {
  userId:  string | null
  rawBody: string
}

// BD requires a password on create even though the mechanic never signs in
// through us. We generate one we intentionally do not keep — the mechanic
// claims the account via BD's password-reset flow if they ever need it.
function generatePassword(): string {
  return randomBytes(18).toString('base64url')
}

export async function createDirectoryListing(
  input: CreateListingInput,
): Promise<CreateListingResult> {
  const apiKey         = process.env.BD_API_KEY
  const subscriptionId = process.env.BD_SUBSCRIPTION_ID
  if (!apiKey || !subscriptionId) throw new Error('BD_NOT_CONFIGURED')

  // Required by BD: email, password, subscription_id (the Membership Plan ID).
  const body = new URLSearchParams({
    email:           input.email,
    password:        generatePassword(),
    subscription_id: subscriptionId,
    [FIELDS.companyName]: input.businessName,
    [FIELDS.website]:     input.bookingUrl,
  })

  if (input.city)  body.set(FIELDS.city,  input.city)
  if (input.state) body.set(FIELDS.state, input.state)
  if (input.phone) body.set(FIELDS.phone, input.phone)
  if (input.services.length) {
    // BD expects category names comma-separated; names containing commas would
    // split incorrectly, so they're dropped rather than silently mangled.
    body.set(FIELDS.categories, input.services.filter(s => !s.includes(',')).join(','))
  }

  const res = await fetch(`${BASE_URL}/user/create`, {
    method: 'POST',
    headers: {
      'X-Api-Key':    apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
      accept:         'application/json',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  })

  const rawBody = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(`BD API ${res.status}: ${rawBody || res.statusText}`)
  }

  // Response shape isn't contractually documented; pull an id if one is present
  // but never fail the call over it.
  let userId: string | null = null
  try {
    const json = JSON.parse(rawBody) as Record<string, unknown>
    const raw  = json.user_id ?? json.id ?? (json.data as Record<string, unknown> | undefined)?.user_id
    if (typeof raw === 'string' || typeof raw === 'number') userId = String(raw)
  } catch { /* non-JSON success body — leave userId null */ }

  return { userId, rawBody: rawBody.slice(0, 2000) }
}
