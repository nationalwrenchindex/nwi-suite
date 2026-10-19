// Unit tests for the equipment-categories screens' rules. Pure - no database.
//   npx tsx scripts/verify-equipment-categories.ts
//
// Covers: category name cleaning and case-insensitive clash checks, reorder planning,
// the set-category request parser, the duplicate-serial messages and the CSV importer's
// pre-insert split, and the PM Schedules chip.
//
// FIXTURES. The unit rows use hd_units' real columns (migration 081: unit_number,
// manufacturer, model, serial_number, active) and the duplicate is the one the spec names
// from Kurt's data - "taylor oil company", unit 103, International, s1800, same serial
// twice (docs/KURT-EQUIPMENT-TRACKING-SPEC.md section 3). The serial string itself is
// not in the spec, so it is a placeholder. The importer rows use the keys the import
// screens send (src/app/hd/import/ImportWizard.tsx, src/components/hd/ImportData.tsx):
// strings straight from the CSV, untrimmed. The categories are migration 161's seed.

import {
  cleanCategoryName, findNameClash, clashMessage, nextSortOrder, planReorder, CATEGORY_NAME_MAX,
  type CategoryLike,
} from '../src/app/api/hd/equipment-categories/rules'
import {
  describeUnit, duplicateSerialMessage, isSerialUniqueViolation, findSerialHolder, ilikeLiteral,
  partitionImportRows, summarizeSkips, type SerialHolder,
} from '../src/app/api/hd/fleet-units/serials'
import { parseSetCategoryBody, MAX_UNITS_PER_REQUEST } from '../src/app/api/hd/fleet-units/unit-category'
import { unitCategoryChip, TRUCK_BLUE, NEUTRAL_CHIP } from '../src/components/hd/UnitCategoryChip'

let failed = 0, passed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) passed++; else failed++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${ok ? '' : `  -- ${detail}`}`)
}
const j = (x: unknown) => JSON.stringify(x)

// Migration 161's seed, as hd_ensure_equipment_categories() writes it.
const SEED: CategoryLike[] = [
  'Reefer Unit', 'Truck', 'Trailer', 'Boom', 'Aerial / Bucket', 'Digger Derrick', 'APU', 'Genset', 'Other',
].map((name, i) => ({ id: `c${i + 1}`, name, sort_order: (i + 1) * 10, is_active: true }))

// ── Category names ─────────────────────────────────────────────────────────
console.log('category names')
{
  const r = cleanCategoryName('  Digger   Derrick ')
  check('trims and collapses inner whitespace', 'name' in r && r.name === 'Digger Derrick', j(r))
  check('blank is refused', 'error' in cleanCategoryName('   '))
  check('non-string is refused', 'error' in cleanCategoryName(42))
  check('over the max is refused', 'error' in cleanCategoryName('x'.repeat(CATEGORY_NAME_MAX + 1)))
  const ok = cleanCategoryName('x'.repeat(CATEGORY_NAME_MAX))
  check('exactly the max is allowed', 'name' in ok)
}

console.log('name clashes (case-insensitive - unit_type lowercases them all)')
{
  check('"truck" clashes with Truck', findNameClash(SEED, 'truck')?.id === 'c2')
  check('"Crane" clashes with nothing', findNameClash(SEED, 'Crane') === null)
  check('renaming Truck to "TRUCK" is not a clash with itself', findNameClash(SEED, 'TRUCK', 'c2') === null)
  check('renaming Boom to "trailer" clashes with Trailer', findNameClash(SEED, 'trailer', 'c4')?.id === 'c3')
  const msg = clashMessage('truck', SEED[1])
  check('clash message names the existing category', msg === 'A category named "Truck" already exists.', msg)
  const inactive = { ...SEED[6], is_active: false }
  const msg2 = clashMessage('apu', inactive)
  check('clash with a deactivated one says reactivate', /deactivated - reactivate it/.test(msg2), msg2)
}

console.log('sort order')
{
  check('a new category goes after the last (90 -> 100)', nextSortOrder(SEED) === 100)
  check('an empty shop starts at 10', nextSortOrder([]) === 10)
  const gappy = [{ ...SEED[0], sort_order: 5 }, { ...SEED[1], sort_order: 77 }]
  check('uses the max, not the count', nextSortOrder(gappy) === 87)
}

console.log('reorder')
{
  const ids = SEED.map(c => c.id)
  const same = planReorder(SEED, ids)
  check('the same order changes nothing', 'updates' in same && same.updates.length === 0, j(same))

  const swapped = [...ids]; [swapped[0], swapped[1]] = [swapped[1], swapped[0]]
  const plan = planReorder(SEED, swapped)
  check('a swap moves exactly two rows',
    'updates' in plan && j(plan.updates) === j([{ id: 'c2', sort_order: 10 }, { id: 'c1', sort_order: 20 }]), j(plan))

  check('a partial list is refused', 'error' in planReorder(SEED, ids.slice(1)))
  check('a repeated id is refused', 'error' in planReorder(SEED, [...ids.slice(1), 'c2']))
  check('a foreign id is refused', 'error' in planReorder(SEED, [...ids.slice(1), 'someone-elses']))
  check('a non-list is refused', 'error' in planReorder(SEED, 'c1,c2'))
  const withInactive = SEED.map((c, i) => (i === 8 ? { ...c, is_active: false } : c))
  check('an inactive category must be in the order too', 'error' in planReorder(withInactive, ids.slice(0, 8)))
}

// ── Set-category request ───────────────────────────────────────────────────
console.log('set-category request')
{
  const U1 = '11111111-1111-4111-8111-111111111111'
  const U2 = '22222222-2222-4222-8222-222222222222'
  const C1 = '33333333-3333-4333-8333-333333333333'
  const r = parseSetCategoryBody({ unit_ids: [U1, U2, U1], category_id: C1 })
  check('parses ids and dedupes', 'unitIds' in r && j(r.unitIds) === j([U1, U2]) && r.categoryId === C1, j(r))
  const clear = parseSetCategoryBody({ unit_ids: [U1], category_id: null })
  check('null clears to Uncategorized', 'unitIds' in clear && clear.categoryId === null, j(clear))
  const empty = parseSetCategoryBody({ unit_ids: [U1], category_id: '' })
  check('empty string also clears', 'unitIds' in empty && empty.categoryId === null, j(empty))
  check('no units is refused', 'error' in parseSetCategoryBody({ unit_ids: [], category_id: C1 }))
  check('a non-uuid unit id is refused', 'error' in parseSetCategoryBody({ unit_ids: ['103'], category_id: C1 }))
  check('a non-uuid category id is refused', 'error' in parseSetCategoryBody({ unit_ids: [U1], category_id: 'Truck' }))
  check('no body is refused', 'error' in parseSetCategoryBody(null))
  const many = Array.from({ length: MAX_UNITS_PER_REQUEST + 1 }, (_, i) =>
    `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`)
  check('over the cap is refused', 'error' in parseSetCategoryBody({ unit_ids: many, category_id: C1 }))
}

// ── Duplicate serials ──────────────────────────────────────────────────────
// Kurt's unit 103 after the merge: the survivor is active, the merged-away twin is not.
const TAYLOR_103: SerialHolder = {
  id: 'u-103', unit_number: '103', manufacturer: 'International', model: 's1800',
  serial_number: '1HTSDAAN0WH000103', active: true,
}
const TAYLOR_103_RETIRED: SerialHolder = { ...TAYLOR_103, id: 'u-103-old', active: false }
const REEFER: SerialHolder = {
  id: 'u-7', unit_number: 'TRL-007', manufacturer: 'Thermo King', model: 'Precedent S-600',
  serial_number: '6001234567', active: null,   // NULL active counts as active, as in the index
}
const EXISTING = [TAYLOR_103, TAYLOR_103_RETIRED, REEFER]

console.log('describing a unit')
{
  check('unit number with make and model', describeUnit(TAYLOR_103) === 'unit 103 (International s1800)', describeUnit(TAYLOR_103))
  const placeholder = describeUnit({ unit_number: '55', manufacturer: 'UNKNOWN', model: 'Unknown' })
  check('importer/form placeholders are left out', placeholder === 'unit 55', placeholder)
  const msg = duplicateSerialMessage(' 1htsdaan0wh000103 ', TAYLOR_103)
  check('message names the serial and the holder',
    msg === 'Serial 1htsdaan0wh000103 is already on unit 103 (International s1800).', msg)
}

console.log('finding who holds a serial')
{
  check('case and surrounding spaces are ignored', findSerialHolder(EXISTING, ' 1htsdaan0wh000103 ')?.id === 'u-103')
  check('a retired unit never holds a serial', findSerialHolder([TAYLOR_103_RETIRED], '1HTSDAAN0WH000103') === null)
  check('active NULL counts as active', findSerialHolder(EXISTING, '6001234567')?.id === 'u-7')
  check('a unit does not clash with itself on edit', findSerialHolder(EXISTING, '1HTSDAAN0WH000103', 'u-103') === null)
  check('dashes are NOT stripped (same rule as unit-match)', findSerialHolder(EXISTING, '600-1234567') === null)
  check('blank serial holds nothing', findSerialHolder(EXISTING, '  ') === null)
}

console.log('recognising the database error')
{
  const pg = { code: '23505', message: 'duplicate key value violates unique constraint "hd_units_user_serial_unique"' }
  check('the serial index 23505 is recognised', isSerialUniqueViolation(pg))
  check('another unique index is not', !isSerialUniqueViolation({ code: '23505', message: 'duplicate key value violates unique constraint "hd_units_pkey"' }))
  check('another error code is not', !isSerialUniqueViolation({ code: '23514', message: 'hd_units_user_serial_unique' }))
  check('null is not', !isSerialUniqueViolation(null))
  check('ilike escapes % _ and backslash', ilikeLiteral('A%B_C\\D') === 'A\\%B\\_C\\\\D', ilikeLiteral('A%B_C\\D'))
}

console.log('CSV import split')
{
  const rows = [
    { unit_number: '201', manufacturer: 'Altec', model: 'AT40G', serial_number: 'ALT-0001' },          // line 2: new, kept
    { unit_number: '103', manufacturer: 'International', serial_number: '1htsdaan0wh000103 ' },        // line 3: already on 103
    { unit_number: '202', manufacturer: 'Altec', serial_number: ' alt-0001' },                         // line 4: repeats line 2
    { unit_number: '203', manufacturer: 'Terex', serial_number: '' },                                  // line 5: no serial, kept
    { unit_number: '', manufacturer: '  ', serial_number: 'X1' },                                      // line 6: blank row
    { unit_number: '204', manufacturer: 'Terex', serial_number: '1HTSDAAN0WH000103-B' },               // line 7: different serial, kept
    { unit_number: '205', manufacturer: 'Terex' },                                                     // line 8: no serial key, kept
  ]
  const { keep, skipped } = partitionImportRows(rows, EXISTING)
  check('keeps the rows that are new', j(keep.map(r => r.unit_number)) === j(['201', '203', '204', '205']), j(keep.map(r => r.unit_number)))
  check('skips three, by spreadsheet line', j(skipped.map(s => s.row)) === j([3, 4, 6]), j(skipped))
  check('existing-unit skip names the holder',
    skipped[0]?.reason === 'Serial 1htsdaan0wh000103 is already on unit 103 (International s1800).', skipped[0]?.reason)
  check('in-file skip points back at the first line', skipped[1]?.reason === 'Serial alt-0001 is also on line 2 of this file.', skipped[1]?.reason)
  check('blank row is reported, not silently dropped', skipped[2]?.reason === 'no unit number or manufacturer', skipped[2]?.reason)

  const retiredOnly = partitionImportRows([{ unit_number: '103', manufacturer: 'International', serial_number: '1HTSDAAN0WH000103' }], [TAYLOR_103_RETIRED])
  check('a serial held only by a retired unit imports', retiredOnly.keep.length === 1 && retiredOnly.skipped.length === 0)

  const summary = summarizeSkips(skipped)
  check('summary is one readable line per skip',
    summary === 'Line 3 (unit 103): Serial 1htsdaan0wh000103 is already on unit 103 (International s1800). ' +
                'Line 4 (unit 202): Serial alt-0001 is also on line 2 of this file. ' +
                'Line 6: no unit number or manufacturer', summary)
  const lots = Array.from({ length: 12 }, (_, i) => ({ row: i + 2, unit_number: null, serial_number: null, reason: 'r' }))
  check('summary caps at 10 and counts the rest', /\.\.\.and 2 more\.$/.test(summarizeSkips(lots)), summarizeSkips(lots))
}

// ── PM Schedules chip ──────────────────────────────────────────────────────
console.log('PM Schedules chip')
{
  check('Truck is truck blue', j(unitCategoryChip('Truck')) === j({ label: 'Truck', color: TRUCK_BLUE }))
  check('truck in any case is truck blue', unitCategoryChip(' truck ').color === TRUCK_BLUE)
  check('Trailer is neutral now, not green', j(unitCategoryChip('Trailer')) === j({ label: 'Trailer', color: NEUTRAL_CHIP }))
  check('a shop-added category is neutral with its own name', j(unitCategoryChip('Crane')) === j({ label: 'Crane', color: NEUTRAL_CHIP }))
  check('no category says Uncategorized', j(unitCategoryChip(null)) === j({ label: 'Uncategorized', color: NEUTRAL_CHIP }))
  check('"Trucks" is not Truck', unitCategoryChip('Trucks').color === NEUTRAL_CHIP)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
