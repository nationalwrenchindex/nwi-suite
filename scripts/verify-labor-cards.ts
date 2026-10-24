// npx tsx scripts/verify-labor-cards.ts
//
// The labor card rules (src/lib/hd/labor-cards.ts, migration 166). Pure: no database.
// The live rows' shapes are the real ones read on 2026-10-24 for 4a8c046f.

import {
  cleanLaborCard, draftFromCard, filterLaborCards, hoursText, parseHourPair, positiveHours, isMissing166Column,
  EMPTY_DRAFT, type LaborCard,
} from '../src/lib/hd/labor-cards'

let failures = 0
let passes = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++
  else failures++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}
const j = (v: unknown) => JSON.stringify(v)

console.log('\nHour pairs')
{
  const single = parseHourPair('1.5', '', 'Field time')
  check('one number is a single value, high NULL', single.ok && single.low === 1.5 && single.high === null, j(single))
  const range = parseHourPair('1.5', '2.5', 'Field time')
  check('two numbers are a range', range.ok && range.low === 1.5 && range.high === 2.5, j(range))
  const same = parseHourPair('2', '2', 'Field time')
  check('a high equal to the low is a single value', same.ok && same.low === 2 && same.high === null, j(same))
  const empty = parseHourPair('', '', 'Shop time')
  check('both blank is an empty pair', empty.ok && empty.low === null && empty.high === null, j(empty))
  const zero = parseHourPair('0', '', 'Shop time')
  check('a typed 0 is empty, never stored as 0', zero.ok && zero.low === null, j(zero))
  const below = parseHourPair('3', '2', 'Field time')
  check('a high below the low is refused', !below.ok && /below/.test(below.ok ? '' : below.error), j(below))
  const highOnly = parseHourPair('', '2', 'Field time')
  check('a high with no low is refused', !highOnly.ok, j(highOnly))
  const neg = parseHourPair('-1', '', 'Field time')
  check('a negative is refused', !neg.ok, j(neg))
  const big = parseHourPair('100', '', 'Field time')
  check('over 99.99 (DECIMAL(4,2)) is refused', !big.ok, j(big))
  const word = parseHourPair('abc', '', 'Field time')
  check('a word is refused', !word.ok, j(word))
  const round = parseHourPair('1.555', '', 'Field time')
  check('rounded to the column precision', round.ok && round.low === 1.56, j(round))
  const spaces = parseHourPair(' 1.25 ', ' ', 'Field time')
  check('surrounding spaces are ignored', spaces.ok && spaces.low === 1.25 && spaces.high === null, j(spaces))
}

console.log('\nA card')
{
  const fieldOnly = cleanLaborCard({ description: 'Reefer fan bearing, in the lot', mobile_low: '1.5', shop_low: '' })
  check('field-only is valid (no shop time)',
    fieldOnly.ok && fieldOnly.row.mobile_hours === 1.5 && fieldOnly.row.shop_hours === null, j(fieldOnly))
  const shopOnly = cleanLaborCard({ description: 'Pull and reseal rear main', mobile_low: '', shop_low: '6', shop_high: '8' })
  check('shop-only is valid (no field time)',
    shopOnly.ok && shopOnly.row.mobile_hours === null && shopOnly.row.shop_hours === 6 && shopOnly.row.shop_hours_high === 8, j(shopOnly))
  const none = cleanLaborCard({ description: 'No time at all' })
  check('a card with no hours at all is refused', !none.ok, j(none))
  const noName = cleanLaborCard({ description: '   ', mobile_low: '1' })
  check('a card with no name is refused', !noName.ok, j(noName))
  const full = cleanLaborCard({
    description: '  R&R evaporator fan motor  ', mobile_low: '2', mobile_high: '3', shop_low: '1.5', shop_high: '',
    detail: 'Adds 1.5 to 2.5 hrs to mobile field time', suggested_related: 'Add refrigeration recovery & recharge',
    equipment_type: 'reefer', equipment_category_id: '5b47d389-1b88-424d-aa8e-cc74d86d6cb8',
  })
  check('every field carries, trimmed', full.ok && full.row.description === 'R&R evaporator fan motor'
    && full.row.mobile_hours_high === 3 && full.row.shop_hours_high === null
    && full.row.detail === 'Adds 1.5 to 2.5 hrs to mobile field time'
    && full.row.suggested_related === 'Add refrigeration recovery & recharge'
    && full.row.equipment_type === 'reefer', j(full))
  const badType = cleanLaborCard({ description: 'x', mobile_low: '1', equipment_type: 'forklift' })
  check('an equipment type outside the fixed list is refused', !badType.ok, j(badType))
  const badCat = cleanLaborCard({ description: 'x', mobile_low: '1', equipment_category_id: "1' or 1=1" })
  check('a category that is not an id is refused', !badCat.ok, j(badCat))
  const cols = cleanLaborCard({ description: 'x', mobile_hours: 2, mobile_hours_high: 4 })
  check('column names are accepted too', cols.ok && cols.row.mobile_hours === 2 && cols.row.mobile_hours_high === 4, j(cols))
  const blankText = cleanLaborCard({ description: 'x', mobile_low: '1', detail: '  ', suggested_related: '' })
  check('blank detail and related are NULL, not empty strings',
    blankText.ok && blankText.row.detail === null && blankText.row.suggested_related === null, j(blankText))
}

// Real rows for 4a8c046f, as read 2026-10-24 (before any edit here).
const row = (o: Partial<LaborCard>): LaborCard => ({
  id: '00000000-0000-0000-0000-000000000000', description: '', mobile_hours: null, mobile_hours_high: null,
  shop_hours: null, shop_hours_high: null, detail: null, suggested_related: null, equipment_type: null,
  equipment_category_id: null, created_at: '2026-01-01T00:00:00+00:00', updated_at: '2026-01-01T00:00:00+00:00', ...o,
})
const mounts = row({ id: '485ab7e9-486f-4454-bf5a-2742d2cb346f', description: 'Replace engine mounts, lower 2 rear, lower 2 front',
  mobile_hours: 4.2, shop_hours: 0, updated_at: '2026-10-23T22:49:19.118405+00:00' })
const test = row({ id: 'f086b183-c370-4681-a7ed-16109e9a0349', description: 'test labor', mobile_hours: 0, shop_hours: 1.5,
  updated_at: '2026-10-13T06:22:12.25765+00:00' })
const alt = row({ id: '71f0e1dc-9c65-4106-ab42-572569905e77', description: 'R&R Alternator', mobile_hours: 1.55, shop_hours: 1.25,
  updated_at: '2026-09-26T00:37:16.253502+00:00', equipment_type: 'truck' })

console.log('\nExisting rows: 0 is empty')
{
  const d = draftFromCard(mounts)
  check('"Replace engine mounts" shop 0 opens as an empty field', d.shop_low === '' && d.mobile_low === '4.2', j(d))
  check('"test labor" mobile 0 opens as an empty field', draftFromCard(test).mobile_low === '' && draftFromCard(test).shop_low === '1.5')
  check('hours text prints nothing for a 0', hoursText(0, null) === '' && hoursText(4.2, null) === '4.2 hr')
  check('hours text prints a range', hoursText(1.5, 2.5) === '1.5 to 2.5 hr' && hoursText('2', '2') === '2 hr')
  check('a stored decimal string reads as a number', positiveHours('1.55') === 1.55 && positiveHours('0.00') === null)
  // Re-saving the draft unchanged writes NULL for the 0 - only when the row is edited.
  const resave = cleanLaborCard(draftFromCard(mounts) as unknown as Record<string, unknown>)
  check('an edit of that row stores the empty shop time as NULL', resave.ok && resave.row.shop_hours === null && resave.row.mobile_hours === 4.2, j(resave))
}

console.log('\nSearch, filter, sort')
{
  const all = [test, alt, mounts]
  const base = { search: '', equipmentType: '', categoryId: '', sort: 'edited' as const }
  check('recently edited first', j(filterLaborCards(all, base).map(c => c.description)) === j([mounts.description, test.description, alt.description]))
  check('A-Z ignores case', j(filterLaborCards(all, { ...base, sort: 'description' }).map(c => c.description))
    === j(['R&R Alternator', 'Replace engine mounts, lower 2 rear, lower 2 front', 'test labor']))
  check('search matches the description, ignoring case', filterLaborCards(all, { ...base, search: 'ALTERN' }).length === 1)
  check('filter by equipment type', j(filterLaborCards(all, { ...base, equipmentType: 'truck' }).map(c => c.id)) === j([alt.id]))
  check('"no category" filter', filterLaborCards(all, { ...base, categoryId: 'none' }).length === 3)
  check('the input list is not mutated by sorting', all[0] === test)
}

console.log('\nMissing-migration detection')
check('names migration 166 on a missing column', isMissing166Column({ code: 'PGRST204', message: "Could not find the 'mobile_hours_high' column" }))
check('not on an unrelated error', !isMissing166Column({ code: '23505', message: 'duplicate key' }))
check('the empty draft is blank', Object.values(EMPTY_DRAFT).every(v => v === ''))

console.log(`\n${passes} passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
