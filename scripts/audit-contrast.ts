// npx tsx scripts/audit-contrast.ts [base] [out.json]
//
// WCAG AA contrast, measured in a real browser, on every HD screen in BOTH themes.
// For each visible text node and each input/select/textarea value: the computed text
// colour against the effective background (alpha-composited up the ancestors), and the
// AA threshold (3.0 for large text, 4.5 otherwise). Smoke cannot do this - it reads
// HTML, and the Tax % inputs that rendered white on white WERE in the HTML.
//
// Needs Chrome and puppeteer-core, which is deliberately not a project dependency:
//   npm i --no-save puppeteer-core
// Fixtures are SMOKE copies (service REST) of a real quote and invoice, with public
// tokens and recorded terms, deleted in finally. Real rows are only READ.
import { createRequire } from 'module'
import fs from 'fs'
import { loadEnv, openSession } from './lib/smoke-session'
const req = createRequire(import.meta.url)
let puppeteer: any
try { puppeteer = req('puppeteer-core') } catch {
  console.error('puppeteer-core is not installed. Run: npm i --no-save puppeteer-core'); process.exit(2)
}

const BASE = process.argv[2] ?? 'http://localhost:3000'
const OUT = process.argv[3] ?? 'audit-contrast.json'
const OWNER = '4a8c046f-7db3-42bb-8422-fd47efb7678c'
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'

async function main() {
  loadEnv()
  const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' }
  const get = async (p: string) => (await fetch(`${S}/rest/v1/${p}`, { headers: H })).json() as Promise<any[]>
  const ins = async (t: string, row: any) => {
    const r = await fetch(`${S}/rest/v1/${t}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row) })
    const j = await r.json(); if (!Array.isArray(j)) throw new Error(`${t} insert: ${JSON.stringify(j).slice(0, 200)}`); return j[0]
  }
  const del = (t: string, id: string) => fetch(`${S}/rest/v1/${t}?id=eq.${id}`, { method: 'DELETE', headers: H })
  const tok = () => Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
  const strip = (r: any, keys: string[]) => { const o = { ...r }; for (const k of keys) delete o[k]; return o }
  const DROP = ['id', 'created_at', 'updated_at', 'customer_id', 'fleet_account_id', 'unit_id', 'work_order_id', 'quote_id']

  const realQ = (await get(`hd_quotes?user_id=eq.${OWNER}&status=eq.approved&tax_breakdown=not.is.null&select=*&order=created_at.desc&limit=1`))[0]
  const realI = (await get(`hd_invoices?user_id=eq.${OWNER}&tax_breakdown=not.is.null&status=eq.sent&select=*&order=created_at.desc&limit=1`))[0]
  const realWO = (await get(`hd_work_orders?user_id=eq.${OWNER}&quote_id=not.is.null&select=id&order=created_at.desc&limit=1`))[0]
  const terms = { version: 1, captured_at: new Date().toISOString(), warranty: 'SMOKE 90 days on workmanship.', customer_supplied_clause: 'SMOKE customer parts not warranted.', payment_terms: 'net_30', payment_instructions: 'SMOKE checks payable to the shop.', pay_link: 'https://pay.example.com/smoke' }
  const q = await ins('hd_quotes', { ...strip(realQ, DROP), quote_number: `SMOKE-AUD-${Date.now()}`, customer_name: 'SMOKE audit quote', status: 'sent', public_token: tok(), approved_at: null, approval_method: null, terms_snapshot: terms })
  const inv = await ins('hd_invoices', { ...strip(realI, DROP), invoice_number: `SMOKE-AUD-${Date.now()}`, customer_name: 'SMOKE audit invoice', status: 'sent', public_token: tok(), terms_snapshot: terms })

  const session = await openSession(OWNER)
  const pages: Array<{ name: string; path: string; auth: boolean }> = [
    { name: 'PDF (customer)', path: `/api/hd/invoices/${inv.id}/pdf`, auth: true },
    { name: 'Public quote (customer)', path: `/hd/quote/${q.public_token}`, auth: false },
    { name: 'Pay page (customer)', path: `/hd/invoices/pay/${inv.public_token}`, auth: false },
    { name: 'Quote new', path: '/hd/quotes/new', auth: true },
    { name: 'Quote edit', path: `/hd/quotes/${q.id}/edit`, auth: true },
    { name: 'Quote detail', path: `/hd/quotes/${q.id}`, auth: true },
    { name: 'Quotes list', path: '/hd/quotes', auth: true },
    { name: 'Invoice detail', path: `/hd/invoices/${inv.id}`, auth: true },
    { name: 'Invoice edit', path: `/hd/invoices/${inv.id}/edit`, auth: true },
    { name: 'Invoice new', path: '/hd/invoices/new', auth: true },
    { name: 'Invoices list', path: '/hd/invoices', auth: true },
    { name: 'Work order detail', path: `/hd/work-orders/${realWO.id}`, auth: true },
    { name: 'Work orders list', path: '/hd/work-orders', auth: true },
    { name: 'Settings', path: '/hd/settings', auth: true },
    { name: 'Dashboard', path: '/hd/dashboard', auth: true },
    { name: 'quickwrench', path: '/hd/quickwrench', auth: true },
    { name: 'labor-cards', path: '/hd/labor-cards', auth: true },
    { name: 'scheduler', path: '/hd/scheduler', auth: true },
    { name: 'fleet-accounts', path: '/hd/fleet-accounts', auth: true },
    { name: 'fleet-units', path: '/hd/fleet-units', auth: true },
    { name: 'financials', path: '/hd/financials', auth: true },
    { name: 'dot-inspections', path: '/hd/dot-inspections', auth: true },
    { name: 'equipment-inspections', path: '/hd/equipment-inspections', auth: true },
    { name: 'aerial-inspections', path: '/hd/aerial-inspections', auth: true },
    { name: 'pm-schedules', path: '/hd/pm-schedules', auth: true },
    { name: 'parts', path: '/hd/parts', auth: true },
    { name: 'reports', path: '/hd/reports', auth: true },
    { name: 'epa-log', path: '/hd/epa-log', auth: true },
    { name: 'invoicing', path: '/hd/invoicing', auth: true },
    { name: 'import', path: '/hd/import', auth: true },
    { name: 'inspections', path: '/hd/inspections', auth: true },
    { name: 'units', path: '/hd/units', auth: true },
    { name: 'resources', path: '/hd/resources', auth: true },
    { name: 'reefer', path: '/hd/reefer', auth: true },
    { name: 'cargo-watch', path: '/hd/cargo-watch', auth: true },
    { name: 'foreman', path: '/hd/foreman', auth: true },
    { name: 'intel', path: '/hd/intel', auth: true },
    { name: 'pm-checklist', path: '/hd/pm-checklist', auth: true },
  ]

  // AUDIT_ONLY="PDF,Quote new" limits the run to pages whose name contains one of those.
  const only = (process.env.AUDIT_ONLY ?? '').split(',').map(x => x.trim()).filter(Boolean)
  if (only.length) pages.splice(0, pages.length, ...pages.filter(p => only.some(o => p.name.includes(o))))
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  const results: any[] = []
  try {
    for (const mode of ['light', 'dark']) {
      for (const p of pages) {
        const pg = await browser.newPage()
        await pg.setViewport({ width: 1280, height: 900 })
        if (p.auth) {
          await pg.setExtraHTTPHeaders({ cookie: session.cookie })
        }
        await pg.evaluateOnNewDocument((m: string) => { try { localStorage.setItem('nwi-theme', m) } catch {} }, mode)
        let res: any = null
        try { res = await pg.goto(BASE + p.path, { waitUntil: 'networkidle2', timeout: 240000 }) } catch (e) { console.log(`${mode} ${p.name} LOAD FAILED ${e}`); results.push({ mode, page: p.name, path: p.path, status: 'timeout', failures: [] }); await pg.close(); continue }
        // Open every collapsed discount editor so its text is measured too.
        await pg.evaluate(() => document.querySelectorAll('[data-testid="add-discount"]').forEach(b => (b as HTMLElement).click()))
        await new Promise(r => setTimeout(r, 300))
        const found = await pg.evaluate(fs.readFileSync(new URL('./audit-contrast-measure.js', import.meta.url), 'utf8'))
        results.push({ mode, page: p.name, path: p.path, status: res?.status(), failures: found })
        console.log(`${mode.padEnd(5)} ${p.name.padEnd(26)} ${res?.status()}  ${found.length} below AA`)
        await pg.close()
      }
    }
  } finally {
    await browser.close()
    await del('hd_quotes', q.id); await del('hd_invoices', inv.id)
    fs.writeFileSync(OUT, JSON.stringify(results, null, 1))
  }
}
main().catch(e => { console.error(e); process.exit(1) })
