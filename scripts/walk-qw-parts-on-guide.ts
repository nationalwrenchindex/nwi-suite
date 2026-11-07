// WALK: LD QuickWrench, parts on the Tech Guide, no Parts screen (Nov 7, 2026).
//
//   PAGECHECK_BASE=http://localhost:3123 npx tsx scripts/walk-qw-parts-on-guide.ts
//
// A real job, end to end, with no browser: a 2015 GMC Yukon XL, Front Brake Pad
// Replacement.
//   1. The REAL tech guide from /api/quickwrench/tech-guide (the Gemini call the screen
//      makes), turned into the screen's parts with the screen's own enrichParts.
//   2. The Tech Guide tab and the Quote tab - the screen's own components - rendered to
//      HTML from that answer: Parts Needed with no price, then the Quote with those
//      parts as lines, cost blank; then again with a cost typed once per part.
//   3. The stepper as /quickwrench actually serves it.
//   4. The save the Quote screen makes, read back from the database, and deleted.
// Every row it makes is deleted in `finally`, and the deletion is read back.

import React from 'react'
import { renderToString } from 'react-dom/server'
import { loadEnv, openSession, visibleText } from './lib/smoke-session'
import { enrichParts } from '../src/lib/quickwrench-parts'
import { TechGuideTab, QuoteTab } from '../src/components/quickwrench/QuickWrenchClient'
import { documentDefaultsFrom, newDocumentServiceCall } from '../src/lib/document-defaults'
import { quickwrenchMoney } from '../src/lib/quickwrench-money'
import type { TechGuide, SelectedJob, QWVehicle } from '../src/types/quickwrench'

loadEnv()
// tsx compiles the screen's JSX with the classic transform (React.createElement), which
// Next does not need; give it the React it expects.
;(globalThis as { React?: typeof React }).React = React
const BASE  = (process.env.PAGECHECK_BASE ?? 'http://localhost:3123').replace(/\/$/, '')
const OWNER = process.env.SMOKE_OWNER_ID ?? '4a8c046f-7db3-42bb-8422-fd47efb7678c'
const SUPA  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SVC   = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SVC_H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }
const r2 = (n: number) => Math.round(n * 100) / 100
const usd = (n: number) => `$${n.toFixed(2)}`

let pass = 0, fail = 0
function check(step: string, ok: boolean, detail = ''): boolean {
  if (ok) pass++; else fail++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${step}${detail ? '  -- ' + detail : ''}`)
  return ok
}
async function rest(q: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${SUPA}/rest/v1/${q}`, { headers: SVC_H }); const j = await r.json()
  if (!Array.isArray(j)) throw new Error(`REST ${q} -> ${JSON.stringify(j).slice(0, 160)}`)
  return j
}
const between = (html: string, startMark: string, endMark: string) => {
  const a = html.indexOf(startMark); if (a < 0) return ''
  const b = html.indexOf(endMark, a); return html.slice(a, b < 0 ? undefined : b)
}

async function main(): Promise<void> {
  const created = { quotes: [] as string[], logs: [] as string[] }
  const { cookie } = await openSession(OWNER)
  try {
    const vehicle: QWVehicle = { vin: '', year: '2015', make: 'GMC', model: 'Yukon XL', engine: '5.3L V8' }
    const job: SelectedJob = { category: 'brakes', categoryLabel: 'Brakes', name: 'Front Brake Pad Replacement', hours: 1.5 }
    const key = `${job.category}:${job.name}`

    // 1. The real guide.
    console.log(`\n== 1. /api/quickwrench/tech-guide, ${vehicle.year} ${vehicle.make} ${vehicle.model}, ${job.name}`)
    const g = await fetch(`${BASE}/api/quickwrench/tech-guide`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ vehicle, job }) })
    const gj = await g.json().catch(() => ({})) as { guide?: TechGuide; error?: string }
    let guide: TechGuide
    if (check('the tech guide loads live', g.status === 200 && !!gj.guide, `-> ${g.status} ${gj.error ?? ''}`)) {
      guide = gj.guide!
    } else {
      // FALLBACK, said plainly: the newest REAL answer to this same vehicle and job, as
      // the old Parts screen saved it to the quickwrench_quotes log (name, qty and the AI
      // price it seeded). Not an assumed shape - the parts a live run produced. Steps,
      // torque and tools are not logged, so those cards are empty here.
      const logged = (await rest(`quickwrench_quotes?vehicle_make=eq.GMC&vehicle_model=eq.Yukon%20XL&job_name=eq.Front%20Brake%20Pad%20Replacement&select=id,created_at,parts_list&order=created_at.desc&limit=1`))[0]
      const own = ((logged?.parts_list as Array<Record<string, unknown>> | null) ?? [])
        .filter(p => String(p.id ?? '').startsWith(`part-${key}-`))
      if (!check('fallback: a real logged answer for this vehicle and job', own.length > 0, logged ? `quickwrench_quotes ${logged.id} at ${logged.created_at}` : 'none')) return
      guide = { torque: [], steps: [], tools: [], warning: '', hours: job.hours,
        parts: own.map(p => ({ name: String(p.name), qty: Number(p.qty) || 1, unit_cost: Number(p.custom_price) || 0, unit_price: Number(p.custom_price) || 0 })) }
    }
    console.log('     the AI answer\'s parts, as generated (these prices are what used to fill the Parts screen):')
    for (const p of guide.parts) console.log(`       ${JSON.stringify(p)}`)
    const parts = enrichParts(guide.parts, key)
    if (!check('the guide has parts to list', parts.length > 0, `${parts.length}`)) return
    check('no generated price survives into the screen\'s parts', parts.every(p => p.custom_price === 0 && p.price_estimate === 0),
      parts.map(p => `${p.name} x${p.qty}`).join(' | '))

    // 2a. The Tech Guide tab.
    console.log('\n== 2a. The Tech Guide tab (rendered from that answer)')
    const tg = renderToString(React.createElement(TechGuideTab, {
      vehicle, jobs: [job], techGuides: { [key]: guide }, partsByJob: { [key]: parts },
      loading: false, error: null, onRetry: () => {}, onNext: () => {},
    }))
    const block = between(tg, 'data-testid="qw-parts-needed"', 'AI-generated specifications')
    const blockText = visibleText(block)
    check('Parts Needed renders on the Tech Guide', block.length > 0 && blockText.includes('Parts Needed'))
    console.log(`     Parts Needed: ${blockText}`)
    for (const p of parts) check(`lists "${p.name}" with its quantity`, blockText.includes(p.name) && blockText.includes(`Qty ${p.qty}`))
    check('no dollar sign anywhere in the block', !blockText.includes('$'))
    check('no part number in the block', !/(part\s*#|p\/n|oem\s*[:#])/i.test(blockText))
    const iBlock = tg.indexOf('data-testid="qw-parts-needed"'), iDisc = tg.indexOf('AI-generated specifications for reference only')
    check('the AI disclaimer sits after it on the same tab, covering it', iBlock >= 0 && iDisc > iBlock)
    check('"View Parts List" is gone; the tab goes straight to the quote', !tg.includes('View Parts List') && tg.includes('Build Quote'))

    // 2b. The Quote tab, as it opens.
    const p0 = (await rest(`profiles?select=*&id=eq.${OWNER}`))[0] ?? {}
    const d = documentDefaultsFrom(p0)
    const quoteProps = (partCosts: Record<string, number>) => ({
      vehicle, selectedJobs: [job], techGuides: { [key]: guide }, partsByJob: { [key]: parts },
      laborHourOverrides: {}, laborDescOverrides: {}, partCosts, partPriceOverrides: {},
      onLaborHoursChange: () => {}, onLaborDescChange: () => {}, onPartCostChange: () => {},
      onPartPriceChange: () => {}, onRemoveJob: () => {},
      initialLaborRate: d.laborRate, initialMarkupPct: d.markupPct, initialTaxPct: d.taxPct,
    })
    console.log(`\n== 2b. The Quote tab as it opens (shop: labor ${usd(d.laborRate)}/h, markup ${d.markupPct}%, tax ${d.taxPct}%)`)
    const qOpen = renderToString(React.createElement(QuoteTab, quoteProps({})))
    const costInputs = [...qOpen.matchAll(/<input[^>]*placeholder="Store cost"[^>]*>/g)].map(m => m[0])
    check('one part line per Parts Needed row', costInputs.length === parts.length, `${costInputs.length} lines for ${parts.length} parts`)
    for (const p of parts) check(`"${p.name}" is a line already`, visibleText(qOpen).includes(p.name.slice(0, 40)))
    check('every Cost (from store) is blank', costInputs.every(i => /value=""/.test(i)), costInputs.map(i => (i.match(/value="([^"]*)"/) ?? [])[1] ?? '?').join(','))
    check('the line keeps Cost (from store), Customer Price and Profit', ['Cost (from store)', 'Customer Price', 'Profit'].every(t => qOpen.includes(t)))
    check('labor, travel/miles inputs and the totals block are still on the screen',
      qOpen.includes('h × ') && qOpen.includes('data-testid="document-totals"'))

    // 2c. A cost typed once per part.
    const typed = [42.5, 18.75, 9.2, 12.4, 6.1]
    const partCosts = Object.fromEntries(parts.map((p, i) => [p.id, typed[i % typed.length]]))
    console.log('\n== 2c. A cost typed once per part')
    const qTyped = renderToString(React.createElement(QuoteTab, quoteProps(partCosts)))
    for (const p of parts) {
      const cost = partCosts[p.id], price = r2(cost * (1 + d.markupPct / 100)), profit = r2(price - cost)
      // This part line only: from its own title to its own Profit figure.
      const at = qTyped.indexOf(`title="${p.name.replace(/"/g, '&quot;')}"`)
      const line = at < 0 ? '' : qTyped.slice(at, qTyped.indexOf('Profit</span>', at) + 200)
      const shown = (line.match(/placeholder="0.00"[^>]*value="([^"]*)"/) ?? line.match(/value="([^"]*)"[^>]*placeholder="0.00"/) ?? [])[1]
      const shownProfit = (line.match(/Profit<\/span><span[^>]*>([^<]*)</) ?? [])[1]
      check(`"${p.name}": cost ${usd(cost)} -> customer price ${usd(price)}`, Number(shown) === price, `shown ${shown}`)
      check(`"${p.name}": profit ${usd(profit)}`, shownProfit === usd(profit), `shown ${shownProfit}`)
    }

    // 4. The save the Quote screen makes, priced by the route, read back.
    console.log('\n== 3. The save (what the Quote screen posts), read back from the database')
    const markup = d.markupPct, laborHrs = guide.hours || job.hours
    const jobsPayload = [{ id: key, category: job.category, subtype: job.name, labor_hours: laborHrs, labor_rate: d.laborRate,
      parts: parts.map(p => ({ name: p.name, qty: p.qty, unit_cost: partCosts[p.id], unit_price: r2(partCosts[p.id] * (1 + markup / 100)) })), notes: '' }]
    const callFee = newDocumentServiceCall(d)?.fee ?? 0
    const save = await fetch(`${BASE}/api/quickwrench/quote`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({
      vehicle, job: { ...job, hours: laborHrs }, jobs: jobsPayload, extra_labor: [], parts,
      labor_hours: laborHrs, labor_rate: d.laborRate, markup_percent: markup, tax_percent: d.taxPct,
      travel_hours: 0, mileage_miles: 0, service_call_fee: callFee,
      customer_id: null, customer_name: '', customer_phone: '', send_sms: false, save_quote: true,
    }) })
    const sj = await save.json().catch(() => ({})) as { quoteId?: string; quote?: { id?: string }; error?: string }
    if (sj.quote?.id) created.logs.push(sj.quote.id)
    if (sj.quoteId) created.quotes.push(sj.quoteId)
    if (!check('the quote saves', save.status === 200 && !!sj.quoteId, `-> ${save.status} ${sj.error ?? ''}`)) return
    const q = (await rest(`quotes?select=*&id=eq.${sj.quoteId}`))[0]
    const lines = (q.line_items as Array<Record<string, unknown>>) ?? []
    for (const p of parts) {
      const l = lines.find(x => x.description === p.name)
      check(`stored "${p.name}": cost ${usd(partCosts[p.id])}, price ${usd(r2(partCosts[p.id] * (1 + markup / 100)))} each`,
        !!l && Number(l.unit_cost) === partCosts[p.id] && r2(Number(l.unit_price)) === r2(partCosts[p.id] * (1 + markup / 100)),
        l ? `unit_cost ${l.unit_cost}, unit_price ${l.unit_price}, qty ${l.quantity}` : 'no line')
    }
    const expected = quickwrenchMoney({ jobs: jobsPayload, extraLabor: [], laborRate: d.laborRate, markupPct: markup, taxPct: d.taxPct,
      taxSettings: d.taxSettings, defaults: d, travelHours: 0, mileageMiles: 0, serviceCallFee: callFee }).money
    check(`the stored total is the job priced on these costs: ${usd(r2(expected.grandTotal))}`, r2(Number(q.grand_total)) === r2(expected.grandTotal),
      `stored ${q.grand_total}; parts ${usd(r2(expected.partsTotal))}, labor ${usd(r2(expected.laborSubtotal))}, tax ${usd(r2(expected.taxAmount))}`)
    const log = created.logs[0] ? (await rest(`quickwrench_quotes?select=parts_list&id=eq.${created.logs[0]}`))[0] : null
    const logged = (log?.parts_list as Array<Record<string, unknown>> | null) ?? []
    check('the save log carries no generated price', logged.length === parts.length && logged.every(p => Number(p.custom_price) === 0 && Number(p.price_estimate) === 0),
      logged.map(p => `${p.name}: ${p.custom_price}`).join(' | '))

    // The stepper, as the page serves it.
    console.log('\n== 4. /quickwrench as served')
    const pg = await fetch(`${BASE}/quickwrench`, { headers: { cookie } })
    const html = await pg.text()
    // The step indicator labels and the tab buttons, read from their own markup - the
    // app nav above the page has its own "Parts" link (the parts counter), not a step.
    const want = ['Vehicle', 'Job Type', 'Tech Guide', 'Quote'].join(',')
    const stepper = [...html.matchAll(/text-\[9px\] font-medium whitespace-nowrap hidden sm:block[^"]*">([^<]+)</g)].map(m => m[1]).join(',')
    const tabs = [...html.matchAll(/<span class="hidden sm:inline">([^<]+)<\/span>/g)].map(m => m[1]).join(',')
    check('the step indicator is Vehicle, Job Type, Tech Guide, Quote - no Parts', pg.status === 200 && stepper === want, `-> ${pg.status} [${stepper}]`)
    // The Diagnostic Tools panel below the flow has its own tab buttons (DTC Lookup,
    // Recalls...) in the same markup; the flow's are the first four.
    const tabList = tabs.split(',')
    check('the flow\'s tab buttons are the same four, and no tab on the page is Parts',
      tabList.slice(0, 4).join(',') === want && !tabList.includes('Parts'), `[${tabs}]`)
  } finally {
    for (const id of created.quotes) await fetch(`${SUPA}/rest/v1/quotes?id=eq.${id}`, { method: 'DELETE', headers: SVC_H })
    for (const id of created.logs) await fetch(`${SUPA}/rest/v1/quickwrench_quotes?id=eq.${id}`, { method: 'DELETE', headers: SVC_H })
    const left = (created.quotes.length ? (await rest(`quotes?select=id&id=in.(${created.quotes.join(',')})`)).length : 0)
      + (created.logs.length ? (await rest(`quickwrench_quotes?select=id&id=in.(${created.logs.join(',')})`)).length : 0)
    check(`cleanup: the ${created.quotes.length} quote and ${created.logs.length} save log row are gone`, left === 0, `${left} left`)
    console.log(`\n  ${pass} passed, ${fail} failed`)
    process.exitCode = fail ? 1 : 0
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
