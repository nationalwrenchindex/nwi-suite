// READ-ONLY. Did the smoke suite leave anything behind?
//
// Every row the suite creates carries the ZZ marker in a name, and the rule is that
// every one is deleted in a finally. This asks the database whether that held - it is
// the only way to know, because a cleanup that silently fails looks exactly like a
// cleanup that worked.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

// The SAME marker scripts/smoke.ts uses. It was 'ZZ-SMOKE' here on the first draft,
// which matched nothing and reported CLEAN no matter what was left behind - a check
// that cannot fail.
const MARK = 'SMOKE'

async function count(table: string, query: string): Promise<number | string> {
  const res = await fetch(`${S}/rest/v1/${table}?${query}`, {
    headers: { ...H, Prefer: 'count=exact' },
  })
  if (!res.ok) return `error ${res.status}`
  const range = res.headers.get('content-range') ?? ''
  return Number(range.split('/')[1] ?? 0)
}

async function main() {
  const checks: Array<[string, string]> = [
    ['hd_quotes',       `select=id&customer_name=like.${MARK}*`],
    ['hd_work_orders',  `select=id&customer_name=like.${MARK}*`],
    ['hd_invoices',     `select=id&customer_name=like.${MARK}*`],
    ['work_orders',     `select=id&job_description=like.${MARK}*`],
    ['quotes',          `select=id&notes=like.${MARK}*`],
  ]

  let dirty = 0
  console.log('\nrows still carrying the smoke marker')
  for (const [table, query] of checks) {
    const n = await count(table, query)
    if (typeof n === 'number' && n > 0) dirty += n
    console.log(`  ${String(n).padStart(4)}  ${table}`)
  }
  console.log('')
  console.log(dirty === 0
    ? 'CLEAN: the suite left nothing behind.'
    : `DIRTY: ${dirty} row(s) left behind - the cleanup did not hold.`)
}

main().catch(e => { console.error(e); process.exit(1) })
