// Pure test of the serial + model -> unit rule (src/lib/hd/unit-match.ts). No database.
//   npx tsx scripts/verify-unit-match.ts
//
// Fixtures are copied from real hd_units rows (read Nov 23, 2026): the demo account's
// 53177 / test001 pair and the two S-610M units sharing a serial, and C&K's two "103"s.

import { matchUnitBySerialAndModel, UNIT_SERIAL_MISMATCH_NOTICE } from '../src/lib/hd/unit-match'

const units = [
  { id: '53177',   serial_number: '6001241923',        model: 'C-600M' },
  { id: 'test001', serial_number: 'TEST-6001241923',   model: 's-600' },
  { id: '53126',   serial_number: '6001391390',        model: 'S-610M' },
  { id: '53116',   serial_number: '6001391390',        model: 'S-610M' },
  { id: '53132',   serial_number: '6001391396',        model: 'S-610M' },
  { id: '103a',    serial_number: '1htlfuxn4eha38995', model: 's1800' },
  { id: '103b',    serial_number: '1htlfuxn4eha38995', model: 's1800' },
  { id: 'pre',     serial_number: 'PRE-1',             model: 'Precedent S-600' },
  { id: 'none',    serial_number: null,                model: 'S-600' },
]

type Want = { id: string | null; reason: string; notice: boolean }
const cases: Array<[string, string | null | undefined, string | null | undefined, Want]> = [
  // The failure this fixes: the 6001241923 documents read "s-600"; 53177 is a C-600M.
  ['serial matches but the model disagrees: NO link, and the user is told', '6001241923', 's-600',           { id: null, reason: 'model_mismatch', notice: true }],
  ['the same, written "Precedent S-600"',                                 '6001241923', 'Precedent S-600', { id: null, reason: 'model_mismatch', notice: true }],
  ['serial + agreeing model links',                                       '6001241923', 'C-600M',          { id: '53177', reason: 'linked', notice: false }],
  ['model compared normalized ("c600m")',                                  '6001241923', 'c600m',           { id: '53177', reason: 'linked', notice: false }],
  ['a blank model never agrees - a serial alone never links',             '6001241923', '',                { id: null, reason: 'model_mismatch', notice: true }],
  ['a missing model never agrees either',                                 '6001241923', null,              { id: null, reason: 'model_mismatch', notice: true }],
  ['test001 is NOT found by the bare digits of its TEST- serial',         '6001241923', 's-600',           { id: null, reason: 'model_mismatch', notice: true }],
  ['test001 by its own serial and model',                                 'TEST-6001241923', 's-600',      { id: 'test001', reason: 'linked', notice: false }],
  ['two units pass serial AND model: NO link, and the user is told',      '6001391390', 'S-610M',          { id: null, reason: 'ambiguous', notice: true }],
  ['C&K 103 twice: NO link, and the user is told',                        '1htlfuxn4eha38995', 's1800',    { id: null, reason: 'ambiguous', notice: true }],
  ['53132 (an S-610M) is not an S-600 by serial',                         '6001391396', 'Precedent S-600', { id: null, reason: 'model_mismatch', notice: true }],
  ['Precedent S-600 == S-600 (the counter helper, unchanged)',            'PRE-1', 'S-600',                { id: 'pre', reason: 'linked', notice: false }],
  ['trimmed and case-insensitive serial',                                 '  test-6001241923 ', 's-600',   { id: 'test001', reason: 'linked', notice: false }],
  ['no unit with that serial: nothing linked, nothing to say',            '999', 'S-600',                  { id: null, reason: 'no_match', notice: false }],
  ['blank serial: nothing linked, nothing to say',                        '   ', 'S-600',                  { id: null, reason: 'no_serial', notice: false }],
  ['dashes are not stripped',                                             '6001-241923', 'C-600M',         { id: null, reason: 'no_match', notice: false }],
]

let failed = 0
for (const [name, serial, model, want] of cases) {
  const got = matchUnitBySerialAndModel(units, serial, model)
  const ok = (got.unit?.id ?? null) === want.id && got.reason === want.reason && (got.notice !== null) === want.notice &&
    (!want.notice || got.notice === UNIT_SERIAL_MISMATCH_NOTICE)
  if (!ok) failed++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${ok ? '' : `  -- got ${got.unit?.id ?? null} / ${got.reason} / ${got.notice}`}`)
}
const exact = UNIT_SERIAL_MISMATCH_NOTICE === 'A unit with this serial already exists but its model does not match. Pick the unit yourself or add a new one.'
if (!exact) failed++
console.log(`  ${exact ? 'pass' : 'FAIL'}  the notice is Brock's words exactly`)
console.log(`\n${cases.length + 1 - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
