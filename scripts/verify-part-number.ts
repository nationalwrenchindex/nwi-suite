// npx tsx scripts/verify-part-number.ts
//
// The part number normalizer (src/lib/parts/part-number.ts), tested as pure functions
// against Brock's five numbering rules and the ways a typed number goes wrong. It
// imports the shipped function, so a rule that changes breaks this test instead of
// quietly passing it. No database, no session.
//
// The "real shapes" cases are numbers that are actually in parts / hd_parts / the
// Grok CSV today (Oct 28 survey), not invented ones.

import { parsePartNumber, partNumberSearchKeys, partNumberMatches, partNumberKey, type PartNumberForm } from '../src/lib/parts/part-number'

let failed = 0
function check(step: string, ok: boolean, detail = ''): void {
  if (!ok) failed++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${step}${detail ? '  -- ' + detail : ''}`)
}
function is(input: string, canonical: string, form: PartNumberForm, extra: { relatesTo?: string | null; stripped37?: boolean; suffix?: string | null } = {}) {
  const p = parsePartNumber(input)
  const ok = p.canonical === canonical && p.form === form && p.key === partNumberKey(canonical) &&
    (extra.relatesTo === undefined || p.relatesTo === extra.relatesTo) &&
    (extra.stripped37 === undefined || p.stripped37 === extra.stripped37) &&
    (extra.suffix === undefined || p.suffix === extra.suffix)
  check(`${JSON.stringify(input)} -> ${canonical} (${form})`, ok,
    ok ? '' : `got ${p.canonical} (${p.form}) relatesTo=${p.relatesTo} stripped37=${p.stripped37} suffix=${p.suffix}`)
}

console.log('\nRULE 1: Thermo King OEM, 6 digits, dash after the first two')
is('11-9959', '11-9959', 'thermo_king', { stripped37: false, relatesTo: null })
is('119959', '11-9959', 'thermo_king')
is('78-1341', '78-1341', 'thermo_king')

console.log('\nRULE 2: Carrier, 9 digits, dashes after the first two and before the last two')
is('30-60143-01', '30-60143-01', 'carrier')
is('306014301', '30-60143-01', 'carrier')
is('50-00178-27', '50-00178-27', 'carrier')

console.log('\nTK vs CARRIER told apart by digit count and dash position')
check('6 digits is Thermo King', parsePartNumber('119959').maker === 'thermo_king')
check('9 digits is Carrier', parsePartNumber('306014301').maker === 'carrier')
check('dashes 2-4 is Thermo King', parsePartNumber('11-9959').maker === 'thermo_king')
check('dashes 2-5-2 is Carrier', parsePartNumber('30-60143-01').maker === 'carrier')
is('3060-1430-1', '3060-1430-1', 'other')   // 9 digits, wrong dash places: not laid out as Carrier

console.log('\nRULE 3: a leading 37- is the vendor\'s, not the number - strip it')
is('37-11-9959', '11-9959', 'thermo_king_37', { stripped37: true })
is('37119959', '11-9959', 'thermo_king_37', { stripped37: true })
is('37-119959', '11-9959', 'thermo_king_37', { stripped37: true })
is('37 11 9959', '11-9959', 'thermo_king_37', { stripped37: true })
is('37-30-60143-01', '30-60143-01', 'carrier_37', { stripped37: true })
is('37306014301', '30-60143-01', 'carrier_37', { stripped37: true })
check('37-11-9959 and 11-9959 are the same key', parsePartNumber('37-11-9959').key === parsePartNumber('11-9959').key)
console.log('  real 37- shapes from hd_parts:')
is('37-13-506', '13-506', 'other_37', { stripped37: true })
is('37-203-799', '203-799', 'other_37', { stripped37: true })
is('37-11-6182E', '11-6182E', 'thermo_king_37', { stripped37: true, suffix: 'E' })
is('37-44-9181-KIT', '44-9181-KIT', 'thermo_king_37', { stripped37: true, suffix: 'KIT' })
is('37-EGR-KIT', 'EGR-KIT', 'other_37', { stripped37: true })
console.log('  a number that already IS one of the two shapes is never stripped:')
is('37-1234', '37-1234', 'thermo_king', { stripped37: false })
is('371234', '37-1234', 'thermo_king', { stripped37: false })
is('37-12345-67', '37-12345-67', 'carrier', { stripped37: false })
is('37123', '37123', 'other', { stripped37: false })

console.log('\nRULE 4: 20- on a TK number is Carrier aftermarket for a TK unit - recognized, NOT rewritten')
is('20-11-9959', '20-11-9959', 'carrier_for_thermo_king', { relatesTo: '11-9959' })
is('20119959', '20-11-9959', 'carrier_for_thermo_king', { relatesTo: '11-9959' })
check('20-11-9959 is NOT the key of 11-9959', parsePartNumber('20-11-9959').key !== parsePartNumber('11-9959').key)
check('relatesTo is not a search key', !partNumberSearchKeys('20-11-9959').includes('119959'))
is('20-1234', '20-1234', 'thermo_king', { relatesTo: null })   // a TK number that starts 20

console.log('\nRULE 5: an 8 on the front of the first segment is reman - recognized, NOT rewritten')
is('845-1234', '845-1234', 'thermo_king_reman', { relatesTo: '45-1234' })
is('8451234', '845-1234', 'thermo_king_reman', { relatesTo: '45-1234' })
is('830-60143-01', '830-60143-01', 'carrier_reman', { relatesTo: '30-60143-01' })
check('845-1234 is NOT the key of 45-1234', parsePartNumber('845-1234').key !== parsePartNumber('45-1234').key)
check('reman relatesTo is not a search key', !partNumberSearchKeys('845-1234').includes('451234'))

console.log('\nNOISE: whitespace, case, separators')
is('  11-9959  ', '11-9959', 'thermo_king')
is('11 9959', '11-9959', 'thermo_king')
is('11.9959', '11-9959', 'thermo_king')
is('11--9959', '11-9959', 'thermo_king')
is('50-00215-01sv', '50-00215-01SV', 'carrier', { suffix: 'SV' })
is(' 37-41-5459-kit ', '41-5459-KIT', 'thermo_king_37', { suffix: 'KIT' })

console.log('\nREAL SHAPES OUTSIDE THE RULES: kept exactly, still searchable')
is('78-266', '78-266', 'other')
is('306-221', '306-221', 'other')
is('204-2436', '204-2436', 'other')
is('18-00091-105', '18-00091-105', 'other')
is('96-153-01K', '96-153-01K', 'other', { suffix: 'K' })
is('023Z0050', '023Z0050', 'other')
is('038-00034-001', '038-00034-001', 'other')

console.log('\nFAILURE CASES: nothing invented')
is('', '', 'empty')
is('   ', '', 'empty')
is('---', '', 'empty')
is('belt', 'BELT', 'other')
is('1199', '1199', 'other')
is('1199599', '1199599', 'other')     // 7 digits, no 8 in front: not TK, not reman
check('empty input has no search keys', partNumberSearchKeys('').length === 0)
check('a junk number does not become a TK number', parsePartNumber('11995').maker === null)

console.log('\nSEARCHING ANY FORM FINDS THE PART')
for (const typed of ['11-9959', '119959', '37-11-9959', '37119959', ' 37 11 9959 ', '11 9959'])
  check(`stored 11-9959 is found by ${JSON.stringify(typed)}`, partNumberMatches('11-9959', typed))
for (const typed of ['30-60143-01', '306014301', '30 60143 01', '37-30-60143-01'])
  check(`stored 30-60143-01 is found by ${JSON.stringify(typed)}`, partNumberMatches('30-60143-01', typed))
check('a row still stored as 37-11-9959 is found by 11-9959', partNumberMatches('37-11-9959', '11-9959'))
check('a row still stored as 37-11-9959 is found by 37-11-9959', partNumberMatches('37-11-9959', '37-11-9959'))
check('11-9959 does not find 11-9958', !partNumberMatches('11-9958', '11-9959'))
check('the key matches the database generator (uppercase alphanumerics)', partNumberKey('ab-12 3/4') === 'AB1234')

console.log(failed ? `\n${failed} FAILED` : '\nALL PASS')
process.exit(failed ? 1 : 0)
