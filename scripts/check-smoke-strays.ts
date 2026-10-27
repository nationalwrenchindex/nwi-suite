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
    // The tables flows S and T arrange directly, and the customers row logHDCustomer
    // makes for every HD quote the suite saves. Without these the check reported CLEAN
    // over six smoke customers left in production (found 2026-10-14).
    ['hd_fleet_accounts', `select=id&fleet_name=like.${MARK}*`],
    ['hd_units',          `select=id&unit_number=like.ZZ*`],
    ['customers',         `select=id&or=(first_name.like.${MARK}*,company_name.like.${MARK}*)`],
  ]

  let dirty = 0
  console.log('\nrows still carrying the smoke marker')
  for (const [table, query] of checks) {
    const n = await count(table, query)
    if (typeof n === 'number' && n > 0) dirty += n
    console.log(`  ${String(n).padStart(4)}  ${table}`)
  }
  // Flow Rf's throwaway Reefer Standalone accounts (smoke-reefer-<n>@example.com).
  const usersRes = await fetch(`${S}/auth/v1/admin/users?per_page=200`, { headers: H })
  const usersJson = await usersRes.json()
  const users = (Array.isArray(usersJson) ? usersJson : usersJson.users ?? []) as Array<{ email?: string }>
  const reeferLeft = users.filter(u => /^smoke-reefer-\d+@example\.com$/.test(u.email ?? '')).length
  dirty += reeferLeft
  console.log(`  ${String(reeferLeft).padStart(4)}  auth users smoke-reefer-*`)
  const rsSubs = await count('subscriptions', 'select=id&tier=eq.reefer_standalone')
  if (typeof rsSubs === 'number') dirty += rsSubs
  console.log(`  ${String(rsSubs).padStart(4)}  subscriptions tier reefer_standalone (none exist outside a run yet)`)
  console.log('')
  console.log(dirty === 0
    ? 'CLEAN: the suite left nothing behind.'
    : `DIRTY: ${dirty} row(s) left behind - the cleanup did not hold.`)
}

main().catch(e => { console.error(e); process.exit(1) })
