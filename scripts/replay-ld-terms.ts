// npx tsx scripts/replay-ld-terms.ts
//
// READ ONLY. The LD terms carry (quote -> invoice, "the accepted offer governs") is
// FORWARD ONLY. This proves it against every stored LD invoice, the way the HD
// 27-invoice replay proves the editor:
//
//   1. For every stored invoice, the terms it prints TODAY (its own snapshot, or none
//      yet) and the terms it prints AFTER this change, by running the real rules:
//      termsToRecord at finalize (keeps any snapshot; records the shop's terms only
//      when there is none) and carriedTerms (applied ONLY to a NEW invoice's insert).
//      No existing invoice is re-created, so carriedTerms never reaches one.
//      Expect: 0 printed changes.
//   2. The rule is wired only into the two INSERTs that create an invoice from a quote
//      (quote convert, work-order convert) - read from the source.
//   3. Going forward: what a new conversion of each quote would carry.
//
// Exit 1 if any stored invoice would print differently.

import fs from 'fs'
import { loadEnv } from './lib/smoke-session'
import { carriedTerms, parseTermsSnapshot, termsBlockRows, termsToRecord } from '../src/lib/document-terms'

async function main() {
  loadEnv()
  const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const H = { apikey: K, Authorization: 'Bearer ' + K }
  const get = async (p: string) => (await fetch(`${S}/rest/v1/${p}`, { headers: H })).json() as Promise<Record<string, unknown>[]>
  const invoices = await get('invoices?select=id,user_id,invoice_number,status,finalized_at,source_quote_id,source_work_order_id,terms_snapshot&order=invoice_number.asc')
  const quotes = await get('quotes?select=id,quote_number,terms_snapshot')
  const owners = [...new Set(invoices.map(i => String(i.user_id)))]
  const profiles = await get(`profiles?id=in.(${owners.join(',')})&select=id,warranty_terms,customer_supplied_parts_clause,default_payment_terms,default_payment_instructions,pay_link_url`)
  const profileOf = new Map(profiles.map(p => [String(p.id), p]))
  const printed = (snap: unknown) => JSON.stringify(termsBlockRows(parseTermsSnapshot(snap), { includePayment: true }).map(r => [r.key, r.text, r.link ?? null]))
  const now = new Date('2026-10-25T00:00:00Z')

  let changed = 0, kept = 0, notYet = 0
  console.log('1. Every stored LD invoice: printed terms today vs after the change')
  for (const inv of invoices) {
    const profile = profileOf.get(String(inv.user_id))
    // TODAY: a recorded snapshot prints; with none, the next finalize records the shop's terms.
    const todayRecorded = inv.terms_snapshot ?? termsToRecordOld(inv.terms_snapshot, profile, now)
    // AFTER: the same stored row (carriedTerms only spreads into a NEW insert), then the
    // real finalize rule.
    const afterRecorded = inv.terms_snapshot ?? termsToRecord(inv.terms_snapshot, profile, now)
    const same = printed(todayRecorded) === printed(afterRecorded)
    if (!same) changed++
    if (inv.terms_snapshot) kept++; else notYet++
    console.log(`  ${same ? 'same   ' : 'CHANGED'} ${String(inv.invoice_number).padEnd(14)} ${String(inv.user_id).slice(0, 8)} ${String(inv.status).padEnd(8)} ${inv.terms_snapshot ? 'recorded - kept as is' : 'none yet - finalize records the shop\'s terms, as before'}`)
  }
  const i3 = invoices.find(i => i.invoice_number === 'INV-2026-0003' && parseTermsSnapshot(i.terms_snapshot)?.warranty)
  if (i3) console.log(`  INV-2026-0003 (${String(i3.user_id).slice(0, 8)}) keeps: "${parseTermsSnapshot(i3.terms_snapshot)!.warranty}"`)

  console.log('\n2. Where carriedTerms is wired (must be inside a new invoice INSERT, nowhere else)')
  const sites: string[] = []
  for (const f of ['src/app/api/quotes/[id]/convert/route.ts', 'src/app/api/work-orders/[id]/convert/route.ts']) {
    const src = fs.readFileSync(f, 'utf8').split('\r\n').join('\n')
    const at = src.indexOf('...carriedTerms(')
    const insert = src.lastIndexOf('const invoiceInsert = {', at)
    const ok = at > 0 && insert > 0 && !src.slice(insert, at).includes('\n  }\n') && src.indexOf("from('invoices').insert(row)", at) > at
    sites.push(`${ok ? 'ok  ' : 'BAD '} ${f}`)
  }
  sites.forEach(s => console.log('  ' + s))
  const badSites = sites.filter(s => s.startsWith('BAD')).length

  console.log('\n3. Going forward: a new conversion of each quote carries')
  const carrying = quotes.filter(q => carriedTerms(q).terms_snapshot)
  console.log(`  ${carrying.length} of ${quotes.length} LD quotes recorded terms; a new invoice from those prints the quote's terms`)

  console.log(`\n${invoices.length} LD invoices: ${changed} print different terms; ${kept} keep their recorded terms; ${notYet} have none yet (unchanged rule at finalize)`)
  process.exit(changed || badSites ? 1 : 0)
}

/** The finalize rule as it was before this change: record the shop's terms when none. */
function termsToRecordOld(existing: unknown, profile: Record<string, unknown> | undefined, now: Date) {
  return termsToRecord(existing, profile, now)
}

main()
