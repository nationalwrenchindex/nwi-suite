// What can the ANON key read? The anon key ships in the browser bundle, so anything
// it returns is public. Also samples capability-token shape and lists dormant
// accounts. Read-only against production.
//
//   node scripts/audit-exposure.cjs

const fs = require('fs')
for (const ln of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = ln.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = process.env.NEXT_PUBLIC_SUPABASE_URL
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const svcH = { apikey: SVC, Authorization: `Bearer ${SVC}` }
const anonH = { apikey: ANON, Authorization: `Bearer ${ANON}` }
const get = async (p, h) => {
  const r = await fetch(`${U}/rest/v1/${p}`, { headers: h })
  const t = await r.text()
  return { status: r.status, body: t }
}

const SENSITIVE = [
  'profiles', 'customers', 'vehicles', 'invoices', 'quotes', 'work_orders',
  'work_order_segments', 'jobs', 'inspections', 'inspection_items',
  'hd_invoices', 'hd_quotes', 'hd_units', 'hd_fleet_accounts', 'hd_work_orders',
  'hd_dot_inspections', 'hd_aerial_inspections', 'hd_equipment_inspections',
  'hd_pm_checklists', 'notification_logs', 'notifications', 'subscriptions',
  'fleet_pro_units', 'fleet_pro_pretrip_inspections', 'fleet_pro_members',
  'products_inventory', 'parts_deliveries', 'expenses', 'detailer_service_pricing',
]

;(async () => {
  console.log('='.repeat(78))
  console.log('PHASE 0d — WHAT THE ANON KEY CAN READ')
  console.log('  The anon key ships in the browser bundle. Anything it reads is public.')
  console.log('='.repeat(78))
  const leaks = []
  for (const t of SENSITIVE) {
    const r = await get(`${t}?select=*&limit=1`, anonH)
    let rows = 0, note = ''
    if (r.status === 200) {
      try { rows = JSON.parse(r.body).length } catch { rows = -1 }
      if (rows > 0) { leaks.push(t); note = 'LEAK — returns data to anon' }
      else note = 'allowed but returns 0 rows (RLS filtering, or table empty)'
    } else {
      try { note = JSON.parse(r.body).message?.slice(0, 60) ?? r.body.slice(0, 60) } catch { note = r.body.slice(0, 60) }
    }
    console.log(`  ${String(r.status).padEnd(4)} ${t.padEnd(32)} rows=${String(rows).padStart(2)}  ${note}`)
  }
  console.log(`\n  TABLES LEAKING DATA TO ANON: ${leaks.length}${leaks.length ? ' -> ' + leaks.join(', ') : ''}`)

  // Cross-check: do those same tables return rows to the service key (i.e. are they non-empty)?
  console.log('\n  Row counts with the SERVICE key, so "0 rows" above can be told from "empty table":')
  for (const t of SENSITIVE) {
    const r = await fetch(`${U}/rest/v1/${t}?select=*&limit=1`, { headers: { ...svcH, Prefer: 'count=exact' } })
    const cr = r.headers.get('content-range') ?? ''
    const total = cr.split('/')[1] ?? '?'
    if (total !== '0') console.log(`    ${t.padEnd(32)} ${total}`)
  }

  // ── Token shape: guessable? ──
  console.log('\n' + '='.repeat(78))
  console.log('TOKEN SHAPE — are capability URLs guessable?')
  console.log('='.repeat(78))
  for (const [t, col] of [['quotes', 'public_token'], ['invoices', 'public_token'], ['work_orders', 'public_token']]) {
    const r = await get(`${t}?select=${col}&${col}=not.is.null&limit=6`, svcH)
    if (r.status !== 200) { console.log(`  ${t}.${col}: ${r.status}`); continue }
    const toks = JSON.parse(r.body).map(x => x[col])
    const lens = [...new Set(toks.map(x => String(x).length))]
    console.log(`  ${t}.${col}: ${toks.length} sampled, length(s)=${lens.join(',')}`)
    toks.slice(0, 3).forEach(x => console.log(`    ${x}`))
    const hex = toks.every(x => /^[0-9a-f]+$/i.test(String(x)))
    console.log(`    all hex: ${hex}   sequential-looking: ${toks.length > 1 && toks.some((x, i) => i > 0 && Math.abs(parseInt(String(x).slice(0, 8), 16) - parseInt(String(toks[i - 1]).slice(0, 8), 16)) < 1000)}`)
  }

  // ── 0e: junk accounts ──
  console.log('\n' + '='.repeat(78))
  console.log('PHASE 0e — ACCOUNTS THAT LOOK BOT-CREATED')
  console.log('='.repeat(78))
  const prof = await get('profiles?select=id,email,full_name,business_name,business_type,created_at,slug,phone,city,state&order=created_at', svcH)
  const profiles = JSON.parse(prof.body)
  const subs = await get('subscriptions?select=user_id,plan,status', svcH)
  const subByUser = new Map()
  if (subs.status === 200) JSON.parse(subs.body).forEach(s => subByUser.set(s.user_id, s))

  // Activity signals: does this profile own ANY real work?
  const activity = {}
  for (const tbl of ['customers', 'quotes', 'invoices', 'jobs', 'work_orders', 'hd_invoices']) {
    const r = await get(`${tbl}?select=user_id`, svcH)
    if (r.status !== 200) continue
    JSON.parse(r.body).forEach(x => {
      if (!x.user_id) return
      activity[x.user_id] = activity[x.user_id] ?? {}
      activity[x.user_id][tbl] = (activity[x.user_id][tbl] ?? 0) + 1
    })
  }

  const junk = []
  console.log(`  profiles: ${profiles.length}\n`)
  for (const p of profiles) {
    const act = activity[p.id] ?? {}
    const totalAct = Object.values(act).reduce((a, b) => a + b, 0)
    const sub = subByUser.get(p.id)
    const noName = !p.business_name && !p.full_name
    const isJunk = totalAct === 0 && !sub && noName
    if (isJunk) junk.push(p)
    console.log(`  ${isJunk ? 'JUNK' : '    '} ${String(p.email ?? '—').padEnd(34)} name=${String(p.business_name ?? p.full_name ?? '—').slice(0, 22).padEnd(24)} created=${String(p.created_at).slice(0, 10)} sub=${sub ? sub.status : '—'} activity=${totalAct}`)
  }
  console.log(`\n  CANDIDATES FOR DELETION: ${junk.length}`)
  junk.forEach(p => console.log(`    ${p.id}  ${p.email ?? '(no email)'}`))
})()
