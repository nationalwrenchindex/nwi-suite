// npx tsx scripts/scan-hd-invoice-line-amounts.ts
// READ-ONLY. Does every stored HD invoice line's amount follow from its own fields?
// parts: amount = quantity x unit_cost (unit_cost is the SELL on an invoice line).
// labor: amount = mobile_hours x invoice labor_rate, or quantity x unit_cost.
import { loadEnv } from './lib/smoke-session'
loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
const r2 = (x: number) => Math.round(x * 100) / 100
async function main() {
  const out: any[] = []
  for (let f = 0; ; f += 1000) {
    const j = await (await fetch(`${S}/rest/v1/hd_invoices?select=invoice_number,labor_rate,line_items,customer_name&order=id`, { headers: { ...H, Range: `${f}-${f + 999}` } })).json()
    out.push(...j); if (j.length < 1000) break
  }
  let parts = 0, partsOff = 0, labor = 0, laborHours = 0, laborQty = 0, laborNeither = 0
  const ex: string[] = []
  for (const inv of out) for (const l of (Array.isArray(inv.line_items) ? inv.line_items : [])) {
    const amt = Number(l.amount ?? 0)
    if (l.type === 'parts') {
      parts++
      if (r2(Number(l.quantity ?? 0) * Number(l.unit_cost ?? 0)) !== r2(amt)) { partsOff++; if (ex.length < 12) ex.push(`P ${inv.invoice_number} q${l.quantity} c${l.unit_cost} a${l.amount}`) }
    } else {
      labor++
      const byHours = r2(Number(l.mobile_hours ?? 0) * Number(inv.labor_rate ?? 0)) === r2(amt)
      const byQty = r2(Number(l.quantity ?? 0) * Number(l.unit_cost ?? 0)) === r2(amt)
      if (byHours) laborHours++; else if (byQty) laborQty++; else { laborNeither++; if (ex.length < 24) ex.push(`L ${inv.invoice_number} h${l.mobile_hours} rate${inv.labor_rate} q${l.quantity} c${l.unit_cost} a${l.amount} "${String(l.description).slice(0, 30)}"`) }
    }
  }
  console.log({ invoices: out.length, parts, partsOff, labor, laborHours, laborQty, laborNeither })
  console.log(ex.join('\n'))
}
main()
