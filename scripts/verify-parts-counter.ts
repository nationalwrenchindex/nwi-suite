// npx tsx scripts/verify-parts-counter.ts
//
// The parts counter's rules (src/lib/parts/counter.ts), tested as pure functions. It
// imports the shipped rules rather than restating them, so a rule that changes breaks
// this test instead of quietly passing it. No database, no session.
//
// The supersession cases use the shapes the seed questions are about: an unconfirmed
// renumbering must never push its new number above the old one, and a chain must stop
// at the first link nobody vouched for.

import {
  displayOf, badgeOf, adviceOf, trustRank, bestTrust, followChain, followable,
  categoryOf, groupTypes, typeSynonymMatches, inScope, bmInRange,
  type SupersessionLink,
} from '../src/lib/parts/counter'

let failed = 0
function check(step: string, ok: boolean, detail = ''): void {
  if (!ok) failed++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${step}${detail ? '  -- ' + detail : ''}`)
}

const link = (o: string, n: string, extra: Partial<SupersessionLink> = {}): SupersessionLink => ({
  old_number: o, new_number: n,
  old_number_normalized: o.replace(/[^0-9A-Z]/gi, '').toUpperCase(),
  new_number_normalized: n.replace(/[^0-9A-Z]/gi, '').toUpperCase(),
  manufacturer: 'Thermo King', note: null, verified: false, confidence: null, ...extra,
})
const norm = (s: string) => s.replace(/[^0-9A-Z]/gi, '').toUpperCase()

console.log('\nTRUST: the four screens of spec section 4')
check('confirmed shows plainly',              displayOf({ tier: 'confirmed', verified: false }) === 'plain')
check('oem_matrix shows plainly',             displayOf({ tier: 'oem_matrix', verified: false }) === 'plain')
check('field_observed is its own screen',     displayOf({ tier: 'field_observed', verified: false }) === 'observed')
check('dealer is one source',                 displayOf({ tier: 'dealer', verified: true }) === 'one_source', 'the tier wins over verified')
check('derived is one source',                displayOf({ tier: 'derived', verified: false }) === 'one_source')
check('unconfirmed is one source',            displayOf({ tier: 'unconfirmed', verified: false }) === 'one_source')
check('conflict is its own screen',           displayOf({ tier: 'conflict', verified: true }) === 'conflict')
check('pre-175 verified row shows plainly',   displayOf({ tier: null, verified: true }) === 'plain')
check('pre-175 unverified row is one source', displayOf({ tier: null, verified: false }) === 'one_source')
check('a pre-175 row is never given a tier name', badgeOf({ tier: null, verified: true }) === 'verified' && badgeOf({ tier: null, verified: false }) === 'unverified')
check('a tier reads as words',                badgeOf({ tier: 'oem_matrix', verified: false }) === 'oem matrix')
check('one source says verify by serial',     /verify by serial/.test(adviceOf('one_source') ?? ''))
check('conflict says sources disagree',       /Sources disagree/.test(adviceOf('conflict') ?? ''))
check('plain carries no warning',             adviceOf('plain') === null)
check('confirmed ranks above unconfirmed',    trustRank({ tier: 'confirmed', verified: false }) < trustRank({ tier: 'unconfirmed', verified: true }))
check('conflict ranks last',                  trustRank({ tier: 'conflict', verified: true }) > trustRank({ tier: 'unconfirmed', verified: false }))
check('best of several claims is the most trusted',
  bestTrust([{ tier: 'unconfirmed', verified: false }, { tier: 'oem_matrix', verified: false }])?.tier === 'oem_matrix')

console.log('\nSUPERSESSION: follow only what someone vouched for')
// The one live row: Carrier 30-01121-00 -> 30-60143-01, verified, from Brock's chart.
const live = link('30-01121-00', '30-60143-01', { verified: true, manufacturer: 'Carrier Transicold' })
const c1 = followChain('30-01121-00', norm('30-01121-00'), [live])
check('a verified link (pre-175) is followed', c1.current === '30-60143-01' && c1.was.join() === '30-01121-00', `${c1.current} was ${c1.was.join()}`)

// Seed question S3: 11-9341 -> 13-3675 is unconfirmed, and 11-9341 has 41 confirmed rows.
const s3 = link('11-9341', '13-3675', { confidence: 'unconfirmed' })
const c2 = followChain('11-9341', norm('11-9341'), [s3])
check('an unconfirmed renumbering is NOT substituted', c2.current === '11-9341' && c2.was.length === 0, c2.current)
check('...but it is reported',                c2.reported?.to === '13-3675' && c2.reported.trust.tier === 'unconfirmed')

// The chain 11-9098 -> 11-9341 -> 13-3675: followed one hop, stopped at the unconfirmed one.
const c3 = followChain('11-9098', norm('11-9098'), [link('11-9098', '11-9341', { confidence: 'confirmed' }), s3])
check('a chain stops at the first weak link', c3.current === '11-9341' && c3.was.join() === '11-9098' && c3.reported?.to === '13-3675',
  `${c3.current} was ${c3.was.join()} reported ${c3.reported?.to}`)

const c4 = followChain('A-1', 'A1', [link('A-1', 'B-1', { confidence: 'oem_matrix' }), link('B-1', 'A-1', { confidence: 'oem_matrix' })])
check('a cycle in the data does not hang',    c4.current === 'B-1' && c4.was.join() === 'A-1', c4.current)
check('dealer links are not followed',        !followable({ confidence: 'dealer', verified: true }))
check('a tier overrides verified',            !followable({ confidence: 'conflict', verified: true }))
check('an unverified pre-175 link is not followed', !followable({ confidence: null, verified: false }))

console.log('\nPART TYPES: flat list, category as a header, synonyms')
check('oil filter -> Maintenance & Wear',     categoryOf('Filter - oil (engine)') === 'Maintenance & Wear')
check('fuel filter -> Fuel',                  categoryOf('Filter - fuel') === 'Fuel')
check('water separator -> Fuel',              categoryOf('Filter - water separator') === 'Fuel')
check('starter -> Engine',                    categoryOf('Starter') === 'Engine')
check('cab air filter -> Air Flow & Structure', categoryOf('Filter - cab air') === 'Air Flow & Structure')
const g = groupTypes(['Starter', 'Filter - fuel', 'Filter - oil (engine)', 'Starter'])
check('groups follow the spec order, no duplicates', g.map(x => x.category).join('|') === 'Engine|Fuel|Maintenance & Wear' && g[0].types.length === 1)
check('"lube filter" finds the oil filter',    typeSynonymMatches('Filter - oil (engine)', 'lube filter'))
check('"lube filter" does not find the fuel filter', !typeSynonymMatches('Filter - fuel', 'lube filter'))
check('"cranking motor" finds the starter',    typeSynonymMatches('Starter', 'cranking motor'))
check('"sep" finds the water separator',       typeSynonymMatches('Filter - water separator', 'sep'))
check('"air cleaner" finds the air filter',    typeSynonymMatches('Filter - air', 'air cleaner'))
check('a number is never read as a type',      !typeSynonymMatches('Filter - oil (engine)', '11-9182'))

console.log('\nSCOPE: one code path, a data filter')
check('HD sees every part',                   inScope('truck', 'all'))
check('Reefer sees reefer parts',             inScope('reefer', 'reefer'))
check('Reefer sees pre-175 rows (all from reefer sources)', inScope(null, 'reefer'))
check('Reefer does not see a truck part',     !inScope('truck', 'reefer'))

console.log('\nBM RANGES (migration 175)')
check('inside the range',                     bmInRange('920381', '920000', '929999') === true)
check('compared as numbers, not strings',     bmInRange('99', '100', '200') === false)
check('a single-BM row (no end) matches only itself', bmInRange('920381', '920381', null) === true && bmInRange('920382', '920381', null) === false)
check('unreadable is reported, not guessed',  bmInRange('ABC', '100', '200') === null)

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS')
if (failed) process.exit(1)
