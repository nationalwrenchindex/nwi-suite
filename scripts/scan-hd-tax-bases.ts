// npx tsx scripts/scan-hd-tax-bases.ts
// READ-ONLY. Every HD invoice and quote: the tax the rule gives (parts bucket = parts
// lines + shop supplies; labor bucket = labor lines + drive time + taxed fees; mileage
// never), at the rates the document's own split records, against the tax it recorded.
// Writes nothing. A discounted document is listed with its discount, not re-priced.
import { loadEnv } from './lib/smoke-session'
import { computeTax, parseBreakdown } from '../src/lib/tax'
import { hdTaxableFees } from '../src/lib/hd/hd-extras'
loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
async function all(q: string): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = []
  for (let f = 0; ; f += 1000) {
    const j = await (await fetch(`${S}/rest/v1/${q}`, { headers: { ...H, Range: `${f}-${f + 999}` } })).json()
    if (!Array.isArray(j)) throw new Error(`${q}: ${JSON.stringify(j)}`)
    out.push(...j); if (j.length < 1000) break
  }
  return out
}
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const r2 = (x: number) => Math.round(x * 100) / 100
async function main() {
  const users = new Map<string, string>()
  for (const t of ['hd_invoices', 'hd_quotes'] as const) {
    const numCol = t === 'hd_invoices' ? 'invoice_number' : 'quote_number'
    const docs = await all(`${t}?select=*&order=created_at`)
    let checked = 0, multi = 0
    const bad: string[] = [], unsplit: string[] = []
    for (const d of docs) {
      if (d.tax_amount == null) continue
      if (/SMOKE/i.test(String(d.customer_name ?? ''))) continue
      const lines = Array.isArray(d.line_items) ? d.line_items : []
      const jobCount = new Set(lines.map((l: any) => l.job).filter((x: any) => x != null)).size
      if (jobCount >= 2) multi++
      const bd = parseBreakdown(d.tax_breakdown)
      checked++
      const base = {
        parts: r2(n(d.subtotal_parts) + n(d.shop_supplies_fee)),
        labor: r2(n(d.subtotal_labor) + n(d.travel_amount) + hdTaxableFees(d)),
      }
      const settings = {
        tax_parts: bd?.parts ? bd.parts.taxed : true, tax_rate_parts: bd?.parts?.rate ?? n(d.tax_rate),
        tax_labor: bd?.labor ? bd.labor.taxed : true, tax_rate_labor: bd?.labor?.rate ?? n(d.tax_rate),
      }
      const should = computeTax(base, settings).taxAmount
      const diffAmt = r2(should - n(d.tax_amount))
      const disc = d.discount && typeof d.discount === 'object' && n(d.discount.amount) > 0
      if (Math.abs(diffAmt) < 0.005) continue
      if (!users.has(d.user_id)) {
        const r = await (await fetch(`${S}/auth/v1/admin/users/${d.user_id}`, { headers: H })).json()
        users.set(d.user_id, r?.email ?? d.user_id)
      }
      ;(bd ? bad : unsplit).push(`  ${users.get(d.user_id)}  ${d[numCol]}  ${d.status}  jobs ${jobCount || 1}  recorded ${n(d.tax_amount).toFixed(2)}  rule ${should.toFixed(2)}  diff ${diffAmt.toFixed(2)}` +
        `  [base rec ${bd ? `parts ${bd.parts?.base ?? '-'} labor ${bd.labor?.base ?? '-'}` : 'NO SPLIT, one rate ' + n(d.tax_rate) + '%'} | rule parts ${base.parts} labor ${base.labor}]${disc ? `  DISCOUNT ${n(d.discount.amount).toFixed(2)}` : ''}` +
        `${d.sent_at || n(d.sent_count) > 0 || d.status === 'sent' ? '  SENT' : ''}${d.paid_at || d.status === 'paid' ? '  PAID' : ''}`)
    }
    console.log(`\n${t}: ${docs.length} rows, ${checked} checked, ${multi} with 2+ jobs, ${bad.length} differ from the rule`)
    bad.forEach(b => console.log(b))
    console.log(`  -- ${unsplit.length} recorded NO split (one blended rate; the per-bucket rule cannot be checked against them, figure below assumes both buckets taxed at that one rate):`)
    unsplit.forEach(b => console.log(b))
  }
}
main()
