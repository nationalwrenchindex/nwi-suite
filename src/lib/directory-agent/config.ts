// Shared constants + helpers for the directory auto-population agent.
//
// The agent finds mobile mechanics on Google Places, texts them a permission
// invite, and — on a YES reply — creates their Brilliant Directories listing
// automatically. Routes live under /api/directory-agent/*.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Brock's account. Matches the gate used by /admin and /admin/foreman.
export const FOUNDER_ID  = '4a8c046f-7db3-42bb-8422-fd47efb7678c'
export const ADMIN_EMAIL = 'brock@nationalwrenchindex.com'

// Cities the weekly search cron sweeps, in order, when no body is supplied.
export const DEFAULT_SEARCH_CITIES: ReadonlyArray<{ city: string; state: string }> = [
  { city: 'Winston-Salem', state: 'NC' },
  { city: 'Greensboro',    state: 'NC' },
  { city: 'Charlotte',     state: 'NC' },
  { city: 'Raleigh',       state: 'NC' },
  { city: 'Durham',        state: 'NC' },
]

export const DEFAULT_RADIUS_METERS = 50000

// LD outreach 10DLC number. Every LD directory SMS — invite, follow-up, reply
// confirmation — sends From this number. Override per environment in Vercel.
export const LD_FROM_NUMBER = () => process.env.DIRECTORY_AGENT_FROM_NUMBER ?? '+13367294181'

// Minimum Google rating to invite. Unrated businesses are excluded — we can't
// vouch for them, and the directory's value is that every listing is credible.
export const MIN_RATING = 4.0

// One invite batch per day (see vercel.json cron 2).
export const INVITE_BATCH_SIZE = 25

// Follow-up only after this many days of silence, and only once per prospect.
export const FOLLOW_UP_AFTER_DAYS = 3

// ─── Message copy ────────────────────────────────────────────────────────────

export function inviteMessage(businessName: string): string {
  return (
    `Hey ${businessName} — this is Brock with National Wrench Index. ` +
    `I found your mobile mechanic business on Google and wanted to invite you to a free directory listing at nationalwrenchindex.com. ` +
    `No commissions. No middlemen. Customers contact you directly. ` +
    `Reply YES to get listed free or STOP to opt out.`
  )
}

export function followUpMessage(businessName: string): string {
  return (
    `Hey ${businessName} — Brock again from National Wrench Index. ` +
    `Just wanted to follow up on the free directory listing offer. ` +
    `Reply YES to get listed or STOP if not interested. No pressure either way.`
  )
}

export const LISTED_MESSAGE =
  'You are listed on National Wrench Index. Find your profile here: nationalwrenchindex.com — ' +
  'Search your business name to find it. Log in anytime to add photos, services, and updates. ' +
  'Welcome to the directory. — Brock'

// Condensed variant sent when the YES arrives on the shared TorqueWrench inbound
// number. Same event, shorter copy — one SMS segment instead of two.
export const LISTED_MESSAGE_SHORT =
  'You are listed on National Wrench Index. Search your business name at nationalwrenchindex.com ' +
  'to find your profile. Welcome to the directory. — Brock'

export const OPTOUT_MESSAGE =
  'You have been removed from our list and will not be contacted again. — National Wrench Index'

export const FALLBACK_MESSAGE =
  'Reply YES to get your free National Wrench Index listing or STOP to opt out.'

// ─── Phone normalization ─────────────────────────────────────────────────────

// Returns E.164 (+1XXXXXXXXXX) for a valid US number, else null. Rejects the
// obvious non-US / short-code / invalid-NANP cases so we never text garbage.
export function normalizeUsPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  const ten =
    digits.length === 10 ? digits :
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) :
    null
  if (!ten) return null
  // NANP: area code and exchange both start 2-9.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null
  return `+1${ten}`
}

export function formatPhone(phone: string | null): string {
  if (!phone) return '—'
  const d = phone.replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  if (ten.length !== 10) return phone
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
}

// ─── Route authorization ─────────────────────────────────────────────────────

// The search / invite / follow-up routes are driven from two places: Vercel
// cron (shared secret, same convention as /api/cron/late-fees) and the admin
// dashboard's manual buttons (founder session). Either is sufficient.
export async function authorizeAgentRequest(
  request: NextRequest,
): Promise<NextResponse | null> {
  const expected = process.env.CRON_SECRET
  const incoming =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace('Bearer ', '')

  if (expected && incoming === expected) return null

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user && (user.id === FOUNDER_ID || user.email?.toLowerCase() === ADMIN_EMAIL)) {
    return null
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
