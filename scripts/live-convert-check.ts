// END TO END, AGAINST THE DEPLOYED SITE. Rebuilds WO-2026-0021's scenario, converts it,
// and checks the invoice lands on 753.18.
//
//   npx tsx scripts/live-convert-check.ts
//   BASE=https://tools.nationalwrenchindex.com npx tsx scripts/live-convert-check.ts
//
// THIS WRITES. It creates one work order and converts it to one invoice, both labelled
// ACCEPTANCE TEST so they are obvious in a list, and it prints their ids so they can be
// removed. It does NOT delete them: a conversion that is immediately erased proves less
// than one that can be looked at.
//
// Authentication reuses the chain scripts/fetch-pages.ts established - admin
// generate_link, then /auth/v1/verify with the ANON key, then the chunked @supabase/ssr
// cookie - so the request goes through the real route handler as the real owner.

import fs from 'fs'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const BASE = process.env.BASE ?? 'https://tools.nationalwrenchindex.com'
const OWNER = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

const SVC_H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }

let pass = 0, fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) pass++; else fail++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`)
}
const hr = (t: string) => { console.log('\n' + '='.repeat(84)); console.log(t); console.log('='.repeat(84)) }
const usd = (n: number) => Number(n).toFixed(2)
const rest = async (q: string) => (await fetch(`${SUPA}/rest/v1/${q}`, { headers: SVC_H })).json()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ── the session cookie, same construction as fetch-pages ────────────────────
function chunk(name: string, value: string): string[] {
  const MAX = 3180
  if (encodeURIComponent(value).length <= MAX) return [`${name}=${encodeURIComponent(value)}`]
  const out: string[] = []
  let i = 0, part = 0
  while (i < value.length) {
    let end = Math.min(i + MAX, value.length)
    let piece = value.slice(i, end)
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

async function cookieHeader(): Promise<string> {
  const users = await (await fetch(`${SUPA}/auth/v1/admin/users?per_page=200`, { headers: SVC_H })).json()
  const list = Array.isArray(users) ? users : users.users ?? []
  const owner = list.find((u: { id: string }) => u.id === OWNER)
  if (!owner?.email) throw new Error('could not find the owner email')

  const gen = await (await fetch(`${SUPA}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: SVC_H,
    body: JSON.stringify({ type: 'magiclink', email: owner.email }),
  })).json()
  const hashed = gen.hashed_token ?? gen.properties?.hashed_token
  if (!hashed) throw new Error('no hashed_token from generate_link')

  const ver = await (await fetch(`${SUPA}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: hashed }),
  })).json()
  if (!ver.access_token) throw new Error('verify returned no session')
  if (ver.user?.id !== OWNER) throw new Error('session is not the owner')

  const name = `sb-${new URL(SUPA).hostname.split('.')[0]}-auth-token`
  const value = 'base64-' + Buffer.from(JSON.stringify(ver)).toString('base64url')
  return chunk(name, value).join('; ')
}

async function main() {
  hr(`1. Authenticate against ${BASE}`)
  const cookie = await cookieHeader()
  ok(cookie.length > 0, 'session cookie built')

  // A read-only probe first: an authenticated page must not redirect to login.
  const probe = await fetch(`${BASE}/work-orders/new`, { headers: { cookie }, redirect: 'follow' })
  ok(!new URL(probe.url).pathname.startsWith('/login'),
    `authenticated against the deployed site (landed on ${new URL(probe.url).pathname})`)

  // The shop's settings, so the expectation is computed from them not assumed.
  const prof = (await rest(`profiles?select=default_labor_rate,default_parts_markup_percent,default_tax_percent,shop_supplies_percent,shop_supplies_cap,bill_shop_supplies,tax_parts,tax_labor,tax_rate_parts,tax_rate_labor&id=eq.${OWNER}`))[0]
  console.log(`  shop: markup ${prof.default_parts_markup_percent}%, labor ${prof.default_labor_rate}, supplies ${prof.shop_supplies_percent}% cap ${prof.shop_supplies_cap}, tax ${prof.tax_rate_parts}/${prof.tax_rate_labor}`)

  // ══ 2. CREATE THE WORK ORDER ═══════════════════════════════════════════════
  hr('2. Create the scenario: part 300.00 base at 30%, 2 labor hours at 135.00')

  const body = {
    customer_name: 'ACCEPTANCE TEST',
    job_description: 'ACCEPTANCE TEST - WO-2026-0021 scenario, expects 753.18',
    status: 'complete',
    pricing_mode: 'single',
    parts_markup_percent: 30,
    labor_hours: 2,
    labor_rate: 135,
    tax_percent: 7.75,
    line_items: [
      { type: 'parts', description: 'ACCEPTANCE TEST part', part_number: 'ACC-1', quantity: 1, unit_price: 390, total: 390 },
      { type: 'labor', description: 'Labor', quantity: 2, unit_price: 135, total: 270 },
    ],
    parts_subtotal: 300,
    labor_subtotal: 270,
  }

  // REUSE an unconverted ACCEPTANCE TEST work order if one is lying around. Every
  // earlier run created a new one and left it, and six accumulated while waiting for a
  // deployment. A test that litters production a little more each time you run it is a
  // test people stop running.
  const existing = await rest(
    'work_orders?select=id,work_order_number,status,converted_invoice_id' +
    '&job_description=like.ACCEPTANCE TEST*&converted_invoice_id=is.null' +
    '&order=work_order_number.desc&limit=1',
  )
  const reusable = Array.isArray(existing) ? existing[0] : null
  if (reusable) {
    console.log(`  reusing ${reusable.work_order_number} instead of creating another`)
  }

  const created = reusable ? null : await fetch(`${BASE}/api/work-orders`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const createdJson = created ? await created.json().catch(() => ({})) : null
  if (created) {
    ok(created.status === 201 || created.status === 200,
      `POST /api/work-orders -> ${created.status} ${created.ok ? '' : JSON.stringify(createdJson).slice(0, 180)}`)
  } else {
    ok(true, 'reused an existing unconverted ACCEPTANCE TEST work order')
  }
  const woId = reusable?.id ?? createdJson?.work_order?.id
  ok(!!woId, `work order ready (${reusable?.work_order_number ?? createdJson?.work_order?.work_order_number ?? 'none'})`)
  if (!woId) return

  // The create route ignores a status in the body, so mark it complete explicitly -
  // the converter refuses anything else, by design. The PATCH also re-runs the sync.
  const setStatus = () => fetch(`${BASE}/api/work-orders/${woId}/status`, {
    method: 'POST',
    headers: { cookie, 'Content-Type': 'application/json' },
    // notify false so a test work order cannot text or email a customer.
    body: JSON.stringify({ status: 'complete', notify: false }),
  })
  const patched = await setStatus()
  const patchedBody = await patched.clone().json().catch(() => ({}))
  ok(patched.ok, `POST status=complete -> ${patched.status} ${patched.ok ? '' : JSON.stringify(patchedBody).slice(0, 140)}`)

  // THE DEPLOY PROBE. The sync writing a non-zero tax_amount is only possible with the
  // new code, so this is also how we know the push is live rather than guessing from a
  // timer. Poll rather than sleep once: a Vercel build can take a couple of minutes.
  // IS THE FIX ACTUALLY DEPLOYED? Ask the SYNC, not the page.
  //
  // My first probe looked for the new "Subtotal" row on /work-orders/new. That row sits
  // inside the owns-gated Parts & Labor section, which does not render until a pricing
  // mode is chosen - so it is absent whatever is deployed, and the gate could never
  // pass. It blocked its own test twice before I replaced it.
  //
  // The behavioural probe cannot be fooled: PATCH re-runs syncParentExtrasQuietly, and
  // the OLD sync writes shop_supplies_fee while leaving tax_amount alone. A non-null
  // tax_amount is only possible with the fix.
  const nudge = () => fetch(`${BASE}/api/work-orders/${woId}`, {
    method: 'PATCH',
    headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_description: `ACCEPTANCE TEST - deploy probe ${new Date().toISOString()}` }),
  })

  let wo: Record<string, unknown> | undefined
  let deployed = false
  for (let attempt = 1; attempt <= 16; attempt++) {
    await nudge()
    await sleep(attempt === 1 ? 2500 : 15000)
    wo = (await rest(`work_orders?select=*&id=eq.${woId}`))[0]
    const t = wo?.tax_amount
    if (t !== null && t !== undefined && Number(t) !== 0) { deployed = true; break }
    console.log(`    attempt ${attempt}: the deployed sync wrote fee ${usd(Number(wo?.shop_supplies_fee ?? 0))} but tax ${t === null ? 'null' : usd(Number(t ?? 0))} - old code still live`)
  }
  ok(deployed, 'the fix is live: the server-side sync wrote a tax amount, which only the new code does')
  if (!deployed) {
    console.log('')
    console.log('  STOPPING. The deployed sync still writes the fee without the tax, so the')
    console.log('  build has not landed. Converting now would fail for a reason already fixed.')
    return
  }

  // Put it back to complete - the nudges above only touched the description, but the
  // converter requires complete and a status change is a separate endpoint.
  await setStatus()
  await sleep(1500)
  wo = (await rest(`work_orders?select=*&id=eq.${woId}`))[0]

  if (!wo) { ok(false, 'could not read the work order back'); return }
  console.log(`  stored: fee ${usd(Number(wo.shop_supplies_fee ?? 0))}, tax ${usd(Number(wo.tax_amount ?? 0))}, total ${usd(Number(wo.grand_total ?? 0))}`)
  console.log(`  stored tax_breakdown: ${JSON.stringify(wo.tax_breakdown)}`)
  ok(Number(wo.shop_supplies_fee) === 39,
    `the sync computed a 39.00 supplies fee server-side (got ${usd(Number(wo.shop_supplies_fee ?? 0))})`)
  ok(Number(wo.tax_amount) === 54.18,
    `and tax 54.18 WITH the fee in the parts bucket (got ${usd(Number(wo.tax_amount ?? 0))})`)
  ok(Number(wo.grand_total) === 753.18,
    `and grand total 753.18 (got ${usd(Number(wo.grand_total ?? 0))})`)

  // ══ 3. CONVERT IT ══════════════════════════════════════════════════════════
  hr('3. Convert - this is what was refusing')

  ok(String(wo.status) === 'complete', `the work order is complete (${wo.status})`)

  const conv = await fetch(`${BASE}/api/work-orders/${woId}/convert`, {
    method: 'POST', headers: { cookie },
  })
  const convJson = await conv.json().catch(() => ({}))
  console.log(`  POST /convert -> ${conv.status}`)
  if (!conv.ok) console.log(`  body: ${JSON.stringify(convJson).slice(0, 300)}`)

  ok(conv.ok, `the conversion SUCCEEDED (${conv.status})`)
  ok(!JSON.stringify(convJson).includes('does not match its own breakdown'),
    'and did not hit the tax/breakdown guard')
  const invId = convJson.invoice?.id ?? convJson.invoice_id
  ok(!!invId, 'an invoice was created')
  if (!invId) return

  // ══ 4. THE INVOICE ═════════════════════════════════════════════════════════
  hr('4. The invoice must land on 753.18')

  const inv = (await rest(`invoices?select=*&id=eq.${invId}`))[0]
  console.log(`  ${inv.invoice_number}`)
  console.log(`    subtotal          ${usd(inv.subtotal)}`)
  console.log(`    tax_amount        ${usd(inv.tax_amount)}`)
  console.log(`    total             ${usd(inv.total)}`)
  console.log(`    shop_supplies_fee ${usd(inv.shop_supplies_fee ?? 0)}`)
  console.log(`    tax_breakdown     ${JSON.stringify(inv.tax_breakdown)}`)

  ok(Number(inv.subtotal) === 699,   `subtotal 699.00 (got ${usd(inv.subtotal)})`)
  ok(Number(inv.tax_amount) === 54.18, `tax 54.18 (got ${usd(inv.tax_amount)})`)
  ok(Number(inv.total) === 753.18,   `TOTAL 753.18 (got ${usd(inv.total)})`)
  ok(Number(inv.shop_supplies_fee) === 39, `the fee carried across at 39.00 (got ${usd(inv.shop_supplies_fee ?? 0)})`)

  const bd = inv.tax_breakdown as { parts?: { base: number; amount: number }; labor?: { base: number; amount: number } } | null
  ok(Number(bd?.parts?.base) === 429, `the parts bucket is 429.00, fee inside (got ${bd?.parts?.base})`)
  ok(Number(bd?.parts?.amount) === 33.25, `taxing 33.25 (got ${bd?.parts?.amount})`)
  ok(Number(bd?.labor?.amount) === 20.93, `labor taxes 20.93 (got ${bd?.labor?.amount})`)

  // And the invariant that started all of this.
  const lineSum = (inv.line_items as Array<{ total: number }>).reduce((n, l) => n + Number(l.total), 0)
  ok(Math.round((lineSum + Number(inv.shop_supplies_fee)) * 100) / 100 === Number(inv.subtotal),
    `lines ${usd(lineSum)} + fee ${usd(inv.shop_supplies_fee)} = subtotal ${usd(inv.subtotal)} - it states what it bills`)

  console.log('')
  console.log(`  Created for this check, labelled ACCEPTANCE TEST, left in place:`)
  console.log(`    work order ${wo.work_order_number}  id ${woId}`)
  console.log(`    invoice    ${inv.invoice_number}  id ${invId}`)

  console.log('\n' + '='.repeat(84))
  console.log(`${pass} passed, ${fail} failed`)
  console.log('='.repeat(84))
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })
