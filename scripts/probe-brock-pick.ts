// READ-ONLY. Item 1 of the Oct 14 carry pass: was "brock fleeman test" a fleet
// account or a customers row, and what does each source hold? No writes.
import { loadEnv } from './lib/smoke-session'
loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
const U = '4a8c046f-7db3-42bb-8422-fd47efb7678c'
async function get(path: string) {
  const r = await fetch(`${S}/rest/v1/${path}`, { headers: H })
  const body = await r.text()
  return r.ok ? JSON.parse(body) : { error: r.status, body }
}
async function main() {
  const show = (t: string, v: unknown) => console.log(`\n== ${t}\n` + JSON.stringify(v, null, 1))
  show('subscription', await get(`subscriptions?select=tier,status,is_comped,vertical&user_id=eq.${U}`))
  show('fleet account', await get(`hd_fleet_accounts?select=id,fleet_name,address,contact_phone,contact_email&id=eq.1ab0e503-c602-4d6c-adfc-f6d61affd437`))
  show('customers row', await get(`customers?select=id,company_name,address_line1,city,state,zip,phone,email,payment_terms&id=eq.2079e57b-ac4c-40fa-a5d8-5e8a13e85c2e`))
  show('quotes for user', await get(`hd_quotes?select=quote_number,created_at,updated_at,status,customer_name,customer_id,address_line1,city,unit_model,unit_serial,payment_terms&user_id=eq.${U}&order=created_at.desc&limit=6`))
  show('WOs for user', await get(`hd_work_orders?select=work_order_number,created_at,customer_name,unit_model,unit_serial,quote_id&user_id=eq.${U}&order=created_at.desc&limit=3`))
  show('invoices for user', await get(`hd_invoices?select=invoice_number,created_at,customer_name,payment_terms,fleet_account_id,unit_number,work_order_id&user_id=eq.${U}&order=created_at.desc&limit=3`))
}
main().catch(e => { console.error(e); process.exit(1) })

// Production, as the owner: exactly the three GETs the picker makes. Read-only.
import { openSession } from './lib/smoke-session'
async function prod() {
  const BASE = 'https://tools.nationalwrenchindex.com'
  const s = await openSession(U)
  for (const p of [
    '/api/customers?search=brock%20fleeman%20test&limit=8',
    '/api/hd/fleet-accounts?search=brock%20fleeman%20test&limit=8',
    '/api/hd/fleet-units?fleet_account_id=1ab0e503-c602-4d6c-adfc-f6d61affd437&limit=50',
  ]) {
    const r = await fetch(BASE + p, { headers: { cookie: s.cookie }, redirect: 'manual' })
    const t = await r.text()
    console.log(`\nPROD ${r.status} ${p}\n  ${t.slice(0, 400)}`)
  }
}
prod().catch(e => { console.error(e); process.exit(1) })
