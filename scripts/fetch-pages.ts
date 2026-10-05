// Fetch rendered HTML for a list of app routes, authenticated as the real shop
// owner, so another script can assert against what the app ACTUALLY sends to a
// browser.
//
// The point of fetching over HTTP instead of importing the page components is
// that a page is not its component: it is the component plus the middleware,
// the layout chain, the server-side data fetch and the RLS policy that the real
// session carries. A test that renders the component in isolation passes while
// the real page redirects to /login, and that is exactly the class of bug this
// is meant to catch.
//
//   npx tsx scripts/fetch-pages.ts                      # DEFAULT_ROUTES
//   npx tsx scripts/fetch-pages.ts /financials /work-orders/new
//
// Output: .pagecheck/<sanitised-route>.html plus .pagecheck/manifest.json
// Exit code: 0 only if every route returned 200, none landed on a login page,
// and nothing was skipped.

import fs from 'fs'
import net from 'net'
import path from 'path'
import { spawn, spawnSync, type ChildProcess } from 'child_process'

// -- env ---------------------------------------------------------------------
// Same parsing idiom as scripts/verify-tax.ts: .env.local is the source of
// truth and is read directly, because tsx does not load it for us.
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env.local',
  )
  process.exit(1)
}

// profiles.business_name 'Refrigerated Transportation Service and Repair'
const OWNER_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'
const OUT_DIR = '.pagecheck'
const SERVICE_H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }

// Routes that need no session. Everything else is treated as authenticated, so
// a failure to get a session is reported rather than silently passing.
const PUBLIC_PREFIXES = ['/invoice/', '/quote/']
const isPublicRoute = (r: string) => PUBLIC_PREFIXES.some((p) => r.startsWith(p))

// -- rest helpers ------------------------------------------------------------
async function rest<T>(query: string): Promise<T[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, { headers: SERVICE_H })
  const t = await r.text()
  if (r.status !== 200) throw new Error(`${r.status} ${query} :: ${t.slice(0, 300)}`)
  return JSON.parse(t) as T[]
}

/** Most recent row for the owner, or null. */
async function newest(
  table: string,
  select: string,
  extraFilter = '',
): Promise<Record<string, unknown> | null> {
  const rows = await rest<Record<string, unknown>>(
    `${table}?select=${select}&user_id=eq.${OWNER_ID}${extraFilter}&order=created_at.desc&limit=1`,
  )
  return rows[0] ?? null
}

// -- auth: a real session for the owner, no password needed ------------------
// The service role key can mint a magic link for any user; the hashed_token in
// that response exchanges for a full session at /auth/v1/verify. Nothing here
// guesses or stores a password.
type Session = {
  access_token: string
  token_type: string
  expires_in: number
  expires_at: number
  refresh_token: string
  user: { id: string; email?: string }
}

async function ownerEmail(): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: SERVICE_H })
  if (!r.ok) throw new Error(`admin/users ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const body = (await r.json()) as { users?: { id: string; email: string }[] }
  const users = body.users ?? (body as unknown as { id: string; email: string }[])
  const hit = users.find((u) => u.id === OWNER_ID)
  if (!hit?.email) throw new Error(`no auth user with id ${OWNER_ID}`)
  return hit.email
}

async function getSession(): Promise<Session> {
  const email = await ownerEmail()

  const gen = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { ...SERVICE_H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  })
  if (!gen.ok) throw new Error(`generate_link ${gen.status}: ${(await gen.text()).slice(0, 300)}`)
  const link = (await gen.json()) as {
    hashed_token?: string
    properties?: { hashed_token?: string }
  }
  const tokenHash = link.hashed_token ?? link.properties?.hashed_token
  if (!tokenHash) throw new Error('generate_link returned no hashed_token')

  // Exchanged with the ANON key on purpose: /auth/v1/verify is the public
  // endpoint a browser would hit, so the session it returns is an ordinary user
  // session and carries no service-role authority into the app.
  const ver = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
  })
  if (!ver.ok) throw new Error(`verify ${ver.status}: ${(await ver.text()).slice(0, 300)}`)
  const session = (await ver.json()) as Session
  if (!session.access_token || !session.refresh_token) throw new Error('verify returned no tokens')
  if (session.user?.id !== OWNER_ID) {
    throw new Error(`session is for ${session.user?.id}, expected ${OWNER_ID}`)
  }
  return session
}

// -- the auth cookie, exactly as @supabase/ssr writes it ---------------------
// Derived from the installed package rather than assumed:
//   * name      sb-<project-ref>-auth-token
//               supabase-js: `sb-${new URL(authUrl).hostname.split('.')[0]}-auth-token`
//   * value     'base64-' + unpadded base64url of the session JSON.
//               @supabase/ssr defaults cookieEncoding to 'base64url' and its
//               server storage getItem strips that same 'base64-' prefix.
//               Its encoder emits the URL-safe alphabet with no padding, which
//               is what Buffer's 'base64url' produces.
//   * chunking  utils/chunker.ts splits on encodeURIComponent length at
//               MAX_CHUNK_SIZE = 3180 into `<name>.0`, `<name>.1`, ...
//               The session JSON exceeds that, so getting this wrong means the
//               app reads a truncated cookie and sees no session at all.
const MAX_CHUNK_SIZE = 3180

function storageKey(): string {
  return `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`
}

/** Faithful port of @supabase/ssr utils/chunker.ts createChunks. */
function createChunks(key: string, value: string): { name: string; value: string }[] {
  let encoded = encodeURIComponent(value)
  if (encoded.length <= MAX_CHUNK_SIZE) return [{ name: key, value }]

  const chunks: string[] = []
  while (encoded.length > 0) {
    let head = encoded.slice(0, MAX_CHUNK_SIZE)
    const lastEscape = head.lastIndexOf('%')
    if (lastEscape > MAX_CHUNK_SIZE - 3) head = head.slice(0, lastEscape)
    let valueHead = ''
    while (head.length > 0) {
      try {
        valueHead = decodeURIComponent(head)
        break
      } catch (err) {
        if (err instanceof URIError && head.at(-3) === '%' && head.length > 3) {
          head = head.slice(0, head.length - 3)
        } else throw err
      }
    }
    chunks.push(valueHead)
    encoded = encoded.slice(head.length)
  }
  return chunks.map((v, i) => ({ name: `${key}.${i}`, value: v }))
}

function authCookieHeader(session: Session): string {
  const encoded = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')
  return createChunks(storageKey(), encoded)
    .map(({ name, value }) => `${name}=${encodeURIComponent(value)}`)
    .join('; ')
}

// -- dynamic routes ----------------------------------------------------------
// Resolved against the live database so the script does not rot the moment a
// hardcoded id is deleted. Each resolver returns null when there is no row and
// the route is then reported as skipped rather than fetched against a made-up
// id -- a 404 from a fake id looks identical to a broken page.
type Resolved = { route: string | null; why: string }

async function dynamicRoutes(): Promise<Resolved[]> {
  const out: Resolved[] = []

  const wo = await newest('work_orders', 'id,work_order_number')
  out.push(
    wo
      ? { route: `/work-orders/${wo.id}`, why: `work order ${wo.work_order_number}` }
      : { route: null, why: '/work-orders/<id>: no work_orders row for owner' },
  )

  // invoice_status in_progress preferred, because that is the editable state;
  // a finalized invoice renders a different, read-only page.
  let inv = await newest(
    'invoices',
    'id,invoice_number,invoice_status',
    '&invoice_status=eq.in_progress',
  )
  let invWhy = 'invoice_status=in_progress'
  if (!inv) {
    inv = await newest('invoices', 'id,invoice_number,invoice_status')
    invWhy = `no in_progress invoice, fell back to invoice_status=${inv?.invoice_status}`
  }
  out.push(
    inv
      ? { route: `/financials/invoices/${inv.id}`, why: `${inv.invoice_number} (${invWhy})` }
      : { route: null, why: '/financials/invoices/<id>: no invoices row for owner' },
  )

  const hd = await newest('hd_invoices', 'id,invoice_number')
  const feeInv = (await rest<{ id: string; invoice_number: string; public_token: string | null }>('invoices?select=id,invoice_number,public_token&shop_supplies_fee=gt.0&order=invoice_number.desc&limit=1'))[0]
  out.push(
    hd
      ? { route: `/hd/invoices/${hd.id}`, why: `hd invoice ${hd.invoice_number}` }
      : { route: null, why: '/hd/invoices/<id>: no hd_invoices row for owner' },
    // The HD EDIT form lives at /hd/invoices/<id>/edit. The detail page does not
    // render EditInvoiceForm, so checking only the detail page would have reported
    // "no travel input" about a page that was never supposed to have one.
    hd?.id
      ? { route: `/hd/invoices/${hd.id}/edit`, why: `hd invoice edit ${hd.invoice_number}` }
      : { route: null, why: '/hd/invoices/<id>/edit: no hd_invoices row for owner' },
    // An invoice that CARRIES a shop supplies fee. Without one, the in-subtotal
    // column can only ever report "no fee" and the check proves nothing.
    feeInv?.id
      ? { route: `/financials/invoices/${feeInv.id}`, why: `invoice with a fee ${feeInv.invoice_number}` }
      : { route: null, why: '/financials/invoices/<id>: no invoice with shop_supplies_fee > 0' },
    feeInv?.public_token
      ? { route: `/invoice/${feeInv.public_token}`, why: `customer copy with a fee ${feeInv.invoice_number}` }
      : { route: null, why: '/invoice/<token>: no fee-carrying invoice with a token' },
  )

  const invTok = await newest('invoices', 'public_token,invoice_number', '&public_token=not.is.null')
  out.push(
    invTok
      ? { route: `/invoice/${invTok.public_token}`, why: `public token of ${invTok.invoice_number}` }
      : { route: null, why: '/invoice/<token>: no invoices row with a public_token' },
  )

  const qTok = await newest('quotes', 'public_token,quote_number', '&public_token=not.is.null')
  out.push(
    qTok
      ? { route: `/quote/${qTok.public_token}`, why: `public token of ${qTok.quote_number}` }
      : { route: null, why: '/quote/<token>: no quotes row with a public_token' },
  )

  return out
}

const DEFAULT_ROUTES = [
  '/work-orders/new',
  '/financials',
  // LD quotes have NO route of their own - they live in a tab inside /financials
  // (components/financials/QuotesTab.tsx). '/quotes' is a genuine 404, so the tab URL
  // is what actually renders the quote editor.
  '/financials?tab=quotes',
  '/hd/invoices/new',
  '/hd/quotes/new',
]

// -- dev server --------------------------------------------------------------
function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port })
    const done = (v: boolean) => {
      sock.destroy()
      resolve(v)
    }
    sock.setTimeout(1500)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

async function respondsOverHttp(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' })
    return r.status > 0
  } catch {
    return false
  }
}

async function freePort(from = 3100): Promise<number> {
  for (let p = from; p < from + 60; p++) if (!(await portOpen(p))) return p
  throw new Error('no free port found in range')
}

async function waitReady(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await respondsOverHttp(port)) return true
    await new Promise((r) => setTimeout(r, 2000))
  }
  return false
}

type Server = { port: number; child: ChildProcess | null }

async function ensureServer(): Promise<Server> {
  if ((await portOpen(3000)) && (await respondsOverHttp(3000))) {
    console.log('Reusing the dev server already answering on http://localhost:3000')
    return { port: 3000, child: null }
  }
  const port = await freePort()
  console.log(`Starting next dev on port ${port} (this can take 30-60s)...`)
  const child = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['next', 'dev', '-p', String(port)],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    },
  )
  const echo = (tag: string) => (d: Buffer) => {
    const s = String(d).trim()
    if (s) console.log(`  [${tag}] ${s.split('\n')[0]}`)
  }
  child.stdout?.on('data', echo('next'))
  child.stderr?.on('data', echo('next:err'))

  if (!(await waitReady(port, 240_000))) {
    stopServer({ port, child })
    throw new Error(`next dev on port ${port} never answered within 240s`)
  }
  console.log(`Dev server ready on http://localhost:${port}`)
  return { port, child }
}

/**
 * Kill whatever is still LISTENING on a port (Windows).
 *
 * This exists because killing the spawned pid tree is not enough here. We spawn
 * through npx.cmd, so the real chain is cmd.exe -> npx -> `next dev` -> the
 * next-server child that actually binds the port. The intermediate cmd.exe has
 * usually exited by the time we clean up, which severs the tree and leaves
 * taskkill /T nothing to walk -- the first version of this script leaked a
 * next-server holding port 3100 after it claimed to have shut down. The port is
 * the only handle that stays true, so it is what we hunt on.
 */
function killByPort(port: number) {
  if (process.platform !== 'win32') return
  const res = spawnSync('netstat', ['-ano'], { encoding: 'utf8' })
  const pids = new Set<string>()
  for (const line of (res.stdout || '').split('\n')) {
    if (!line.includes('LISTENING')) continue
    // Match :<port> only at the end of the local-address field, so port 3100
    // does not also match 31000 or a remote address.
    if (!new RegExp(`:${port}\\s`).test(line)) continue
    const pid = line.trim().split(/\s+/).pop()
    if (pid && pid !== '0') pids.add(pid)
  }
  for (const pid of pids) {
    spawnSync('taskkill', ['/pid', pid, '/T', '/F'], { stdio: 'ignore' })
  }
}

function stopServer(s: Server) {
  if (!s.child?.pid) return
  console.log('\nShutting down the dev server this script started...')
  try {
    if (process.platform === 'win32') {
      // Both, in this order: the tree for the shell wrapper and anything it
      // still owns, then the port for the next-server that outlived it.
      spawnSync('taskkill', ['/pid', String(s.child.pid), '/T', '/F'], { stdio: 'ignore' })
      killByPort(s.port)
    } else {
      s.child.kill('SIGTERM')
    }
  } catch {
    try {
      s.child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

// -- fetching ----------------------------------------------------------------
const sanitise = (route: string) =>
  (route.replace(/^\//, '').replace(/[^a-zA-Z0-9._-]+/g, '_') || 'root') + '.html'

const LOGIN_RE = /^\/(hd\/)?(login|signup)$/

type Row = {
  route: string
  status: number | string
  finalUrl: string
  bytes: number
  loggedIn: boolean | null
  note: string
}

async function fetchRoute(base: string, route: string, cookie: string | null): Promise<Row> {
  const headers: Record<string, string> = {
    // A real browser Accept header: Next serves an RSC payload instead of HTML
    // to anything that looks like a client-router fetch.
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'User-Agent': 'nwi-fetch-pages/1.0',
  }
  if (cookie) headers.Cookie = cookie

  try {
    const r = await fetch(base + route, { headers, redirect: 'follow' })
    const html = await r.text()
    const landedOnLogin = LOGIN_RE.test(new URL(r.url).pathname)
    fs.writeFileSync(path.join(OUT_DIR, sanitise(route)), html, 'utf8')
    return {
      route,
      status: r.status,
      finalUrl: r.url,
      bytes: Buffer.byteLength(html, 'utf8'),
      loggedIn: cookie ? !landedOnLogin : null,
      note: landedOnLogin ? 'REDIRECTED TO LOGIN' : '',
    }
  } catch (err) {
    return {
      route,
      status: 'ERR',
      finalUrl: base + route,
      bytes: 0,
      loggedIn: null,
      note: err instanceof Error ? err.message.slice(0, 70) : String(err),
    }
  }
}

// -- housekeeping ------------------------------------------------------------
function ensureGitignored() {
  const entry = '.pagecheck/'
  let body = ''
  try {
    body = fs.readFileSync('.gitignore', 'utf8')
  } catch {
    /* no .gitignore yet */
  }
  if (body.split('\n').some((l) => l.trim() === entry || l.trim() === '.pagecheck')) return
  fs.appendFileSync('.gitignore', `${body === '' || body.endsWith('\n') ? '' : '\n'}${entry}\n`)
  console.log(`Added ${entry} to .gitignore`)
}

function table(rows: Row[]) {
  const head = ['ROUTE', 'STATUS', 'BYTES', 'IN', 'FINAL URL / NOTE']
  const body = rows.map((r) => [
    r.route.length > 48 ? r.route.slice(0, 45) + '...' : r.route,
    String(r.status),
    r.bytes ? String(r.bytes) : '-',
    r.loggedIn === null ? 'n/a' : r.loggedIn ? 'yes' : 'NO',
    r.note || r.finalUrl.replace(/^https?:\/\/(127\.0\.0\.1|localhost):\d+/, ''),
  ])
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)))
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(w[i])).join('  ').trimEnd()
  console.log('\n' + line(head))
  console.log(w.map((n) => '-'.repeat(n)).join('  '))
  for (const b of body) console.log(line(b))
}

// -- main --------------------------------------------------------------------
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  ensureGitignored()

  const argvRoutes = process.argv.slice(2).filter((a) => a.startsWith('/'))
  const skipped: { route: string; why: string }[] = []

  let routes: string[]
  if (argvRoutes.length) {
    routes = argvRoutes
    console.log(`Routes from argv (${routes.length}).`)
  } else {
    routes = [...DEFAULT_ROUTES]
    console.log('Resolving dynamic routes against the live database...')
    for (const d of await dynamicRoutes()) {
      if (d.route) {
        routes.push(d.route)
        console.log(`  ${d.route}  <- ${d.why}`)
      } else {
        skipped.push({ route: '(dynamic)', why: d.why })
        console.log(`  SKIP  ${d.why}`)
      }
    }
  }

  // The session is obtained before the server starts, so a credentials problem
  // fails fast instead of after a 60s dev-server boot.
  let cookie: string | null = null
  let authError = ''
  try {
    const session = await getSession()
    cookie = authCookieHeader(session)
    const n = cookie.split('; ').length
    console.log(
      `\nSession for ${session.user.email} (${session.user.id}) via admin generate_link + /auth/v1/verify.`,
    )
    console.log(`Cookie ${storageKey()} in ${n} chunk${n === 1 ? '' : 's'}.`)
  } catch (err) {
    authError = err instanceof Error ? err.message : String(err)
    console.error(`\nAUTH FAILED: ${authError}`)
    console.error('Authenticated routes will be SKIPPED. Public routes still run.')
  }

  const runnable = cookie ? routes : routes.filter(isPublicRoute)
  if (!cookie) {
    for (const r of routes.filter((r) => !isPublicRoute(r))) {
      skipped.push({ route: r, why: `no session: ${authError}` })
    }
  }

  const server = await ensureServer()
  const base = `http://127.0.0.1:${server.port}`
  const rows: Row[] = []
  try {
    for (const route of runnable) {
      rows.push(await fetchRoute(base, route, isPublicRoute(route) ? null : cookie))
    }
  } finally {
    stopServer(server)
  }

  table(rows)
  if (skipped.length) {
    console.log('\nSKIPPED:')
    for (const s of skipped) console.log(`  ${s.route}  ${s.why}`)
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify(
      { at: new Date().toISOString(), base, authenticated: !!cookie, authError, rows, skipped },
      null,
      2,
    ),
  )
  console.log(`\nHTML written to ${OUT_DIR}/ (manifest.json lists every route).`)

  const bad = rows.filter((r) => r.status !== 200 || r.loggedIn === false)
  if (bad.length) {
    console.log(`\nFAIL: ${bad.length} route(s) were not a clean logged-in 200:`)
    for (const b of bad) console.log(`  ${b.route}  status=${b.status}  ${b.note}`)
  }
  if (!cookie) console.log('\nFAIL: no session, so the authenticated routes never ran.')
  process.exit(bad.length || !cookie || skipped.length ? 1 : 0)
}

main().catch((err) => {
  console.error('\nfetch-pages failed:', err)
  process.exit(1)
})
