// READ-ONLY. HD's Intel Hub is a different table from the one the quote picker asks.
//
//   /intel      (LD)  reads and writes  customers + vehicles
//   /hd/intel   (HD)  reads             hd_fleet_accounts + hd_units
//
// The HD quote form's picker is labelled "Link Intel Hub Customer" and calls
// GET /api/customers, which is the LD table. A record created in HD's Intel Hub is
// an hd_fleet_account and cannot appear there no matter what is typed.
//
// This lists what HD's Intel Hub actually holds, so the report names real rows.
// No writes.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

async function get<T>(path: string): Promise<T[]> {
  const res = await fetch(`${S}/rest/v1/${path}`, { headers: H })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return await res.json() as T[]
}

async function main() {
  const profiles = await get<{ id: string; business_name: string | null; email: string | null }>(
    'profiles?select=id,business_name,email&limit=200')
  const shopOf = (id: string) => {
    const p = profiles.find(x => x.id === id)
    return p ? (p.business_name ?? p.email ?? id.slice(0, 8)) : id.slice(0, 8)
  }

  const accounts = await get<{
    id: string; user_id: string; fleet_name: string; contact_name: string | null
    contact_phone: string | null; contact_email: string | null; address: string | null
    created_at: string
  }>('hd_fleet_accounts?select=id,user_id,fleet_name,contact_name,contact_phone,contact_email,address,created_at&order=created_at.desc&limit=50')

  const units = await get<{
    id: string; fleet_account_id: string | null; unit_number: string | null
    manufacturer: string | null; model: string | null; serial_number: string | null
    created_at: string
  }>('hd_units?select=id,fleet_account_id,unit_number,manufacturer,model,serial_number,created_at&order=created_at.desc&limit=200')

  console.log(`\n${accounts.length} fleet account(s) in HD's Intel Hub, newest first\n`)
  for (const a of accounts.slice(0, 12)) {
    const mine = units.filter(u => u.fleet_account_id === a.id)
    console.log(`${a.created_at.slice(0, 16).replace('T', ' ')}  ${a.fleet_name}`)
    console.log(`    shop     : ${shopOf(a.user_id)}`)
    if (a.contact_name)  console.log(`    contact  : ${a.contact_name}`)
    if (a.contact_phone) console.log(`    phone    : ${a.contact_phone}`)
    if (a.address)       console.log(`    address  : ${a.address}`)
    console.log(`    units    : ${mine.length}`)
    for (const u of mine.slice(0, 4)) {
      console.log(`      ${[u.unit_number, u.manufacturer, u.model, u.serial_number].filter(Boolean).join(' / ')}`)
    }
    console.log('')
  }

  const orphanUnits = units.filter(u => u.fleet_account_id == null)
  console.log(`${units.length} unit(s) total, ${orphanUnits.length} with no fleet account`)

  console.log('\nTHE POINT:')
  console.log('  None of the above can appear in the HD quote form\'s picker. It queries')
  console.log('  GET /api/customers, which reads the `customers` table - a different table,')
  console.log('  populated for HD only as a side effect of logHDCustomer when a quote or')
  console.log('  invoice is SAVED. So customers born of HD paperwork show up in the picker,')
  console.log('  and everything entered in HD\'s own Intel Hub never does.')
}

main().catch(e => { console.error(e); process.exit(1) })
