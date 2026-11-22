// npx tsx scripts/verify-parts-narrow.ts
//
// The chart narrowing (src/lib/parts/narrow.ts), Brock's Part 4 rulings, Nov 22, 2026.
// Pure: no database. EVERY FIXTURE IS A REAL ROW - copied from part_fitment as read
// (read-only) on Nov 22, 2026: part number, unit model, bounds, mount, configuration,
// confidence and verified exactly as stored. The role column (migration 191) is filled the
// way 191 fills it, from the chart CSV's part_type column for that line.

import {
  buildDateApplies, narrowUnitRows, parseBuildDate, partMountsOf, roleMatches, unitModelMatches, unitMountOf,
  PRECEDENT_MODELS, type NarrowRow,
} from '../src/lib/parts/narrow'
import { followChain, bestTrust, badgeOf, CONFIDENCE_TIERS, displayOf, type SupersessionLink } from '../src/lib/parts/counter'

let pass = 0, fail = 0
function check(step: string, ok: boolean, detail = ''): void {
  if (ok) pass++; else fail++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${step}${detail ? '  -- ' + detail : ''}`)
}

const C = { tier: 'confirmed' as const, verified: true }      // the chart load
const V = { tier: null, verified: true }                      // brock-carrier-chart (pre-175 verified)
const U = { tier: 'unconfirmed' as const, verified: false }   // reefer-parts-master and the seeds
const N = { tier: null, verified: false }                     // nwi-hd-parts-053 and the imports

let n = 0
function row(part: string, family: string, o: Partial<NarrowRow> = {}): NarrowRow {
  return {
    id: `r${++n}`, part_id: part, family, engine: null, serial_from: null, serial_before: null,
    build_date_from: null, build_date_before: null, mount_type: null, configuration: null, role: null, trust: U, ...o,
  }
}
const parts = (rows: NarrowRow[]) => [...new Set(rows.map(r => r.part_id))].sort()

console.log('\n1. Unit model: the nine Precedent names')
check('nine models, as charted', PRECEDENT_MODELS.length === 9)
check('"S-600" is "Precedent S-600"', unitModelMatches('S-600', 'Precedent S-600') && unitModelMatches('Precedent S-600', 'S-600'))
check('"C-600M" is "Precedent C-600M"', unitModelMatches('Precedent C-600M', 'c600m'))
check('S-600 is not S-600M', !unitModelMatches('S-600M', 'Precedent S-600'))
check('S-610 is not in the ruling, so not aliased', !unitModelMatches('S-610', 'Precedent S-610'))
check('a catch-all still never matches', !unitModelMatches('All TK', 'S-600'))

console.log('\n2. Build dates')
check('2023-07 reads as 2023-07-01', parseBuildDate('2023-07') === '2023-07-01')
check('07/2023 reads as 2023-07-01', parseBuildDate('07/2023') === '2023-07-01')
check('2013 reads as 2013-01-01', parseBuildDate('2013') === '2013-01-01')
check('nonsense is refused, not guessed', parseBuildDate('July') === null && parseBuildDate('2023-13') === null)
check('before 2023-07-01: built 2023-06 fits', buildDateApplies({ build_date_before: '2023-07-01' }, '2023-06-01'))
check('before 2023-07-01: built 2023-07 does not', !buildDateApplies({ build_date_before: '2023-07-01' }, '2023-07-01'))
check('from 2023-07-01: built 2023-07 fits', buildDateApplies({ build_date_from: '2023-07-01' }, '2023-07-01'))

console.log('\n3. Ultra air filter (Carrier): weaker rows lose to the chart, a serial narrows to one')
// part_fitment, unit_model Ultra, Filter - air.
const ultra = [
  row('30-00426-20', 'Filter - air', { trust: U }),
  row('30-00426-27', 'Filter - air', { trust: U }),
  row('30-00430-00', 'Filter - air', { trust: V, serial_from: 'GAG90483303' }),
  row('30-00430-00', 'Filter - air', { trust: C, serial_from: 'GAG90483303', mount_type: 'trailer', role: 'Air filter' }),
  row('30-00430-23', 'Filter - air', { trust: U }),
  row('30-00471-20', 'Filter - air', { trust: U }),
  row('30-01077-01', 'Filter - air', { trust: V, serial_before: 'GAG90483303' }),
  row('30-01077-01', 'Filter - air', { trust: C, serial_before: 'GAG90483303', mount_type: 'trailer', role: 'Air filter' }),
]
// 30-00426-27 and 30-00471-20 are charted trailer-only on other units (they are filters for
// trailer units); 30-00430-00 and 30-01077-01 trailer as above.
const ultraMounts = partMountsOf([
  { part_id: '30-00426-27', mount_type: 'trailer' }, { part_id: '30-00471-20', mount_type: 'trailer' },
  { part_id: '30-00430-00', mount_type: 'trailer' }, { part_id: '30-01077-01', mount_type: 'trailer' },
])
const u1 = narrowUnitRows(ultra, {}, ultraMounts)
check('both serial sides, and only them', parts(u1.kept).join() === '30-00430-00,30-01077-01', parts(u1.kept).join())
check('the four unconfirmed filters are suppressed, not lost', parts(u1.suppressed.map(s => s.row)).join() === '30-00426-20,30-00426-27,30-00430-23,30-00471-20',
  parts(u1.suppressed.map(s => s.row)).join())
check('the suppression says why', u1.suppressed.every(s => /chart covers Filter - air/.test(s.reason)))
const u2 = narrowUnitRows(ultra, { serial: 'GAG90000000' }, ultraMounts)
check('an early serial narrows it to one: 30-01077-01', parts(u2.kept).join() === '30-01077-01', parts(u2.kept).join())
check('...and the weak rows still do not come back', u2.suppressed.length === 4)
const u3 = narrowUnitRows(ultra, { serial: 'GAG90500000' }, ultraMounts)
check('a late serial narrows it to 30-00430-00', parts(u3.kept).join() === '30-00430-00', parts(u3.kept).join())

console.log('\n4. Mount: no truck-only part on a trailer unit')
// 30-00302-00 is charted truck-only; reefer-parts-master put it on the Ultra (a trailer unit).
const ultraUnit = [{ mount_type: 'trailer' }, { mount_type: null }]
const m1 = narrowUnitRows([row('30-00302-00', 'Filter - fuel', { trust: U })], {}, partMountsOf([{ part_id: '30-00302-00', mount_type: 'truck' }]), ultraUnit)
check('the unit mount is read from its rows: trailer', m1.unitMount === 'trailer' && unitMountOf(ultraUnit) === 'trailer')
check('30-00302-00 (truck only) is not offered for the Ultra', m1.kept.length === 0 && m1.excluded.mount === 1, JSON.stringify(m1.excluded))
// 30-01090-05 fits both (Ultra trailer AND Supra truck): never dropped by mount.
const m2 = narrowUnitRows([row('30-01090-05', 'Filter - fuel', { trust: V })], {}, partMountsOf([
  { part_id: '30-01090-05', mount_type: 'truck' }, { part_id: '30-01090-05', mount_type: 'trailer' }]), ultraUnit)
check('30-01090-05 (truck and trailer) stays on a trailer unit', m2.kept.length === 1)
const m3 = narrowUnitRows([row('X', 'Belt', { mount_type: 'truck', trust: C })], { mount: 'trailer' }, new Map())
check('a row charted for the other mount is out', m3.kept.length === 0)

console.log('\n5. SB-200 (Thermo King) drive belt: 78-0629 and only 78-0629')
const sb = [
  row('204-0427', 'Belt', { trust: U }), row('77-1139', 'Belt', { trust: U }), row('77-1954', 'Belt', { trust: U }),
  row('78-0603', 'Belt', { trust: N }), row('78-0603', 'Belt', { trust: C, mount_type: 'trailer', role: 'Condenser belt' }),
  row('78-0629', 'Belt', { trust: N }), row('78-0629', 'Belt', { trust: C, mount_type: 'trailer', role: 'Drive belt' }),
  row('78-0785', 'Belt', { trust: U }), row('78-0844', 'Belt', { trust: U }), row('78-0845', 'Belt', { trust: U }),
  row('78-1341', 'Belt', { trust: N }), row('78-1341', 'Belt', { trust: C, mount_type: 'trailer', role: 'Alternator/water pump belt' }),
  row('78-1360', 'Belt', { trust: N }), row('78-1968', 'Belt', { trust: N }),
]
const s1 = narrowUnitRows(sb, { words: 'drive belt' }, new Map())
check('"drive belt" returns 78-0629 only', parts(s1.kept).join() === '78-0629', parts(s1.kept).join())
const s2 = narrowUnitRows(sb, {}, new Map())
check('every SB-200 belt the chart lists, and only those', parts(s2.kept).join() === '78-0603,78-0629,78-1341', parts(s2.kept).join())
check('"belt" names every belt, so it narrows nothing more', parts(narrowUnitRows(sb, { words: 'belt' }, new Map()).kept).join() === '78-0603,78-0629,78-1341')
check('a role is matched on its words', roleMatches('Alternator/water pump belt', 'water pump belt') && !roleMatches('Drive belt', 'condenser belt'))

console.log('\n6. Precedent C-600 generator belt: configuration decides, never two unexplained hits')
const c600 = [
  row('78-1858', 'Belt', { trust: U }), row('78-1858', 'Belt', { trust: N }),
  row('78-1858', 'Belt', { trust: C, mount_type: 'trailer', configuration: 'with smart power', role: 'Generator belt' }),
  row('78-1859', 'Belt', { trust: U }), row('78-1859', 'Belt', { trust: N }),
  row('78-1859', 'Belt', { trust: C, mount_type: 'trailer', configuration: 'with alternator', role: 'Generator belt' }),
  row('78-1865', 'Belt', { trust: C, mount_type: 'trailer', configuration: '12 hp', role: 'Supplemental alternator belt' }),
  row('78-1866', 'Belt', { trust: C, mount_type: 'trailer', configuration: '19 hp', role: 'Supplemental alternator belt' }),
  row('78-1968', 'Belt', { trust: C, mount_type: 'trailer', role: 'Water pump belt' }),
  row('78-1833', 'Belt', { trust: N }),
]
const g1 = narrowUnitRows(c600, { words: 'generator belt', configuration: 'with smart power' }, new Map())
check('generator belt + smart power: 78-1858, not 78-1859', parts(g1.kept).join() === '78-1858', parts(g1.kept).join())
const g2 = narrowUnitRows(c600, { words: 'generator belt' }, new Map())
check('without a configuration both come back ...', parts(g2.kept).join() === '78-1858,78-1859', parts(g2.kept).join())
const choice = g2.configurationChoices.find(c => c.role === 'Generator belt')
check('... with the choice put plainly: with alternator / with smart power',
  !!choice && choice.options.map(o => `${o.configuration}=${o.part_ids.join()}`).join('; ') === 'with alternator=78-1859; with smart power=78-1858',
  JSON.stringify(g2.configurationChoices))
const g3 = narrowUnitRows(c600, {}, new Map())
check('each role gets its own choice (generator, supplemental alternator)', g3.configurationChoices.length === 2,
  g3.configurationChoices.map(c => c.role).join(', '))
check('78-1833 (an unverified import, no chart row) is suppressed on the covered belts', g3.suppressed.some(s => s.row.part_id === '78-1833'))

console.log('\n7. Blank engine is a fallback, not a wildcard (Precedent S-600M fuel filter)')
// 11-9965 on Precedent S-600M: standard group before 2021-06; Peugeot before 2023-07.
const s600m = [
  row('11-9965', 'Filter - fuel', { trust: C, build_date_before: '2021-06-01', mount_type: 'trailer', configuration: 'standard' }),
  row('11-9965', 'Filter - fuel', { trust: C, engine: 'Peugeot', build_date_before: '2023-07-01', mount_type: 'trailer', configuration: 'standard' }),
  row('11-9958', 'Filter - fuel', { trust: C, mount_type: 'trailer' }),
  row('11-9958', 'Filter - fuel', { trust: C, engine: 'Peugeot', mount_type: 'trailer' }),
  row('11-9969', 'Filter - fuel', { trust: C, build_date_from: '2021-06-01', mount_type: 'trailer', configuration: 'primary, EMI 3000' }),
  // The bare-name rows from reefer-parts-master (unit_model "S-600M"): unconfirmed, date-bounded.
  row('11-9969', 'Filter - fuel', { trust: U, build_date_from: '2021-06-01' }),
  row('11-9967', 'Filter - fuel', { trust: C, build_date_from: '2021-06-01', mount_type: 'trailer', configuration: 'secondary, EMI 3000' }),
  row('11-9967', 'Filter - fuel', { trust: U, build_date_from: '2021-06-01' }),
]
const e1 = narrowUnitRows(s600m, { engine: 'Peugeot', buildDate: '2022-03-01' }, new Map())
check('Peugeot, built 2022-03: the Peugeot rows, not the standard group',
  e1.kept.every(r => r.engine === 'Peugeot') && parts(e1.kept).join() === '11-9958,11-9965', e1.kept.map(r => `${r.part_id}/${r.engine}`).join(', '))
check('the standard rows went as the fallback they are', e1.excluded.engine_fallback >= 2, JSON.stringify(e1.excluded))
check('...and the unconfirmed dated rows for 11-9967/11-9969 do not bring them back', !e1.kept.some(r => r.part_id === '11-9967' || r.part_id === '11-9969')
  && e1.suppressed.filter(s => /chart's own row/.test(s.reason)).length === 2, e1.suppressed.map(s => s.row.part_id).join(', '))
const e2 = narrowUnitRows(s600m, { engine: 'TK 3.95' }, new Map())
check('an engine no row names: the standard (blank) group stands', e2.kept.length > 0 && e2.kept.every(r => !r.engine), e2.kept.map(r => `${r.part_id}/${r.engine}`).join(', '))
const e3 = narrowUnitRows(s600m, { buildDate: '2022-03-01' }, new Map())
check('no engine named: both groups shown, each labelled with its engine', e3.kept.some(r => r.engine === 'Peugeot') && e3.kept.some(r => !r.engine))

console.log('\n8. Contradicted rows are never an answer')
const k1 = narrowUnitRows([row('30-00302-00', 'Filter - fuel', { trust: { tier: 'conflict', verified: false } })], {}, new Map())
check('confidence conflict: out', k1.kept.length === 0 && k1.suppressed.length === 0 && k1.excluded.conflict === 1)

console.log('\n9. A chart row\'s bounds beat a weaker broader row for the same part')
const b1 = narrowUnitRows([
  row('P', 'Filter - oil (engine)', { trust: C, serial_from: 'GAG90483303' }),
  row('P', 'Filter - oil (engine)', { trust: U }),
], { serial: 'GAG90000000' }, new Map())
check('the serial rules the chart row out; the unbounded one does not bring P back', b1.kept.length === 0 && b1.suppressed.length === 1, b1.suppressed[0]?.reason)

console.log('\n10. Supersession: conditional replacements are all shown (11-9958, Brock\'s ruling)')
const L = (o: string, nw: string, note: string): SupersessionLink => ({
  old_number: o, new_number: nw, old_number_normalized: o.replace(/-/g, ''), new_number_normalized: nw.replace(/-/g, ''),
  manufacturer: 'Thermo King', note, verified: true, confidence: 'confirmed',
})
const three = [
  L('11-9958', '11-9965', 'standard duty, built before 7/2023'),
  L('11-9958', '11-9966', 'severe duty, built before 7/2023'),
  L('11-9958', '11-9970', 'built 7/2023 and after'),
]
const ch = followChain('11-9958', '119958', three)
check('the chain stops at 11-9958 and offers all three', ch.current === '11-9958' && ch.branches.map(b => b.to).join() === '11-9965,11-9966,11-9970',
  ch.branches.map(b => b.to).join())
check('each with its condition', ch.branches.every(b => !!b.note))
const one = followChain('30-01121-00', '300112100', [{ old_number: '30-01121-00', new_number: '30-60143-01', old_number_normalized: '300112100',
  new_number_normalized: '306014301', manufacturer: 'Carrier Transicold', note: null, verified: true, confidence: null }])
check('one followable link is still followed', one.current === '30-60143-01' && one.branches.length === 0)

console.log('\n11. The badge for every confidence tier')
for (const t of CONFIDENCE_TIERS) console.log(`        ${t.padEnd(15)} -> "${badgeOf({ tier: t, verified: false })}"  (${displayOf({ tier: t, verified: false })})`)
console.log(`        ${'(none) verified'.padEnd(15)} -> "${badgeOf({ tier: null, verified: true })}"  (${displayOf({ tier: null, verified: true })})`)
console.log(`        ${'(none)'.padEnd(15)} -> "${badgeOf({ tier: null, verified: false })}"  (${displayOf({ tier: null, verified: false })})`)
check('a chart row reads "confirmed", ahead of an older verified row for the same part',
  badgeOf(bestTrust([V, C])!) === 'confirmed' && badgeOf(bestTrust([C, V])!) === 'confirmed')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
