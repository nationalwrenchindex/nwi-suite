// READ ONLY. Replays an UNCHANGED open-and-save of every stored HD invoice through the
// editor's own save code (src/lib/hd/invoice-edit-save.ts) and reports any field the
// save would write. Writes nothing - it never calls the PUT.
//
//   npx tsx scripts/replay-hd-invoice-save.ts
//
// Expected: 0 totals change, 0 stored fields change, and every invoice that does not
// add up is refused (the editor offers a deliberate correction instead).

import { loadEnv } from './lib/smoke-session'
import {
  openInvoiceEdit, invoiceSaveBody, invoiceDoesNotAddUp, correctionBody,
} from '../src/lib/hd/invoice-edit-save'

async function main() {
  loadEnv()
  const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const H = { apikey: K, Authorization: 'Bearer ' + K, Prefer: 'count=exact' }
  // 27 rows today; the range header proves nothing was cut at PostgREST's 1,000 cap.
  const res = await fetch(`${S}/rest/v1/hd_invoices?select=*&order=invoice_number.asc,user_id.asc`, { headers: H })
  const invoices = await res.json() as Record<string, unknown>[]
  console.log(`hd_invoices read: ${invoices.length} (content-range ${res.headers.get('content-range')})\n`)

  const rates: Record<string, number | null> = {}
  let totalMoved = 0, fieldMoved = 0, refused = 0
  for (const inv of invoices) {
    const uid = String(inv.user_id)
    if (!(uid in rates)) {
      const p = (await (await fetch(`${S}/rest/v1/profiles?select=hd_labor_rate,default_labor_rate&id=eq.${uid}`, { headers: H })).json())[0] ?? {}
      rates[uid] = p.hd_labor_rate != null ? Number(p.hd_labor_rate) : p.default_labor_rate != null ? Number(p.default_labor_rate) : null
    }
    const tag = `${uid.slice(0, 8)} ${String(inv.invoice_number).padEnd(14)} ${String(inv.status).padEnd(7)}`
    const bad = invoiceDoesNotAddUp(inv)
    if (bad) {
      refused++
      const c = correctionBody(inv)
      console.log(`${tag} REFUSED (${bad.reason}): stored ${bad.stored.toFixed(2)}, own ${bad.own.toFixed(2)}. ` +
        `Only the confirmed correction can change it: total -> ${Number(c.total).toFixed(2)}, tax -> ${Number(c.tax_amount).toFixed(2)}`)
      continue
    }
    const opened = openInvoiceEdit(inv, rates[uid])
    const body = invoiceSaveBody(inv, opened, opened.state)
    const keys = Object.keys(body)
    if ('total' in body) totalMoved++
    if (keys.length) fieldMoved++
    console.log(`${tag} total ${Number(inv.total).toFixed(2)} ` +
      (keys.length ? `WOULD WRITE ${JSON.stringify(body)}` : 'nothing written'))
  }
  console.log(`\n${totalMoved} of ${invoices.length} totals change; ${fieldMoved} of ${invoices.length} with any stored field changing; ${refused} refused`)
  process.exitCode = totalMoved || fieldMoved ? 1 : 0
}
main().catch(e => { console.error(e); process.exitCode = 1 })
