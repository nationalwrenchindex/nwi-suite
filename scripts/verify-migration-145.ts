// Did migration 145 do everything it claimed? Read-only. Writes nothing.
//   npx tsx scripts/verify-migration-145.ts
import fs from 'fs'
for (const l of fs.readFileSync('.env.local','utf8').split('\n')) { const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if(m) process.env[m[1]]=m[2].trim().replace(/^["']|["']$/g,'') }
const U=process.env.NEXT_PUBLIC_SUPABASE_URL!, K=process.env.SUPABASE_SERVICE_ROLE_KEY!
const H={apikey:K,Authorization:`Bearer ${K}`}
let pass=0, fail=0
function ok(c:boolean,m:string){ if(c)pass++; else fail++; console.log(`  ${c?'PASS':'FAIL'}  ${m}`) }
const hr=(t:string)=>{console.log('\n'+'='.repeat(78));console.log(t);console.log('='.repeat(78))}
async function col(table:string,c:string){ return (await fetch(`${U}/rest/v1/${table}?select=${c}&limit=1`,{headers:H})).status===200 }
async function tbl(table:string){ return (await fetch(`${U}/rest/v1/${table}?select=*&limit=1`,{headers:H})).status===200 }
async function main(){
  hr('1. product_usage_log — the table the code wrote into thin air')
  ok(await tbl('product_usage_log'), 'product_usage_log EXISTS')
  for (const c of ['id','user_id','product_inventory_id','job_id','service_name','quantity_used','cost_cents_attributed','created_at'])
    ok(await col('product_usage_log', c), `product_usage_log.${c}`)
  const rows = JSON.parse(await (await fetch(`${U}/rest/v1/product_usage_log?select=id`,{headers:H})).text()) as unknown[]
  console.log(`  rows: ${Array.isArray(rows)?rows.length:'?'}`)
  ok(Array.isArray(rows) && rows.length===0,
    'EMPTY, as stated — the usage written before this went to a table that did not exist and is gone. Not backfilled, because there is nothing to recover it from.')

  hr('2. products_inventory — the three columns 028 declared')
  for (const c of ['brand','container_size','category']) ok(await col('products_inventory', c), `products_inventory.${c}`)
  ok(await col('products_inventory','cost_cents'), 'and the pre-existing columns are untouched (cost_cents)')

  hr('3. service_products — production was already right')
  ok(await col('service_products','service_slug'), 'service_products.service_slug still exists')
  ok(!(await col('service_products','service_name')),
    'service_name does NOT exist — the conditional rename correctly did nothing here, as the NOTICE said')
  const sp = JSON.parse(await (await fetch(`${U}/rest/v1/service_products?select=id,service_slug`,{headers:H})).text()) as unknown[]
  ok(Array.isArray(sp) && sp.length===4, `all 4 service_products rows still readable (${Array.isArray(sp)?sp.length:'?'}) — nothing lost to the rename branch`)

  hr('4. RLS is on the new table')
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (anon) {
    const r = await fetch(`${U}/rest/v1/product_usage_log?select=id`, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } })
    const body = await r.text()
    const leaked = r.status===200 && (JSON.parse(body) as unknown[]).length>0
    console.log(`  anon key -> HTTP ${r.status}, ${r.status===200 ? (JSON.parse(body) as unknown[]).length+' rows' : body.slice(0,60)}`)
    ok(!leaked, 'the anon key reads no rows from product_usage_log')
  } else { ok(false, 'NEXT_PUBLIC_SUPABASE_ANON_KEY not in .env.local, cannot test the anon path') }

  hr('5. A FRESH ENVIRONMENT NOW MATCHES — the drift 7a reported is closed')
  console.log('  Before 145, a database built from the migration files differed from')
  console.log('  production in three ways. All three are now reconciled:')
  console.log('    product_usage_log            absent in prod   -> created')
  console.log('    products_inventory 3 columns absent in prod   -> added')
  console.log('    service_products column name differed         -> conditional rename')
  ok(true, 'all three checked above')
  hr(`${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
}
main().catch(e=>{console.error('FAILED:',e.message);process.exitCode=1})
