// npx tsx scripts/verify-quote-deep-link.ts
//
// After sending a quote that was opened from /financials?tab=quotes&quote=<id>, closing
// the panel reopened it - forever. The only exit was "Reopen in QuickWrench". Every quote
// made with New Quote lands on that link, and a live trial subscriber was stuck on it
// (Oct 22). This drives the Quotes tab's open/close cycle through src/lib/quote-deep-link.ts
// and, to prove the check can fail, through the effect as it was written before.

import { readFileSync } from 'fs'
import { join } from 'path'
import { deepLinkTarget, urlWithoutQuote } from '../src/lib/quote-deep-link'

let failures = 0
let passes = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++
  else failures++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}

type Q = { id: string; status: string }
type Effect = (s: Sim) => void
interface Sim { initialQuoteId?: string; quotes: Q[]; selected: Q | null; consumed: string | null }

// The effect in QuotesTab today: open the linked quote once.
const fixedEffect: Effect = s => {
  const t = deepLinkTarget(s.initialQuoteId, s.quotes, s.consumed)
  if (t) { s.consumed = t.id; s.selected = t }
}
// The effect as it shipped from 99e9ce7a until this fix.
const oldEffect: Effect = s => {
  if (s.initialQuoteId && s.quotes.length > 0 && !s.selected) {
    const m = s.quotes.find(q => q.id === s.initialQuoteId)
    if (m) s.selected = m
  }
}

/** The subscriber's path: land on the link, send, close the panel, the list refetches. */
function closeAfterSend(effect: Effect): Sim {
  const s: Sim = { initialQuoteId: 'q1', quotes: [], selected: null, consumed: null }
  effect(s)                                                       // first render, list still loading
  s.quotes = [{ id: 'q1', status: 'draft' }, { id: 'q2', status: 'sent' }]
  effect(s)                                                       // list arrives -> panel opens
  s.selected = { id: 'q1', status: 'sent' }                       // Send -> onUpdated
  s.quotes = s.quotes.map(q => q.id === 'q1' ? s.selected! : q)
  effect(s)
  s.selected = null                                               // the X
  effect(s)
  s.quotes = [...s.quotes]                                        // a filter change refetches
  effect(s)
  return s
}

console.log('\nThe linked quote opens')
const opened: Sim = { initialQuoteId: 'q1', quotes: [{ id: 'q1', status: 'draft' }], selected: null, consumed: null }
fixedEffect(opened)
check('landing on ?quote=<id> opens that quote', opened.selected?.id === 'q1')
const waiting: Sim = { initialQuoteId: 'q1', quotes: [], selected: null, consumed: null }
fixedEffect(waiting)
check('before the list loads nothing opens, and the link is not used up', waiting.selected === null && waiting.consumed === null)
const missing: Sim = { initialQuoteId: 'gone', quotes: [{ id: 'q1', status: 'draft' }], selected: null, consumed: null }
fixedEffect(missing)
check('a link to a quote not in the list opens nothing', missing.selected === null)
const plain: Sim = { quotes: [{ id: 'q1', status: 'draft' }], selected: null, consumed: null }
fixedEffect(plain)
check('no link, nothing opens', plain.selected === null)

console.log('\nClosing after a send lets the user leave')
const after = closeAfterSend(fixedEffect)
check('the X closes the panel and it stays closed', after.selected === null, `selected=${after.selected?.id ?? 'none'}`)
const other: Sim = { initialQuoteId: 'q1', quotes: [{ id: 'q1', status: 'sent' }, { id: 'q2', status: 'sent' }], selected: null, consumed: 'q1' }
other.selected = other.quotes[1]; other.selected = null
fixedEffect(other)
check('opening and closing a different quote does not spring the linked one', other.selected === null)

console.log('\nThe check catches the bug it exists for')
const old = closeAfterSend(oldEffect)
check('the old effect reopens the panel after the X (this is the regression)', old.selected?.id === 'q1', `selected=${old.selected?.id ?? 'none'}`)

console.log('\nClosing drops ?quote= so refresh and Back land on the list')
check('quote removed, tab kept', urlWithoutQuote('https://x.test/financials?tab=quotes&quote=abc') === '/financials?tab=quotes')
check('other parameters and the hash survive', urlWithoutQuote('https://x.test/financials?quote=abc&tab=quotes&status=sent#top') === '/financials?tab=quotes&status=sent#top')
check('only parameter removed leaves a clean path', urlWithoutQuote('https://x.test/financials?quote=abc') === '/financials')

// The cycle above runs the shared function, not the component. There is no browser in
// this repo to click the X, so these tie QuotesTab to the function: a rewrite of the
// effect inline, the way it was, fails here. A SOURCE check, said plainly.
console.log('\nQuotesTab uses it')
const src = readFileSync(join(__dirname, '../src/components/financials/QuotesTab.tsx'), 'utf8')
check('the deep-link effect goes through deepLinkTarget', /deepLinkTarget\(initialQuoteId, quotes, consumedDeepLink\.current\)/.test(src))
check('no effect re-selects the linked quote on "nothing selected"', !/initialQuoteId[^\n]*&&[^\n]*!selected/.test(src))
check('the panel closes through handleModalClose, which drops ?quote=',
  /onClose=\{handleModalClose\}/.test(src) && /replaceState\(null, '', urlWithoutQuote\(/.test(src))

console.log(`\n${passes} passed, ${failures} failed`)
if (failures) process.exit(1)
