import { randomBytes } from 'crypto'

// Brilliant Directories API client.
//
// Docs: https://support.brilliantdirectories.com/support/solutions/folders/12000019107
// The base URL is the directory's OWN domain, not a shared vendor host —
// BD serves /api/v2/ from each customer site. Requests are form-encoded
// (NOT JSON) and authenticated with an X-Api-Key header.

// MUST be the www host. The apex domain 301-redirects to www, and fetch rewrites
// a redirected POST into a GET with no body (per the Fetch spec), which BD
// answers with "405 Invalid Request Method" — the request never arrives.
const BASE_URL = process.env.BD_BASE_URL ?? 'https://www.nationalwrenchindex.com/api/v2'

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

// Confirmed against nationalwrenchindex.com's member-import documentation.
const FIELDS = {
  firstName:  'first_name',
  lastName:   'last_name',
  company:    'company',
  city:       'city',
  state:      'state',
  phone:      'phone',
  website:    'website',
  profession: 'profession_name',
  listingType: 'listing_type',
} as const

// Every NWI Suite listing is a business profile in the mechanic profession.
const PROFESSION_NAME = 'Mobile Mechanic'
const LISTING_TYPE    = 'Company'

export interface CreateListingInput {
  email:        string
  firstName:    string | null
  lastName:     string | null
  businessName: string
  city:         string | null
  state:        string | null
  phone:        string | null
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
    [FIELDS.company]:     input.businessName,
    [FIELDS.website]:     input.bookingUrl,
    [FIELDS.profession]:  PROFESSION_NAME,
    [FIELDS.listingType]: LISTING_TYPE,
  })

  if (input.firstName) body.set(FIELDS.firstName, input.firstName)
  if (input.lastName)  body.set(FIELDS.lastName,  input.lastName)
  if (input.city)      body.set(FIELDS.city,      input.city)
  if (input.state)     body.set(FIELDS.state,     input.state)
  if (input.phone)     body.set(FIELDS.phone,     input.phone)

  const res = await fetch(`${BASE_URL}/user/create`, {
    method: 'POST',
    headers: {
      'X-Api-Key':    apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
      accept:         'application/json',
    },
    body: body.toString(),
    // Never follow a redirect: it would silently downgrade this POST to a
    // bodyless GET. Surface it as a config error instead.
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
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
