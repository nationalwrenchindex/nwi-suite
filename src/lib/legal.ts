// ─── Terms and Privacy acceptance ─────────────────────────────────────────────
//
// One place for the version string, so /terms, the signup box, the re-acceptance
// prompt and the recorded value cannot drift apart. A recorded version that does not
// match what the page actually said is worse than no record at all, because it looks
// like evidence.

/**
 * The published version of the Terms and Privacy Policy.
 *
 * A DATE STRING, matching what is shown on /terms. Bumping it re-prompts every account
 * on their next visit, so bump it when the terms materially change - and per clause 10.2
 * that also means giving 30 days' notice first, which this constant does not enforce.
 */
export const LEGAL_VERSION = '2026-10-06'

/** Columns migration 147 adds. Needed for the tolerance below. */
export const LEGAL_COLUMNS = [
  'terms_accepted_at',
  'terms_version',
  'privacy_accepted_at',
  'acceptance_ip',
  'acceptance_user_agent',
] as const

/**
 * True when a write failed only because migration 147 has not been applied yet.
 *
 * Migrations here are applied BY HAND and code deploys independently, so there is a real
 * window where this code knows about five columns the database has never heard of. In
 * that window an acceptance cannot be recorded - but the user must still be able to use
 * the product, and must not see a crash. Mirrors isMissingTaxBreakdownColumn and
 * missingMigration142Column, which exist for exactly the same reason.
 */
export function isMissingLegalColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { message?: unknown; code?: unknown; details?: unknown }
  const text = [e.message, e.details].map(v => String(v ?? '')).join(' ').toLowerCase()
  const looksMissing =
    text.includes('does not exist') ||
    text.includes('could not find') ||
    text.includes('schema cache') ||
    String(e.code ?? '') === 'PGRST204' ||
    String(e.code ?? '') === '42703'
  if (!looksMissing) return false
  return LEGAL_COLUMNS.some(c => text.includes(c))
}

/**
 * True when the database refused the write because the acceptance trigger fired.
 *
 * That is migration 147's gate doing its job: someone tried to complete onboarding
 * without an acceptance on record. The caller should surface it as "accept the terms",
 * not as a server error.
 */
export function isTermsGateViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { message?: unknown; code?: unknown }
  const text = String(e.message ?? '').toLowerCase()
  return text.includes('terms of service must be accepted')
}

export interface AcceptanceState {
  /** Null when never accepted, or when migration 147 is not applied yet. */
  acceptedAt: string | null
  /** The version accepted, if any. */
  version:    string | null
  /** True when the current version has been accepted and nothing needs asking. */
  current:    boolean
  /** True when the columns do not exist yet, so nothing can be recorded or asked. */
  unavailable: boolean
}

/**
 * Read acceptance off a profile row.
 *
 * `unavailable` is a THIRD state and must not collapse into "needs to accept". If the
 * columns are missing, prompting would produce a modal whose Accept button can only
 * fail - which teaches people to dismiss it. Same reasoning as the loaded/off/on
 * distinction in useExtrasSettingsState.
 */
export function acceptanceFrom(profile: Record<string, unknown> | null | undefined): AcceptanceState {
  if (!profile || !('terms_accepted_at' in profile)) {
    return { acceptedAt: null, version: null, current: false, unavailable: true }
  }
  const acceptedAt = (profile.terms_accepted_at as string | null) ?? null
  const version    = (profile.terms_version as string | null) ?? null
  return {
    acceptedAt,
    version,
    current: !!acceptedAt && version === LEGAL_VERSION,
    unavailable: false,
  }
}

/** The columns to select to read acceptance. */
export const LEGAL_SELECT = 'terms_accepted_at, terms_version, privacy_accepted_at'

/**
 * The client IP as the server sees it.
 *
 * Captured server-side because a browser cannot report its own IP honestly, and this
 * value exists to be evidence. Behind Vercel, x-forwarded-for is a comma-separated chain
 * and the FIRST entry is the client; taking the last would record a proxy.
 */
export function clientIpFrom(headers: Headers): string | null {
  const fwd = headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip') ?? headers.get('cf-connecting-ip') ?? null
}
