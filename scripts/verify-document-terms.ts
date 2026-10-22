// npx tsx scripts/verify-document-terms.ts
//
// The terms block (docs/NWI-ESTIMATE-DOCUMENT-SPEC.md 2.8, build-order item 3;
// src/lib/document-terms.ts; migration 164). Pure: no database.

import {
  safePayLink, termsSnapshotFrom, parseTermsSnapshot, termsBlockRows, isMissing164Column,
} from '../src/lib/document-terms'

let failures = 0
let passes = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++
  else failures++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}

console.log('\nThe pay link is https or nothing')
check('a real https link is kept', safePayLink('https://square.link/u/abc123') === 'https://square.link/u/abc123')
check('surrounding spaces are trimmed', safePayLink('  https://pay.example.com/shop ') === 'https://pay.example.com/shop')
check('javascript: is refused', safePayLink('javascript:alert(1)') === null)
check('plain http is refused', safePayLink('http://pay.example.com') === null)
check('credentials in the URL are refused', safePayLink('https://user:pw@pay.example.com') === null)
check('a bare word is refused', safePayLink('venmo') === null && safePayLink('https://localhost') === null)
check('empty and non-text are null', safePayLink('') === null && safePayLink(null) === null && safePayLink(42) === null)

console.log('\nWhat a document records')
const NOW = new Date('2026-10-22T12:00:00Z')
const shop = {
  warranty_terms: '90 days / 4,000 miles on workmanship.',
  customer_supplied_parts_clause: 'Customer parts are not warranted; re-diagnosis is billable.',
  pay_link_url: 'https://pay.example.com/lexington',
  default_payment_terms: 'due_on_receipt',
  default_payment_instructions: 'Checks to Lexington Mobile Mechanic LLC, 1 Main St, Lexington KY 40507.',
}
const snap = termsSnapshotFrom(shop, NOW)
check('every term captured, with the moment', snap.warranty === shop.warranty_terms &&
  snap.customer_supplied_clause === shop.customer_supplied_parts_clause && snap.pay_link === shop.pay_link_url &&
  snap.payment_terms === 'due_on_receipt' && snap.payment_instructions === shop.default_payment_instructions &&
  snap.captured_at === NOW.toISOString())
const unsafe = termsSnapshotFrom({ ...shop, pay_link_url: 'javascript:alert(1)' }, NOW)
check('an unsafe pay link is never recorded', unsafe.pay_link === null)
const empty = termsSnapshotFrom({ warranty_terms: '   ' }, NOW)
check('a shop with no terms records an empty snapshot (blank text is null)', empty.warranty === null && empty.pay_link === null)

console.log('\nWhat prints')
check('no snapshot (sent before 164) -> no rows -> no block', termsBlockRows(null, { includePayment: true }).length === 0)
check('an empty snapshot -> no rows -> no empty heading', termsBlockRows(empty, { includePayment: true }).length === 0)
const quoteRows = termsBlockRows(snap, { includePayment: true })
check('a quote prints warranty, customer-supplied, payment terms, how to pay - in spec order',
  quoteRows.map(r => r.key).join(',') === 'warranty,customer_supplied,payment_terms,how_to_pay', quoteRows.map(r => r.key).join(','))
check('payment terms print as words, not the code', quoteRows[2].text === 'Due on receipt', String(quoteRows[2].text))
check('how to pay carries the remit text and the link', quoteRows[3].text === shop.default_payment_instructions && quoteRows[3].link === shop.pay_link_url)
const invRows = termsBlockRows(snap, { includePayment: false })
check('an invoice prints warranty and the clause only (its own terms and How to Pay already print)',
  invRows.map(r => r.key).join(',') === 'warranty,customer_supplied')
const linkOnly = termsBlockRows(termsSnapshotFrom({ pay_link_url: 'https://pay.example.com/x' }, NOW), { includePayment: true })
check('a pay link alone still gives How to pay', linkOnly.length === 1 && linkOnly[0].key === 'how_to_pay' && linkOnly[0].text === null)

console.log('\nRead back')
check('a stored snapshot round-trips', JSON.stringify(parseTermsSnapshot(JSON.parse(JSON.stringify(snap)))) === JSON.stringify(snap))
check('garbage reads as no snapshot', parseTermsSnapshot('x') === null && parseTermsSnapshot([]) === null && parseTermsSnapshot({ version: 2 }) === null)
check('a stored unsafe link is dropped on read too',
  parseTermsSnapshot({ ...snap, pay_link: 'javascript:alert(1)' })?.pay_link === null)

console.log('\nMigration 164 not applied')
check('a missing terms column is recognised', isMissing164Column({ message: 'column quotes.terms_snapshot does not exist' }))
check('any other error is not', !isMissing164Column({ message: 'permission denied for table quotes' }))

console.log(`\n${passes} passed, ${failures} failed`)
if (failures) process.exit(1)
