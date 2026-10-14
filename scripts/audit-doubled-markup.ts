// READ-ONLY. Which existing work order part lines carry the doubled-markup damage?
//
// The converter wrote the quote's SELL price into unit_cost and left the markup
// alongside it, so the screen computes cost x (1+markup) a second time. The STORED
// total was still the quote's own figure, which is why nothing looked wrong in the
// database - the damage shows on screen, and becomes real the moment someone edits
// and saves that line, because the line-items route recomputes the total from
// cost + markup.
//
// THE SIGNATURE: a part line whose stored total disagrees with
// quantity x sellPrice(unit_cost, markup). On an affected row the total is the
// quote's 3.90 while the columns say 5.07.
//
// No writes. Nothing is repaired here - any repair is SQL for the owner to run.

import { loadEnv } from './lib/smoke-session'
import { sellPrice } from '../src/lib/hd/parts-pricing'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

const r2 = (n: number) => Math.round(n * 100) / 100

interface Line {
  id: string
  work_order_id: string
  part_number: string | null
  description: string | null
  quantity: number | null
  unit_cost: number | null
  unit_price: number | null
  markup_percent: number | null
  total: number | null
}

async function get<T>(path: string): Promise<T[]> {
  const res = await fetch(`${S}/rest/v1/${path}`, { headers: H })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return await res.json() as T[]
}

async function main() {
  // Only work orders that came from a quote can carry this: the converter is the
  // only writer that made the mistake. A hand-entered line was always typed by a
  // tech into the right columns.
  const wos = await get<{ id: string; work_order_number: string; quote_id: string | null }>(
    'hd_work_orders?select=id,work_order_number,quote_id&quote_id=not.is.null&order=created_at.desc')

  console.log(`\n${wos.length} work order(s) created from a quote`)
  if (wos.length === 0) {
    console.log('Nothing the converter could have damaged.')
    return
  }

  let affected = 0
  for (const wo of wos) {
    const lines = await get<Line>(
      `hd_work_order_line_items?work_order_id=eq.${wo.id}&select=id,work_order_id,part_number,description,quantity,unit_cost,unit_price,markup_percent,total&type=eq.part`)

    for (const l of lines) {
      if (l.unit_cost == null || l.markup_percent == null) continue
      const qty = Number(l.quantity ?? 0)
      const computed = r2(qty * sellPrice(Number(l.unit_cost), Number(l.markup_percent)))
      const stored = r2(Number(l.total ?? 0))
      if (Math.abs(computed - stored) < 0.005) continue

      affected++
      if (affected === 1) {
        console.log('\nAFFECTED LINES - the columns compute a different figure than the stored total:')
        console.log('  work order     part              qty   cost   markup   stored   screen shows')
      }
      console.log(
        `  ${wo.work_order_number.padEnd(14)} ${String(l.part_number ?? l.description ?? '').slice(0, 16).padEnd(17)} ` +
        `${String(qty).padStart(3)}   ${Number(l.unit_cost).toFixed(2).padStart(5)}  ` +
        `${String(l.markup_percent).padStart(5)}%   ${stored.toFixed(2).padStart(6)}   ${computed.toFixed(2).padStart(6)}`)
      console.log(`    line id: ${l.id}`)
    }
  }

  console.log('')
  if (affected === 0) {
    console.log('CLEAN: no existing part line carries the doubled markup.')
  } else {
    console.log(`${affected} line(s) affected. The STORED total is still the quoted figure,`)
    console.log('so nothing has been over-billed yet - but the screen shows the doubled price,')
    console.log('and saving that line through the editor would make the doubled figure real.')
    console.log('Repair is hand-run SQL, not this script.')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
