// READ-ONLY. Why would a customer saved in Intel Hub not appear in the HD quote
// form's "Link Intel Hub Customer" picker?
//
// The picker calls GET /api/customers?search=<q>&limit=8, which searches
// first_name, last_name, phone and email with ILIKE - and NOT company_name, even
// though customers.company_name exists (migration 067) and logHDCustomer writes it.
// It also orders by last_name and takes the first 8.
//
// This asks the live table which customers that combination can and cannot find.
// No writes.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
const OWNER = process.env.SMOKE_OWNER_ID ?? '4a8c046f-7db3-42bb-8422-fd47efb7678c'

interface Customer {
  id: string
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

/** What GET /api/customers would match for a search term, same filter shape. */
function matchesPickerSearch(c: Customer, q: string): boolean {
  const t = q.toLowerCase()
  return [c.first_name, c.last_name, c.phone, c.email]
    .some(v => (v ?? '').toLowerCase().includes(t))
}

async function main() {
  const all = await get<Customer>(
    `customers?select=id,first_name,last_name,company_name,phone,email,created_at&user_id=eq.${OWNER}&order=created_at.desc`)

  console.log(`\n${all.length} customer(s) for this shop`)

  // The ones whose identity is a COMPANY. These are the fleet customers an HD quote
  // is for, and they are the ones the picker's search cannot see by name.
  const companyOnly = all.filter(c =>
    (c.company_name ?? '').trim() !== '' &&
    `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() === '')
  const withCompany = all.filter(c => (c.company_name ?? '').trim() !== '')

  console.log(`  ${withCompany.length} have a company_name`)
  console.log(`  ${companyOnly.length} have a company_name and NO person name`)

  const noLastName = all.filter(c => (c.last_name ?? '').trim() === '')
  console.log(`  ${noLastName.length} have no last_name (the column the picker sorts by)`)

  console.log('\n10 most recently created:')
  console.log('  created     last_name        first_name       company_name')
  for (const c of all.slice(0, 10)) {
    console.log(
      `  ${c.created_at.slice(0, 10)}  ${String(c.last_name ?? '').slice(0, 15).padEnd(16)} ` +
      `${String(c.first_name ?? '').slice(0, 15).padEnd(16)} ${String(c.company_name ?? '').slice(0, 30)}`)
  }

  if (withCompany.length > 0) {
    console.log('\nCAN THE PICKER FIND THEM BY THEIR COMPANY NAME?')
    for (const c of withCompany.slice(0, 10)) {
      const term = (c.company_name ?? '').trim().split(/\s+/)[0]
      const found = matchesPickerSearch(c, term)
      console.log(`  ${found ? 'yes' : 'NO '}  searching "${term}" -> ${c.company_name}` +
        `${found ? '' : '   (company_name is not in the search)'}`)
    }
  }

  // ── THE DECISIVE TEST ────────────────────────────────────────────────────
  //
  // Simulate the picker exactly: the same ILIKE across the same four columns, the
  // same order by last_name ascending, the same limit of 8. Then ask, for each
  // customer, whether searching their OWN name actually returns them.
  //
  // This is the only way to answer "why is this one excluded" without guessing,
  // because the filter is not the only thing that can drop a row - the limit can too.
  console.log('\nCAN THE PICKER FIND EACH CUSTOMER BY THEIR OWN NAME?')
  console.log('  (searching the first 3 letters of their last name, which is what a tech types)')

  const byLastName = [...all].sort((a, b) =>
    (a.last_name ?? '').localeCompare(b.last_name ?? ''))

  const unreachable: Array<{ c: Customer; term: string; rank: number; matches: number }> = []

  for (const c of all) {
    const term = (c.last_name ?? '').trim().slice(0, 3)
    if (term.length < 2) continue
    const matches = byLastName.filter(x => matchesPickerSearch(x, term))
    const rank = matches.findIndex(x => x.id === c.id)
    const visible = rank > -1 && rank < 8
    if (!visible) unreachable.push({ c, term, rank, matches: matches.length })
  }

  if (unreachable.length === 0) {
    console.log('  every customer is reachable by their own last name.')
  } else {
    for (const u of unreachable) {
      const name = `${u.c.first_name ?? ''} ${u.c.last_name ?? ''}`.trim()
      console.log(`  NO  "${u.term}" -> ${name}: position ${u.rank + 1} of ${u.matches} matches, ` +
        `and the picker asks for only 8`)
    }
  }

  // The units. The report asks that a selected customer brings their unit, so this
  // says which table actually holds one and how it is linked.
  console.log('\nUNITS')
  const vehicles = await get<{ id: string; customer_id: string | null; make: string | null; model: string | null; year: number | null }>(
    `vehicles?select=id,customer_id,make,model,year&limit=1000`)
  console.log(`  vehicles (what Intel Hub's "add unit" writes): ${vehicles.length}`)
  const withCustomer = vehicles.filter(v => v.customer_id != null).length
  console.log(`    ${withCustomer} linked to a customer_id`)

  // hd_units is the HD fleet table and is NOT what Intel Hub writes - it has no
  // customer_id column at all, which the first run of this script proved with a
  // 42703. Listed by fleet account only.
  const hdUnits = await get<{ id: string; unit_number: string | null; fleet_account_id: string | null }>(
    `hd_units?select=id,unit_number,fleet_account_id&user_id=eq.${OWNER}&limit=200`)
  console.log(`  hd_units (the HD fleet table): ${hdUnits.length}`)
  console.log(`    ${hdUnits.filter(u => u.fleet_account_id != null).length} linked to a fleet account`)
  console.log('    hd_units has NO customer_id column, so an Intel Hub customer and an')
  console.log('    hd_unit cannot be linked to each other at all.')

  console.log('\nVEHICLES PER CUSTOMER (most recent 10 customers)')
  for (const c of all.slice(0, 10)) {
    const mine = vehicles.filter(v => v.customer_id === c.id)
    const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim()
    console.log(`  ${name.slice(0, 28).padEnd(29)} ${mine.length} vehicle(s)` +
      (mine.length ? `: ${mine.map(v => [v.year, v.make, v.model].filter(Boolean).join(' ')).join('; ')}` : ''))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
