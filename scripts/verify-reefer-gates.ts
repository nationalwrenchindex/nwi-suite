// npx tsx scripts/verify-reefer-gates.ts
//
// READ ONLY. The Reefer Standalone gate matrix (docs/REEFER-STANDALONE-PLAN.md, 2.4).
//
// Every page and API route in src/app is read from SOURCE and its gate found: which of
// checkHDAccess / checkHDStarterAccess / checkHDReeferAccess / checkHDForemanAccess /
// reeferStandaloneCan / isReeferStandaloneUser / the LD module gates it calls, per HTTP
// handler. Each gate is then evaluated with the app's OWN pure rules (hdAccessAllowed,
// hdStarterAllowed, reeferAllowed, hdForemanAllowed, reeferStandaloneAllowed,
// subscriptionGrantsModule) against fixed subscription rows.
//
//   1. reefer_standalone: every route's answer is printed beside the EXPECTED answer,
//      written out by hand below from the brief. Any mismatch fails.
//   2. hd_elite and full_suite_plus (plus hd_reefer, hd_starter, hd_pro, comped HD):
//      the same matrix is computed from the code at git HEAD (before this work) and
//      from the working tree. Any route whose answer changed fails.
//
// What a route admits:
//   /hd/* page     = the /hd layout gate (checkHDAccess) AND the page's own gate
//   /reefer/* page = the middleware path rule (isReeferPath) AND the reefer layout
//                    (isReeferStandaloneRow) AND the gate of the HD page it re-exports
//   API            = the handler's gate; no gate at all = any signed-in account
// Gates inside one handler are OR'd (that is how every call site here combines them),
// except isReeferStandaloneUser, which is a refusal and is AND NOT.

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { hdAccessAllowed, hdStarterAllowed, reeferAllowed, hdForemanAllowed } from '../src/lib/hd-access'
import { subscriptionGrantsModule } from '../src/lib/subscription'
import {
  REEFER_STANDALONE_MODULES, reeferStandaloneAllowed, isReeferStandaloneRow, isReeferPath, canStartReeferCheckout,
} from '../src/lib/reefer-standalone'
import { HD_TIER_MODULES } from '../src/lib/hd-plans'
import { TIER_MODULES } from '../src/lib/stripe-plans'

type Row = { tier: string | null; status: string; is_comped: boolean; vertical: string; modules: string[] }

const ROWS: Record<string, Row> = {
  reefer_standalone:          { tier: 'reefer_standalone', status: 'active',   is_comped: false, vertical: 'heavy_duty', modules: [...REEFER_STANDALONE_MODULES] },
  'reefer_standalone (trial)': { tier: 'reefer_standalone', status: 'trialing', is_comped: false, vertical: 'heavy_duty', modules: [...REEFER_STANDALONE_MODULES] },
  hd_elite:                   { tier: 'hd_elite',  status: 'active',   is_comped: false, vertical: 'heavy_duty', modules: HD_TIER_MODULES.hd_elite },
  'hd_elite (trial)':         { tier: 'hd_elite',  status: 'trialing', is_comped: false, vertical: 'heavy_duty', modules: HD_TIER_MODULES.hd_elite },
  full_suite_plus:            { tier: 'full_suite_plus', status: 'active', is_comped: false, vertical: 'light_duty', modules: TIER_MODULES.full_suite_plus ?? [] },
  hd_reefer:                  { tier: 'hd_reefer', status: 'active',   is_comped: false, vertical: 'heavy_duty', modules: HD_TIER_MODULES.hd_reefer },
  hd_starter:                 { tier: 'hd_starter', status: 'active',  is_comped: false, vertical: 'heavy_duty', modules: HD_TIER_MODULES.hd_starter },
  hd_pro:                     { tier: 'hd_pro',    status: 'active',   is_comped: false, vertical: 'heavy_duty', modules: HD_TIER_MODULES.hd_pro },
  'comped HD (Kurt shape)':   { tier: 'hd_elite',  status: 'active',   is_comped: true,  vertical: 'heavy_duty', modules: HD_TIER_MODULES.hd_elite },
}

// ── Gate terms ──────────────────────────────────────────────────────────────────────
type Term = string // 'hd' | 'starter' | 'reeferHD' | 'foreman' | 'rs:<module>' | 'ld:<module>' | 'gm:<module>' | 'noReefer' | 'ownerOnly' | 'founder'

function evalTerm(t: Term, r: Row): boolean {
  const g = { tier: r.tier, status: r.status, is_comped: r.is_comped, vertical: r.vertical }
  if (t === 'hd') return hdAccessAllowed(g)
  if (t === 'starter') return hdStarterAllowed(g)
  if (t === 'reeferHD') return reeferAllowed(g)
  if (t === 'foreman') return hdForemanAllowed(g)
  if (t.startsWith('rs:')) return reeferStandaloneAllowed(r, t.slice(3))
  if (t.startsWith('ld:')) return subscriptionGrantsModule(r, t.slice(3))
  if (t.startsWith('gm:')) {
    // getModuleAccess(): live status, then the modules with hd_ stripped.
    if (!['active', 'trialing', 'past_due'].includes(r.status)) return false
    const mods = new Set<string>(); for (const m of r.modules) { mods.add(m); if (m.startsWith('hd_')) mods.add(m.slice(3)) }
    return mods.has(t.slice(3))
  }
  if (t === 'noLiveSub') return canStartReeferCheckout(r)
  if (t === 'canUseForeman') return false   // needs profiles.foreman_addon_active; none of these rows has it
  if (t === 'founder') return false         // one account by id; no subscription row is the founder
  throw new Error('unknown term ' + t)
}

function gateTerms(raw: string): Term[] {
  // Comments name gates they do not call (the pay page says it must never call checkHDAccess).
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const out: Term[] = []
  const push = (t: Term) => { if (!out.includes(t)) out.push(t) }
  if (/checkHDAccess\(/.test(src)) push('hd')
  if (/checkHDStarterAccess\(/.test(src)) push('starter')
  if (/checkHDReeferAccess\(/.test(src)) push('reeferHD')
  if (/checkHDForemanAccess\(/.test(src)) push('foreman')
  for (const m of src.matchAll(/reeferStandaloneCan\([^,]+,\s*'([a-z_]+)'\)/g)) push('rs:' + m[1])
  if (/hasQuickWrenchAccess\(/.test(src)) push('ld:quickwrench')
  if (/hasTorqueWrenchAccess\(/.test(src)) push('ld:torquewrench')
  if (/hasForemanAccess\(/.test(src)) push('ld:foreman')
  if (/canUseForeman\(/.test(src)) push('canUseForeman')
  for (const m of src.matchAll(/canAccessModule\([^,]+,\s*'([a-z_]+)'\)/g)) push('ld:' + m[1])
  if (/getModuleAccess\(/.test(src)) for (const m of src.matchAll(/\.includes\('([a-z_]+)'\)/g)) push('gm:' + m[1])
  if (/isReeferStandaloneUser\(/.test(src)) push('noReefer')
  if (/canStartReeferCheckout\(/.test(src)) push('noLiveSub')
  // A founder check refuses every subscriber, whatever else the handler calls.
  if (/user\.id\s*!==\s*FOUNDER_ID/.test(src)) return ['founder']
  return out
}

/** Does this gate set admit the row? Positive terms OR'd; noReefer is AND NOT. Empty = any signed-in user. */
function admits(terms: Term[], r: Row): boolean {
  const pos = terms.filter(t => t !== 'noReefer' && t !== 'noLiveSub')
  const ok = pos.length === 0 ? true : pos.some(t => evalTerm(t, r))
  return ok
    && !(terms.includes('noReefer') && isReeferStandaloneRow(r))
    && !(terms.includes('noLiveSub') && !canStartReeferCheckout(r))
}

// ── Reading the source (working tree or HEAD) ──────────────────────────────────────
type Reader = (file: string) => string | null
const readNow: Reader = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null
const headCache = new Map<string, string | null>()
const readHead: Reader = f => {
  if (!headCache.has(f)) {
    try { headCache.set(f, execSync(`git show HEAD:"${f.replace(/\\/g, '/')}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 })) }
    catch { headCache.set(f, null) }
  }
  return headCache.get(f)!
}

// Gates that live in a shared helper the route imports.
const HELPERS: { re: RegExp; file: string }[] = [
  { re: /from '\.\.?\/shared'|from '\.\/shared'/, file: 'src/app/api/hd/labor-cards/shared.ts' },
  { re: /from '@\/lib\/hd\/audit-route'/,        file: 'src/lib/hd/audit-route.ts' },
]

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/** Per handler, the gate terms. A route file's helpers (code outside any handler) count for every handler that has none of its own. */
function handlerGates(file: string, read: Reader): { method: string; terms: Term[] }[] | null {
  const src = read(file)
  if (src == null) return null
  const helperTerms: Term[] = []
  for (const h of HELPERS) if (h.re.test(src)) { const hs = read(h.file); if (hs) helperTerms.push(...gateTerms(hs)) }
  const starts = METHODS.map(m => ({ m, i: src.search(new RegExp(`export (async )?function ${m}\\b`)) })).filter(x => x.i >= 0).sort((a, b) => a.i - b.i)
  if (starts.length === 0) return [{ method: 'PAGE', terms: [...new Set([...gateTerms(src), ...helperTerms])] }]
  const outside = src.slice(0, starts[0].i)
  const outsideTerms = [...gateTerms(outside), ...helperTerms]
  return starts.map((s, k) => {
    const body = src.slice(s.i, k + 1 < starts.length ? starts[k + 1].i : undefined)
    const own = gateTerms(body)
    const pos = own.filter(t => t !== 'noReefer')
    const terms = pos.length ? own : [...new Set([...own, ...outsideTerms])]
    return { method: s.m, terms }
  })
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name).replace(/\\/g, '/')
    if (e.isDirectory()) walk(p, out)
    else if (/^(page\.tsx|route\.ts)$/.test(e.name)) out.push(p)
  }
  return out
}

const urlOf = (f: string) => f.replace(/^src\/app/, '').replace(/\/(page\.tsx|route\.ts)$/, '').replace(/\/\([^)]+\)/g, '') || '/'

// ── Expected answers for reefer_standalone (from the brief) ────────────────────────
const REEFER_PAGES_EXPECTED = new Set([
  'dashboard', 'scheduler', 'intel', 'financials', 'quotes', 'quotes/new', 'quotes/[id]', 'quotes/[id]/edit',
  'work-orders', 'work-orders/[id]', 'work-orders/[id]/edit', 'invoices', 'invoices/new', 'invoices/[id]', 'invoices/[id]/edit',
  'invoicing', 'quickwrench', 'quickwrench/guided', 'reefer', 'labor-cards', 'parts', 'pm-checklist', 'pm-checklist/[id]',
  'pm-schedules', 'epa-log', 'fleet-units', 'fleet-accounts', 'fleet-accounts/[id]', 'settings', 'login', 'signup',
].map(s => '/reefer/' + s))

// API routes Reefer Standalone must reach (method-level where a route mixes).
const API_ALLOWED: Record<string, string[] | 'ALL'> = {
  '/api/hd/alarm-codes': 'ALL', '/api/hd/unit-profile': 'ALL', '/api/hd/parts-reference': 'ALL', '/api/hd/parts': 'ALL',
  '/api/hd/pm-checklist': 'ALL', '/api/hd/pm-checklist/[id]/email': 'ALL', '/api/hd/pm-checklist/[id]/pdf': 'ALL',
  '/api/hd/labor-cards': 'ALL', '/api/hd/labor-cards/[id]': 'ALL', '/api/hd/repair-items': 'ALL', '/api/hd/repair-items/[id]/used': 'ALL',
  '/api/hd/quickwrench': 'ALL', '/api/hd/parts-manager': 'ALL',
  '/api/hd/work-orders': 'ALL', '/api/hd/work-orders/calendar': 'ALL', '/api/hd/work-orders/[id]': 'ALL', '/api/hd/work-orders/[id]/status': 'ALL',
  '/api/hd/work-orders/[id]/convert': 'ALL', '/api/hd/work-orders/[id]/discount': 'ALL', '/api/hd/work-orders/[id]/line-items': 'ALL',
  '/api/hd/work-orders/[id]/photos': 'ALL',
  '/api/hd/quotes': 'ALL', '/api/hd/quotes/[id]': 'ALL', '/api/hd/quotes/[id]/send': 'ALL', '/api/hd/quotes/[id]/work-order': 'ALL',
  '/api/hd/quotes/public/[token]': 'ALL', '/api/hd/quotes/public/[token]/respond': 'ALL',
  '/api/hd/invoices': 'ALL', '/api/hd/invoices/[id]': 'ALL', '/api/hd/invoices/[id]/pdf': 'ALL', '/api/hd/invoices/[id]/send': 'ALL',
  '/api/hd/invoices/[id]/token': 'ALL',
  '/api/hd/labor-suggestions': 'ALL', '/api/hd/late-fee-settings': 'ALL', '/api/hd/expenses': 'ALL',
  '/api/hd/financials/summary': 'ALL', '/api/hd/financials/equipment': 'ALL', '/api/hd/quickbooks-export': 'ALL',
  '/api/hd/export': 'ALL', '/api/hd/fleet-accounts': 'ALL', '/api/hd/fleet-units': 'ALL', '/api/hd/fleet-units/category': 'ALL',
  '/api/hd/settings': 'ALL', '/api/hd/equipment-categories': ['GET'],
  '/api/hd/checkout': 'ALL', '/api/hd/bundle-price': 'ALL', '/api/hd/feature-waitlist': 'ALL',
  // Owner-scoped PDFs: open to any signed-in account, and a reefer shop owns no such record.
  '/api/hd/dot-inspections/[id]/pdf': 'ALL', '/api/hd/aerial-inspections/[id]/pdf': 'ALL',
  // The parts counter and inventory (Oct 28): one route set for HD and Reefer Standalone.
  '/api/parts/counter': 'ALL', '/api/parts/counter/options': 'ALL', '/api/parts/stock': 'ALL',
}

// New routes that are SHARED with HD on purpose. Every other new route is reefer-only
// and must be open to no other plan; these must be open to exactly the plans the HD gate
// admits - no more (an LD plan) and no fewer (an HD plan).
const NEW_SHARED_WITH_HD = new Set([
  'GET /api/parts/counter', 'GET /api/parts/counter/options', 'GET /api/parts/stock', 'POST /api/parts/stock',
])
// API routes Reefer Standalone must NOT reach.
const API_REFUSED = new Set([
  // A LIVE reefer account has nothing to buy (canStartReeferCheckout). The route serves
  // an account with no live subscription - a new sign-up, or a lapsed one.
  '/api/reefer/checkout',
  '/api/hd/truck-diagnostic', '/api/hd/trailer-reference', '/api/hd/trailer-abs-diagnostic', '/api/hd/quickwrench/vin/[vin]',
  '/api/hd/dot-inspections', '/api/hd/aerial-inspections', '/api/hd/equipment-inspections',
  '/api/hd/reports/audit-packet', '/api/hd/reports/audit-schedule', '/api/hd/reports/labels',
  '/api/hd/cargo-watch/session', '/api/hd/cargo-watch/events',
  '/api/hd/import', '/api/hd/import/analyze', '/api/hd/import/units', '/api/hd/import/invoices', '/api/hd/import/fullbay',
])

function expectedReeferApi(url: string, method: string): boolean | null {
  const a = API_ALLOWED[url]
  if (a === 'ALL') return true
  if (Array.isArray(a)) return a.includes(method)
  if (API_REFUSED.has(url)) return false
  return null   // not a reefer question (LD, fleet-pro, admin, seed ...) - printed, not judged
}

// ── Build the matrix ───────────────────────────────────────────────────────────────
interface Line { url: string; method: string; terms: string; now: Record<string, boolean>; head: Record<string, boolean> | null }

function pageAdmits(url: string, terms: Term[], r: Row, read: Reader): boolean | null {
  if (url.startsWith('/hd/')) {
    const publicPage = url.startsWith('/hd/invoices/pay') || url.startsWith('/hd/quote/') || url === '/hd/login' || url === '/hd/signup'
    return (publicPage || hdAccessAllowed(r)) && admits(terms, r)
  }
  if (url.startsWith('/reefer/')) {
    const suffix = url.slice('/reefer'.length)
    if (!isReeferPath(suffix)) return false
    if (suffix === '/login' || suffix === '/signup') return true
    if (!isReeferStandaloneRow(r)) return false
    // the HD page it re-exports
    const src = read(`src/app${url}/page.tsx`) ?? ''
    const m = src.match(/from '@\/app\/(hd\/[^']+)\/page'/)
    if (!m) return null
    const hg = handlerGates(`src/app/${m[1]}/page.tsx`, read)
    return hg ? admits(hg[0].terms, r) : null
  }
  // LD and every other page: its own gate (LD pages carry no shared layout gate).
  return admits(terms, r)
}

function build(read: Reader, files: string[]): Map<string, { terms: Term[]; ans: Record<string, boolean | null> }> {
  const out = new Map<string, { terms: Term[]; ans: Record<string, boolean | null> }>()
  for (const f of files) {
    const hg = handlerGates(f, read)
    if (!hg) continue
    const url = urlOf(f)
    for (const { method, terms } of hg) {
      const ans: Record<string, boolean | null> = {}
      for (const [name, r] of Object.entries(ROWS)) {
        ans[name] = method === 'PAGE' ? pageAdmits(url, terms, r, read) : admits(terms, r)
      }
      out.set(`${method === 'PAGE' ? 'PAGE' : method} ${url}`, { terms, ans })
    }
  }
  return out
}

const files = walk('src/app')
  .filter(f => !/\/(seed)\//.test(f) || /parts\/seed/.test(f))
const now = build(readNow, files)
const head = build(readHead, files)

let fail = 0
const yn = (b: boolean | null | undefined) => b == null ? '  -  ' : b ? ' yes ' : ' no  '

console.log('\n=== 1. reefer_standalone: every gate, allowed vs expected ===\n')
console.log('gate'.padEnd(52), 'route gate terms'.padEnd(40), 'allowed', 'trial ', 'expected', '')
const reeferRows: string[] = []
for (const [key, { terms, ans }] of [...now].sort((a, b) => a[0].localeCompare(b[0]))) {
  const [method, url] = key.split(' ')
  let exp: boolean | null
  // Public /hd pages (sign-in, sign-up, the customer's quote and pay pages) render for
  // anyone by design; every other /hd page is closed to a reefer account.
  const HD_PUBLIC = (u: string) => u === '/hd/login' || u === '/hd/signup' || u.startsWith('/hd/quote/') || u.startsWith('/hd/invoices/pay/')
  if (method === 'PAGE') exp = url.startsWith('/reefer/') ? REEFER_PAGES_EXPECTED.has(url) : url.startsWith('/hd/') ? HD_PUBLIC(url) : null
  else exp = url.startsWith('/api/') ? expectedReeferApi(url, method) : null
  if (exp === null) continue
  const got = ans['reefer_standalone'], gotT = ans['reefer_standalone (trial)']
  const ok = got === exp && gotT === exp
  if (!ok) fail++
  reeferRows.push(`${key.padEnd(52)} ${(terms.join(' | ') || '(signed in)').padEnd(40)} ${yn(got)}  ${yn(gotT)} ${yn(exp)}   ${ok ? 'MATCH' : 'MISMATCH'}`)
}
console.log(reeferRows.join('\n'))

// In-route refusals the source scan cannot see: proved by reading the condition.
console.log('\nIn-route mode checks (read from source):')
const qw = readNow('src/app/api/hd/quickwrench/route.ts') ?? ''
const pm = readNow('src/app/api/hd/parts-manager/route.ts') ?? ''
const lc = readNow('src/app/api/hd/labor-cards/shared.ts') ?? ''
const inRoute: [string, boolean][] = [
  ['quickwrench POST mode truck/electrical refused unless the HD gate passed', /if \(!hdAccess && mode !== 'reefer'\)/.test(qw)],
  ['parts-manager POST non-TK/Carrier refused unless the HD gate passed',      pm.includes('if (!hdAccess && !/thermo|^tk\\b|carrier/i.test(manufacturer))')],
  ['reefer checkout refuses an account with a live subscription of any tier',     /if \(!canStartReeferCheckout\(existingSub\)\)/.test(readNow('src/app/api/reefer/checkout/route.ts') ?? '')],
  ['labor cards: reefer-only account limited to equipment_type reefer',         /reeferOnly: !hdAccess/.test(lc)],
]
for (const [what, ok] of inRoute) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fail++ }

console.log('\n=== 2. Every other plan: answer before this work (git HEAD) vs now ===\n')
const others = Object.keys(ROWS).filter(n => !n.startsWith('reefer_standalone'))
let compared = 0, changed = 0
for (const [key, { ans }] of now) {
  const before = head.get(key)
  if (!before) continue          // a new route (src/app/reefer, /api/reefer) - no HD/LD answer existed
  for (const n of others) {
    compared++
    if (before.ans[n] !== ans[n]) { changed++; fail++; console.log(`  CHANGED  ${key}  ${n}: ${before.ans[n]} -> ${ans[n]}`) }
  }
}
const newRoutes = [...now.keys()].filter(k => !head.has(k))
for (const k of newRoutes) {
  const a = now.get(k)!.ans
  // /reefer/login and /reefer/signup are public sign-in pages, like /hd/login.
  if (k === 'PAGE /reefer/login' || k === 'PAGE /reefer/signup') continue
  if (NEW_SHARED_WITH_HD.has(k)) {
    for (const n of others) {
      const want = evalTerm('hd', ROWS[n])
      if (a[n] !== want) { fail++; console.log(`  NEW SHARED ROUTE ${k}: ${n} ${a[n]}, expected ${want} (the HD gate)`) }
    }
    continue
  }
  for (const n of others) if (a[n]) { fail++; console.log(`  NEW ROUTE OPEN TO ${n}: ${k}`) }
}
console.log(`  ${compared} (route, plan) answers compared across ${others.length} plans: ${changed} changed.`)
console.log(`  ${newRoutes.length} new routes (/reefer, /api/reefer): open to none of the other plans except as listed above.`)

// Summary table for hd_elite and full_suite_plus, the two the brief names.
console.log('\nhd_elite / full_suite_plus, now (= before):')
const ct = (n: string) => [...now.values()].filter(v => v.ans[n]).length
console.log(`  hd_elite        allowed on ${ct('hd_elite')} of ${now.size} gates`)
console.log(`  full_suite_plus allowed on ${ct('full_suite_plus')} of ${now.size} gates`)

console.log(`\n${fail === 0 ? 'ALL MATCH' : fail + ' FAILURE(S)'}`)
if (fail) process.exit(1)
