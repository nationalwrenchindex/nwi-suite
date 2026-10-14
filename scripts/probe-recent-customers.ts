// READ-ONLY. Find the customer record the report is about, across every account.
//
// The first probe scoped to one user_id and found nothing excluded, which only ruled
// out that shop. A customer created while signed into a different profile - an HD
// account, say - lives under that profile's user_id and the first probe could not
// see it at all.
//
// So: every customer created in the last week, whoever owns it, with its vehicles
// and whether the HD quote picker's filter can find it.
//
// No writes.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

interface Customer {
  id: string
  user_id: string
  first_name: string | null
  last_name: string | null
  company_name: string | null
  phone: string | null
  email: string | null
  created_at: string
}

async function get<T>(path: string): Promise<T[]> {
  const res = await fetch(`${S}/rest/v1/${path}`, { headers: H })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return await res.json() as T[]
}

/** The four columns GET /api/customers actually searches. */
function pickerCanFind(c: Customer, q: string): boolean {
  const t = q.toLowerCase()
  return [c.first_name, c.last_name, c.phone, c.email]
    .some(v => (v ?? '').toLowerCase().includes(t))
}

async function main() {
  const since = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
  const recent = await get<Customer>(
    `customers?select=id,user_id,first_name,last_name,company_name,phone,email,created_at` +
    `&created_at=gte.${since}&order=created_at.desc&limit=100`)

  console.log(`\n${recent.length} customer(s) created in the last 8 days, all accounts`)

  const profiles = await get<{ id: string; business_name: string | null; email: string | null }>(
    'profiles?select=id,business_name,email&limit=200')
  const shopOf = (id: string) => {
    const p = profiles.find(x => x.id === id)
    return p ? (p.business_name ?? p.email ?? id.slice(0, 8)) : id.slice(0, 8)
  }

  const vehicles = await get<{ id: string; customer_id: string | null; make: string | null; model: string | null; year: number | null; vin: string | null }>(
    'vehicles?select=id,customer_id,make,model,year,vin&limit=1000')

  console.log('')
  for (const c of recent) {
    const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || '(no person name)'
    const mine = vehicles.filter(v => v.customer_id === c.id)
    // What a tech would type: the company name if there is one, else the last name.
    const term = ((c.company_name ?? '').trim() || (c.last_name ?? '').trim()).split(/\s+/)[0]
    const findable = term.length >= 2 ? pickerCanFind(c, term) : false

    console.log(`${c.created_at.slice(0, 16).replace('T', ' ')}  ${name}`)
    console.log(`    shop        : ${shopOf(c.user_id)}`)
    if (c.company_name) console.log(`    company     : ${c.company_name}`)
    console.log(`    units       : ${mine.length}${mine.length ? ' - ' + mine.map(v => [v.year, v.make, v.model].filter(Boolean).join(' ')).join('; ') : ''}`)
    console.log(`    picker finds: ${findable ? 'yes' : 'NO'} when searching "${term}"` +
      (findable ? '' : '  <- company_name is not one of the four columns searched'))
    console.log('')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
