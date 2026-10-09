// A real logged-in session against a DEPLOYED origin, for the smoke suite.
//
// Factored out because this is the fourth place that needs it. The chain and the cookie
// encoding were worked out against node_modules rather than guessed, and getting any
// part of it subtly wrong reads as "not logged in" rather than as an error:
//
//   1. admin /auth/v1/admin/users         find the owner's email from their id
//   2. admin /auth/v1/admin/generate_link a magiclink, returning hashed_token
//   3. anon  /auth/v1/verify              exchange it for a real session
//   4. cookie sb-<ref>-auth-token         'base64-' + base64url(JSON), CHUNKED at 3180
//
// Step 3 uses the ANON key on purpose: the session then carries no service-role
// authority into the application, so a smoke run cannot do anything the shop owner
// could not do themselves.
//
// THE CHUNKING IS NOT OPTIONAL. @supabase/ssr splits at 3180 bytes of
// encodeURIComponent length into <name>.0, <name>.1; a real session needs two chunks,
// and one oversized cookie is read as no session at all.

import fs from 'fs'

export interface Session {
  cookie: string
  email:  string
  userId: string
  /** The raw user JWT. Needed to talk to PostgREST AS THIS USER, which is the only way
   *  to observe what RLS actually allows - the service role bypasses it entirely. */
  accessToken: string
}

/** Load .env.local the way every script here does. */
export function loadEnv(): void {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
}

function chunkCookie(name: string, value: string): string[] {
  const MAX = 3180
  if (encodeURIComponent(value).length <= MAX) return [`${name}=${encodeURIComponent(value)}`]
  const out: string[] = []
  let i = 0, part = 0
  while (i < value.length) {
    let end = Math.min(i + MAX, value.length)
    let piece = value.slice(i, end)
    // Shrink until the ENCODED length fits; a multi-byte character can straddle.
    while (encodeURIComponent(piece).length > MAX && end > i + 1) {
      end -= 1
      piece = value.slice(i, end)
    }
    out.push(`${name}.${part}=${encodeURIComponent(piece)}`)
    i = end
    part += 1
  }
  return out
}

export async function openSession(ownerId: string): Promise<Session> {
  const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL
  const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPA || !ANON || !SVC) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY')
  }
  const svcH = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }

  const usersRes = await fetch(`${SUPA}/auth/v1/admin/users?per_page=200`, { headers: svcH })
  const usersJson = await usersRes.json()
  const users = Array.isArray(usersJson) ? usersJson : usersJson.users ?? []
  const owner = users.find((u: { id?: string }) => u.id === ownerId)
  if (!owner?.email) throw new Error(`no auth user for owner id ${ownerId}`)

  const genRes = await fetch(`${SUPA}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: svcH,
    body: JSON.stringify({ type: 'magiclink', email: owner.email }),
  })
  const gen = await genRes.json()
  const hashed = gen.hashed_token ?? gen.properties?.hashed_token
  if (!hashed) throw new Error(`generate_link returned no hashed_token: ${JSON.stringify(gen).slice(0, 160)}`)

  const verRes = await fetch(`${SUPA}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: hashed }),
  })
  const ver = await verRes.json()
  if (!ver.access_token) throw new Error(`verify returned no session: ${JSON.stringify(ver).slice(0, 160)}`)
  if (ver.user?.id !== ownerId) throw new Error('the session is not the expected owner')

  const name  = `sb-${new URL(SUPA).hostname.split('.')[0]}-auth-token`
  const value = 'base64-' + Buffer.from(JSON.stringify(ver)).toString('base64url')

  return {
    cookie:      chunkCookie(name, value).join('; '),
    email:       owner.email,
    userId:      ownerId,
    accessToken: ver.access_token as string,
  }
}

/** Strip tags so a label split across elements still matches. */
export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
}
