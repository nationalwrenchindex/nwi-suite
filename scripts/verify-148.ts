// Did migration 148 land, and do its constraints actually refuse what they promise?
//
// Not "do the tables exist" - that is the easy half. The load depends on
// is_single_model REJECTING group strings, and on the generated columns being
// generated. Both are tested by trying them.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

const rows: Array<{ step: string; ok: boolean; detail: string }> = []
function record(step: string, ok: boolean, detail: string): boolean {
  rows.push({ step, ok, detail })
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${step.padEnd(58)} ${detail}`)
  return ok
}

async function post(table: string, body: unknown) {
  const res = await fetch(`${S}/rest/v1/${table}`, {
    method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => null) as unknown }
}

async function del(table: string, filter: string) {
  await fetch(`${S}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: H })
}

async function main() {
  console.log(`\nVERIFY MIGRATION 148  ${S}`)
  console.log('='.repeat(96))

  for (const t of ['parts', 'part_fitment', 'part_supersession', 'part_cross_reference', 'inventory']) {
    const res = await fetch(`${S}/rest/v1/${t}?select=id&limit=1`, { headers: H })
    record(`table ${t} exists`, res.ok, res.ok ? 'readable' : `${res.status} ${(await res.text()).slice(0, 80)}`)
  }

  // A probe part, so the generated columns and the fitment constraints can be tried for
  // real. Deleted at the end whatever happens.
  const PROBE = 'ZZ-PROBE-148'
  await del('parts', `part_number=eq.${PROBE}`)
  try {
    const made = await post('parts', {
      part_number: PROBE, manufacturer: 'ZZ Probe', part_type: 'Probe',
      description: 'migration 148 verification - delete me',
      belt_section: 'SPZ 1150', source: 'verify-148',
    })
    const part = Array.isArray(made.json) ? (made.json[0] as Record<string, unknown>) : null
    if (!record('a part can be inserted', !!part, part ? '' : `${made.status} ${JSON.stringify(made.json).slice(0, 110)}`)) return

    record('part_number_normalized is GENERATED',
      part!.part_number_normalized === 'ZZPROBE148', String(part!.part_number_normalized))
    record('belt_section_canonical collapses SPZ to XPZ/SPZ',
      part!.belt_section_canonical === 'XPZ/SPZ', String(part!.belt_section_canonical))
    record('verified defaults to FALSE, not true',
      part!.verified === false, String(part!.verified))

    const partId = String(part!.id)

    // The constraint that matters: a group string must be refused outright.
    const GROUPS = [
      ['comma list', 'Supra 650,Supra 750'],
      ['slash list', 'V-500/V-520'],
      ['trailing +', 'SB100-310+'],
      ['series word', 'SB series'],
      ['x-masked family', 'Supra 6xx'],
      ['the word all', 'all units'],
      ['numeric range', 'SB 100-310'],
    ] as const
    for (const [label, value] of GROUPS) {
      const r = await post('part_fitment', { part_id: partId, unit_model: value, source: 'verify-148' })
      const refused = r.status >= 400
      record(`fitment REFUSES a ${label}`, refused, refused ? `-> ${r.status} "${value}"` : `ACCEPTED "${value}" - the constraint is not doing its job`)
      if (!refused) await del('part_fitment', `part_id=eq.${partId}`)
    }

    // And a single model must be accepted, or the table is useless.
    const ok1 = await post('part_fitment', { part_id: partId, unit_model: 'Supra 660', source: 'verify-148' })
    record('fitment ACCEPTS a single model', ok1.status < 400, `-> ${ok1.status} "Supra 660"`)

    // Compressor-only fitment: no unit_model at all, which must be allowed.
    const ok2 = await post('part_fitment', { part_id: partId, compressor_model: 'X430', source: 'verify-148' })
    record('fitment ACCEPTS compressor-only (no unit_model)', ok2.status < 400, `-> ${ok2.status} "X430"`)

    // A row naming nothing must be refused.
    const bad = await post('part_fitment', { part_id: partId, source: 'verify-148' })
    record('fitment REFUSES a row naming nothing', bad.status >= 400, `-> ${bad.status}`)

    // Supersession cannot point at itself.
    const selfSup = await post('part_supersession', {
      old_number: 'AA-1', new_number: 'AA1', manufacturer: 'ZZ Probe', source: 'verify-148',
    })
    record('supersession REFUSES old == new after normalizing', selfSup.status >= 400, `-> ${selfSup.status} (AA-1 vs AA1)`)

    // Does parts carry a vendor price column? The CSV has one and 148 did not add it.
    const priceProbe = await fetch(`${S}/rest/v1/parts?select=vendor_price&limit=1`, { headers: H })
    record('parts.vendor_price exists (expected MISSING before 149)',
      !priceProbe.ok, priceProbe.ok ? 'present' : 'absent - vendor_price_usd has nowhere to load')
  } finally {
    await del('part_fitment', `part_id=in.(select id from parts where part_number=eq.${PROBE})`)
    await del('parts', `part_number=eq.${PROBE}`)
    await del('part_supersession', `manufacturer=eq.ZZ%20Probe`)
    const left = await (await fetch(`${S}/rest/v1/parts?part_number=eq.${PROBE}&select=id`, { headers: H })).json() as unknown[]
    record('probe rows deleted', Array.isArray(left) && left.length === 0, `parts rows left ${Array.isArray(left) ? left.length : '?'}`)
  }

  const failed = rows.filter(r => !r.ok)
  console.log('='.repeat(96))
  console.log(`  ${rows.length - failed.length} passed, ${failed.length} failed`)
  failed.forEach(f => console.log(`    ${f.step} -- ${f.detail}`))
  console.log('='.repeat(96) + '\n')
  process.exitCode = failed.length ? 1 : 0
}

main()
