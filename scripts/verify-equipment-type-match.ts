// npx tsx scripts/verify-equipment-type-match.ts
//
// Equipment type on import is read, never guessed (src/lib/hd/equipment-type-match.ts).
// Categories are the nine defaults migration 161 seeds, plus one inactive, as a shop
// has them.

import { matchCategoryByType, summarizeTypes, typeColumns, type CategoryOption } from '../src/lib/hd/equipment-type-match'

let failures = 0
let passes = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++
  else failures++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}

const CATS: CategoryOption[] = [
  'Truck', 'Trailer', 'Reefer Unit', 'Boom', 'Aerial / Bucket', 'APU', 'Generator', 'Forklift', 'Other',
].map((name, i) => ({ id: `cat-${i}`, name, is_active: true }))
CATS.push({ id: 'cat-old', name: 'Crane', is_active: false })
const id = (name: string) => CATS.find(c => c.name === name)!.id

console.log('\nA type in the file sets the matching category')
check('exact name', matchCategoryByType('Truck', CATS) === id('Truck'))
check('case-insensitive', matchCategoryByType('TRAILER', CATS) === id('Trailer') && matchCategoryByType('reefer unit', CATS) === id('Reefer Unit'))
check('surrounding and doubled spaces ignored', matchCategoryByType('  Reefer   Unit ', CATS) === id('Reefer Unit'))
check('punctuation in the name matches as written', matchCategoryByType('aerial / bucket', CATS) === id('Aerial / Bucket'))

console.log('\nNothing is guessed')
check('no type -> blank', matchCategoryByType(undefined, CATS) === null && matchCategoryByType(null, CATS) === null)
check('empty / whitespace type -> blank', matchCategoryByType('', CATS) === null && matchCategoryByType('   ', CATS) === null)
check('a near miss is not a match ("Reefer" is not "Reefer Unit")', matchCategoryByType('Reefer', CATS) === null)
check('a plural is not a match ("Trucks")', matchCategoryByType('Trucks', CATS) === null)
check('an inactive category is not assigned', matchCategoryByType('Crane', CATS) === null)
check('no categories at all -> blank', matchCategoryByType('Truck', []) === null)

console.log('\nThe columns written on a new unit')
const matched = typeColumns('Truck', CATS)
check('matched: category set, unit_type null (the trigger fills it from the category)',
  matched.category_id === id('Truck') && matched.unit_type === null && Object.keys(matched).length === 2)
const blank = typeColumns(undefined, CATS)
check("unmatched: category null AND unit_type null - never the column's 'trailer' default",
  blank.category_id === null && blank.unit_type === null && 'unit_type' in blank)
check('every row carries the same keys (one batch insert)',
  JSON.stringify(Object.keys(matched).sort()) === JSON.stringify(Object.keys(blank).sort()))

console.log('\nThe import reports what landed blank and why')
const s = summarizeTypes(['Truck', 'truck', 'Reefer', ' reefer ', 'REEFER', 'Bus', '', undefined, 'Trailer'], CATS)
check('counts: 3 categorized, 6 uncategorized, 2 with no type', s.categorized === 3 && s.uncategorized === 6 && s.noTypeInFile === 2, JSON.stringify(s))
check('unmatched types grouped case-insensitively, most first, as the file wrote them',
  JSON.stringify(s.unmatchedTypes) === JSON.stringify([{ type: 'Reefer', count: 3 }, { type: 'Bus', count: 1 }]), JSON.stringify(s.unmatchedTypes))
check('categorized + uncategorized = every unit', s.categorized + s.uncategorized === 9)
const none = summarizeTypes([], CATS)
check('an empty import reports zeros', none.categorized === 0 && none.uncategorized === 0 && none.unmatchedTypes.length === 0)

console.log(`\n${passes} passed, ${failures} failed`)
if (failures) process.exit(1)
