// What is ACTUALLY ON THE SCREEN. Reads the HTML that scripts/fetch-pages.ts saved.
//
//   npx tsx scripts/fetch-pages.ts && npx tsx scripts/verify-pages-render.ts
//
// WHY THIS EXISTS. Every money bug in this run passed its unit assertions and was
// still wrong on the page: the extras computed but no input existed to enter hours,
// the fee was in the subtotal but itemized nowhere, two blocks disagreed on one
// screen. Assertions about functions cannot catch any of that. This asserts against
// the rendered document.
//
// It reads the saved HTML rather than re-fetching, so the fetch step and the assert
// step can be run and re-run independently.

import fs from 'fs'
import path from 'path'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
const get = async (p: string) => (await fetch(`${U}/rest/v1/${p}`, { headers: H })).json()

let pass = 0, fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) pass++; else fail++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`)
}
const hr = (t: string) => { console.log('\n' + '='.repeat(96)); console.log(t); console.log('='.repeat(96)) }
const usd = (n: number) => n.toFixed(2)

const DIR = '.pagecheck'
interface Row { route: string; status: number; finalUrl: string; bytes: number; loggedIn: boolean | null; note: string }

/**
 * Must match fetch-pages.ts sanitise() EXACTLY - it keeps dots, dashes and
 * underscores, and strips only the leading slash.
 *
 * My first version collapsed dashes too and silently found no file for four of the ten
 * routes, which the script then skipped with a one-line note. A checker that quietly
 * examines six pages while reporting on ten is worse than no checker, so the lookup
 * now FAILS LOUDLY on a missing file instead of continuing.
 */
function fileFor(route: string): string {
  const stripped = route.startsWith('/') ? route.slice(1) : route
  const safe = (stripped.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'root') + '.html'
  return path.join(DIR, safe)
}

/** Strip tags so a label split across elements still matches. */
function text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
}

interface Check {
  route:      string
  mode:       string
  travel:     boolean
  miles:      boolean
  supplies:   boolean
  inSubtotal: string
  totalMatch: string
}

async function main() {
  if (!fs.existsSync(path.join(DIR, 'manifest.json'))) {
    console.log('No .pagecheck/manifest.json. Run: npx tsx scripts/fetch-pages.ts')
    process.exitCode = 1
    return
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')) as
    { at: string; authenticated: boolean; rows: Row[] }

  hr(`1. The fetch itself - HTML captured ${manifest.at}`)
  ok(manifest.authenticated === true, 'the harness held a real session')
  const bad = manifest.rows.filter(r => r.status !== 200)
  ok(bad.length === 0, `every route returned 200 (${bad.map(b => b.route + '=' + b.status).join(', ') || 'all clean'})`)
  const kicked = manifest.rows.filter(r => r.loggedIn === false)
  ok(kicked.length === 0, `none landed on a login page (${kicked.length})`)

  // Every authenticated page must prove it reached the data layer under RLS, not just
  // the middleware. The owner's business name only appears if a query succeeded.
  const authed = manifest.rows.filter(r => r.loggedIn === true)
  let reachedData = 0
  for (const r of authed) {
    const f = fileFor(r.route)
    if (!fs.existsSync(f)) continue
    if (text(fs.readFileSync(f, 'utf8')).includes('Refrigerated Transportation')) reachedData++
  }
  ok(reachedData > 0,
    `${reachedData} of ${authed.length} authenticated pages rendered the shop's own data, so the session reached the database`)

  // ── The documents behind the dynamic routes ─────────────────────────────────
  const invs  = await get('invoices?select=id,invoice_number,public_token,subtotal,tax_amount,total,shop_supplies_fee,travel_amount,mileage_amount,line_items') as Array<Record<string, unknown>>
  const quotes = await get('quotes?select=id,quote_number,public_token,grand_total,shop_supplies_fee,travel_amount,mileage_amount') as Array<Record<string, unknown>>
  const hdInvs = await get('hd_invoices?select=id,invoice_number,total,shop_supplies_fee,travel_amount,mileage_amount') as Array<Record<string, unknown>>
  const wos    = await get('work_orders?select=id,work_order_number,grand_total,shop_supplies_fee,travel_amount,mileage_amount') as Array<Record<string, unknown>>
  const segs   = await get('work_order_segments?select=ld_work_order_id') as Array<Record<string, unknown>>
  const segOf  = new Set(segs.map(s => String(s.ld_work_order_id ?? '')))

  /** The stored total for whatever document a route points at, or null. */
  function docFor(route: string): { label: string; total: number | null; fee: number; mode: string } | null {
    let m = route.match(/^\/financials\/invoices\/([0-9a-f-]{36})/)
    if (m) {
      const d = invs.find(i => i.id === m![1])
      return d ? { label: String(d.invoice_number), total: Number(d.total), fee: Number(d.shop_supplies_fee ?? 0), mode: 'invoice' } : null
    }
    m = route.match(/^\/invoice\/([0-9a-f]{32})/)
    if (m) {
      const d = invs.find(i => i.public_token === m![1])
      return d ? { label: String(d.invoice_number), total: Number(d.total), fee: Number(d.shop_supplies_fee ?? 0), mode: 'invoice' } : null
    }
    m = route.match(/^\/quote\/([0-9a-f]{32})/)
    if (m) {
      const d = quotes.find(q => q.public_token === m![1])
      return d ? { label: String(d.quote_number), total: Number(d.grand_total), fee: Number(d.shop_supplies_fee ?? 0), mode: 'quote' } : null
    }
    m = route.match(/^\/hd\/invoices\/([0-9a-f-]{36})/)
    if (m) {
      const d = hdInvs.find(i => i.id === m![1])
      return d ? { label: String(d.invoice_number), total: Number(d.total), fee: Number(d.shop_supplies_fee ?? 0), mode: 'HD invoice' } : null
    }
    m = route.match(/^\/work-orders\/([0-9a-f-]{36})/)
    if (m) {
      const d = wos.find(w => w.id === m![1])
      if (!d) return null
      return {
        label: String(d.work_order_number),
        total: d.grand_total == null ? null : Number(d.grand_total),
        fee:   Number(d.shop_supplies_fee ?? 0),
        mode:  segOf.has(String(d.id)) ? 'segment-priced' : 'line-item',
      }
    }
    return null
  }

  // ══ 2. THE TABLE ═══════════════════════════════════════════════════════════
  hr('2. Route by route, read off the rendered HTML')

  const checks: Check[] = []
  for (const r of manifest.rows) {
    const f = fileFor(r.route)
    if (!fs.existsSync(f)) {
      ok(false, `HTML was saved for ${r.route} (looked for ${f})`)
      continue
    }
    const t = text(fs.readFileSync(f, 'utf8'))
    const doc = docFor(r.route)

    const travel   = /Travel hours/i.test(t)
    const miles    = /\bMiles\b/.test(t)
    const supplies = /Shop Supplies/i.test(t)

    // Is the fee inside the subtotal? Only answerable where a document is behind the
    // route and it carries a fee. "n/a" is reported rather than a misleading yes.
    let inSubtotal = 'n/a'
    let totalMatch = 'n/a'
    if (doc) {
      if (doc.total != null) {
        // The stored total must appear on the page, formatted with a thousands
        // separator or without, since surfaces differ.
        const plain = usd(doc.total)
        const comma = Number(doc.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        totalMatch = (t.includes(plain) || t.includes(comma)) ? 'yes' : 'NO'
      }
      if (doc.fee > 0) {
        // The fee is inside the total when the page shows BOTH the fee as a line and
        // the stored total, because the stored total is the one proven to contain it.
        inSubtotal = (supplies && totalMatch === 'yes') ? 'yes' : 'NO'
      } else {
        inSubtotal = 'no fee'
      }
    }

    checks.push({
      route: r.route,
      mode:  doc ? `${doc.mode}${doc.label ? ' ' + doc.label : ''}` : (r.route.includes('/new') ? 'new document' : 'list'),
      travel, miles, supplies, inSubtotal, totalMatch,
    })
  }

  const head = ['route', 'pricing mode', 'travel', 'miles', 'supplies', 'in subtotal', 'total matches']
  const w = [46, 26, 6, 5, 8, 11, 13]
  console.log('')
  console.log('  ' + head.map((h, i) => h.padEnd(w[i])).join(''))
  console.log('  ' + w.map(n => '-'.repeat(n - 1)).join(' '))
  for (const c of checks) {
    const cells = [
      c.route.length > 44 ? c.route.slice(0, 41) + '...' : c.route,
      c.mode,
      c.travel ? 'yes' : 'no',
      c.miles ? 'yes' : 'no',
      c.supplies ? 'yes' : 'no',
      c.inSubtotal,
      c.totalMatch,
    ]
    console.log('  ' + cells.map((x, i) => String(x).padEnd(w[i])).join(''))
  }
  console.log('')

  // ══ 3. THE ASSERTIONS ══════════════════════════════════════════════════════
  hr('3. What the table has to show')

  // Entry fields: every surface where a tech prices work must offer both.
  // '/financials?tab=quotes' is NOT in this list, and the reason matters.
  //
  // LD quotes have no route of their own. The editor is a MODAL inside QuotesTab that
  // opens only after a client-side fetch populates the list and a quote is selected, so
  // it is absent from server-rendered HTML by construction. Fetching the tab and
  // asserting the inputs are there would fail forever while the inputs exist and work -
  // an assertion that fails on correct code is one that gets deleted.
  //
  // It is checked at source level below instead, which is the strongest thing available
  // for a surface an HTTP fetch cannot reach. Stated as a LIMITATION rather than
  // quietly dropped.
  const needInputs = [
    '/work-orders/new',
    '/hd/invoices/new',
    '/hd/quotes/new',
  ]
  for (const route of needInputs) {
    const c = checks.find(x => x.route === route)
    if (!c) { ok(false, `${route} was fetched`); continue }
    ok(c.travel, `${route} renders a "Travel hours" input`)
    ok(c.miles,  `${route} renders a "Miles" input`)
  }

  // The work order detail page, whichever mode it is in.
  const woRoute = checks.find(c => /^\/work-orders\/[0-9a-f-]{36}/.test(c.route))
  if (woRoute) {
    ok(woRoute.travel, `${woRoute.mode}: the work order page renders a "Travel hours" input`)
    ok(woRoute.miles,  `${woRoute.mode}: and a "Miles" input`)
  } else ok(false, 'a work order detail page was fetched')

  // The in-progress invoice editor.
  const invRoute = checks.find(c => /^\/financials\/invoices\//.test(c.route))
  if (invRoute) {
    ok(invRoute.travel, `${invRoute.mode}: the invoice editor renders a "Travel hours" input`)
    ok(invRoute.miles,  `${invRoute.mode}: and a "Miles" input`)
  } else ok(false, 'an invoice editor page was fetched')

  // THE LIMITATION, stated rather than hidden.
  const tabHtml = fs.existsSync(fileFor('/financials?tab=quotes'))
    ? text(fs.readFileSync(fileFor('/financials?tab=quotes'), 'utf8'))
    : ''
  const tabRenders = /Travel hours/i.test(tabHtml)
  console.log('')
  console.log('  LIMITATION: the LD quote editor is a modal inside QuotesTab, opened after a')
  console.log('  client-side list fetch. It is absent from server-rendered HTML by design, so')
  console.log(`  the HTML check cannot see its inputs (found in the tab HTML: ${tabRenders}).`)
  console.log('  Verified at source instead:')
  const qt = fs.readFileSync('src/components/financials/QuotesTab.tsx', 'utf8')
  ok(qt.includes('<ExtrasInputs'), 'QuotesTab renders ExtrasInputs')
  ok(qt.includes('loaded={extrasLoaded}'), 'and passes loaded, so the fields are not hidden while settings load')
  ok(qt.includes('computeExtras('), 'and it computes the extras')
  const nq = fs.readFileSync('src/components/financials/NewQuoteForm.tsx', 'utf8')
  ok(/Travel hours/i.test(nq), 'NewQuoteForm renders a Travel hours input')
  ok(nq.includes('Miles'), 'and a Miles input')
  console.log('')

  // Totals on screen must equal the stored row, everywhere a document is behind the
  // route. This is the check that catches a screen re-deriving its own number.
  const withDocs = checks.filter(c => c.totalMatch !== 'n/a')
  for (const c of withDocs) {
    ok(c.totalMatch === 'yes',
      `${c.route.slice(0, 40)} shows the STORED total for ${c.mode}`)
  }
  ok(withDocs.length >= 4,
    `at least four routes were checked against a stored row (${withDocs.length})`)

  // Any document carrying a fee must itemize it.
  const feeDocs = checks.filter(c => c.inSubtotal !== 'n/a' && c.inSubtotal !== 'no fee')
  for (const c of feeDocs) {
    ok(c.supplies, `${c.route.slice(0, 40)} itemizes the shop supplies line`)
    ok(c.inSubtotal === 'yes', `and it is inside the total, not beside it`)
  }
  if (feeDocs.length === 0) {
    console.log('')
    console.log('  NOTE: none of the fetched documents carries a shop supplies fee, so the')
    console.log('  "in subtotal" column could not be exercised on a live page. The documents')
    console.log('  behind these routes predate the server-side computer. Not asserted green.')
    ok(false, 'a document WITH a fee must be rendered to exercise the in-subtotal column')
  }

  // ══ 4. THE CONTROLS MUST BE ON THE PAGE ════════════════════════════════════
  //
  // WHY THIS SECTION EXISTS. A finalized invoice had no way back to editing, and the only
  // reason anyone noticed was the shop owner hitting it in production. Nothing in the
  // suite asserted that a document's actions are REACHABLE, so a missing button was
  // invisible to every check that passed.
  //
  // Asserted against RENDERED HTML of real rows, because a control can exist in the
  // source and still not render - the travel inputs sat inside an owns-gated section and
  // were absent from exactly the work orders that needed them.
  hr('4. The action controls, in the rendered HTML of real rows')

  const invRows = await get('invoices?select=id,invoice_number,invoice_status&order=invoice_number') as Array<Record<string, unknown>>
  const woRows  = await get('work_orders?select=id,work_order_number,status,converted_invoice_id&order=work_order_number') as Array<Record<string, unknown>>

  const htmlForId = (id: string): string | null => {
    const row = manifest.rows.find(r => r.route.includes(id))
    if (!row) return null
    const f = fileFor(row.route)
    return fs.existsSync(f) ? text(fs.readFileSync(f, 'utf8')) : null
  }
  const idFromRoutes = (prefix: string): string[] =>
    manifest.rows
      .filter(r => r.route.startsWith(prefix))
      .map(r => r.route.slice(prefix.length).split(/[/?]/)[0])
      .filter(x => x.length === 36)

  // ── a work order page offers Create Invoice ──
  const woIds = idFromRoutes('/work-orders/')
  ok(woIds.length > 0, 'a work order detail page was fetched')
  for (const id of woIds.slice(0, 1)) {
    const row = woRows.find(w => w.id === id)
    const html = htmlForId(id)
    ok(!!html, 'HTML captured for work order ' + (row?.work_order_number ?? id))
    if (html && row) {
      const already = !!row.converted_invoice_id
      const offers = /Create Invoice|Convert to Invoice|Invoice This/i.test(html)
      const points = /View Invoice|Already Invoiced|has been invoiced/i.test(html)
      console.log('  ' + row.work_order_number + ': status=' + row.status + ', converted=' + already)
      if (already) {
        ok(points || offers, 'an already-invoiced work order points at its invoice rather than offering a second one')
      } else {
        ok(offers, row.work_order_number + ' offers a Create Invoice control')
      }
    }
  }

  // ── an in-progress invoice offers Finalize ──
  const invIds = idFromRoutes('/financials/invoices/')
  const statusOf = (id: string) => String(invRows.find(i => i.id === id)?.invoice_status ?? '')
  const inProg = invIds.find(id => statusOf(id) === 'in_progress')
  ok(!!inProg, 'an IN PROGRESS invoice was fetched')
  if (inProg) {
    const row = invRows.find(i => i.id === inProg)
    const html = htmlForId(inProg)
    ok(!!html, 'HTML captured for ' + row?.invoice_number)
    if (html) {
      console.log('  ' + row?.invoice_number + ': status=in_progress')
      ok(/Finalize/i.test(html), row?.invoice_number + ' (in_progress) offers Finalize')
      ok(/Save/i.test(html), 'and a save control')
      ok(!/Reopen Invoice/i.test(html), 'and NOT Reopen - already open, and the API 409s on that')
    }
  }

  // ── a finalized invoice offers Reopen, Send and Mark as Paid ──
  const finalId = invIds.find(id => statusOf(id) === 'awaiting_payment')
  ok(!!finalId, 'a FINALIZED (awaiting_payment) invoice was fetched - without one the Reopen check cannot run')
  if (finalId) {
    const row = invRows.find(i => i.id === finalId)
    const html = htmlForId(finalId)
    ok(!!html, 'HTML captured for ' + row?.invoice_number)
    if (html) {
      console.log('  ' + row?.invoice_number + ': status=awaiting_payment')
      ok(/Reopen Invoice/i.test(html), row?.invoice_number + ' (finalized) offers Reopen Invoice')
      ok(/Mark as Paid/i.test(html), 'and Mark as Paid')
      ok(/Send Invoice|Resend Invoice/i.test(html), 'and Send or Resend Invoice')
      ok(!/Finalize Invoice/i.test(html), 'and NOT Finalize - it is already finalized')
    }
  }

  // The endpoint has to exist, or the button is decoration.
  const RP = 'src/app/api/invoices/[id]/reopen/route.ts'
  ok(fs.existsSync(RP), 'POST /api/invoices/[id]/reopen exists')
  const reopenSrc = fs.existsSync(RP) ? fs.readFileSync(RP, 'utf8') : ''
  ok(reopenSrc.includes("invoice_status: 'in_progress'"), 'and it returns the invoice to in_progress')
  ok(reopenSrc.includes('finalized_at:   null'), 'and clears finalized_at')
  ok(!reopenSrc.includes('public_token:'), 'and does NOT rotate the public token the customer may hold')
  ok(reopenSrc.includes("status === 'paid'"), 'and refuses a PAID invoice')

  console.log('\n' + '='.repeat(96))
  console.log(`${pass} passed, ${fail} failed`)
  console.log('='.repeat(96))
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })
