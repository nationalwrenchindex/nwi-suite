// Pure test of the serial -> unit rule. No database.
//   npx tsx scripts/verify-unit-match.ts

import { matchUnitBySerial } from '../src/lib/hd/unit-match'

const units = [
  { id: 'a', serial_number: '6001241923' },
  // The taylor oil company duplicate: one serial on two units.
  { id: 'b1', serial_number: '1htlfuxn4eha38995' },
  { id: 'b2', serial_number: '1HTLFUXN4EHA38995' },
  { id: 'c', serial_number: null },
]

const cases: Array<[string, string | null | undefined, string | null]> = [
  ['exact match links',                '6001241923',          'a'],
  ['trimmed and case-insensitive',     '  6001241923 ',       'a'],
  ['a serial on two units links none', '1htlfuxn4eha38995',   null],
  ['no unit with that serial',         '999',                 null],
  ['blank links nothing',              '   ',                 null],
  ['null links nothing',               null,                  null],
  ['dashes are not stripped',          '6001-241923',         null],
]

let failed = 0
for (const [name, input, want] of cases) {
  const got = matchUnitBySerial(units, input)?.id ?? null
  const ok = got === want
  if (!ok) failed++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${ok ? '' : `  -- got ${got}, want ${want}`}`)
}
console.log(`\n${cases.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
