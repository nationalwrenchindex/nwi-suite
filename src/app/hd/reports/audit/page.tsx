import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import { getEquipmentCategories } from '@/lib/hd/equipment-categories'
import { localDate } from '@/lib/hd/equipment-rollup'
import { parseRange, currentYearRange } from '@/lib/hd/audit-csv'
import { loadShopContext } from '@/lib/hd/audit-load'
import { DEFAULT_AUDIT_LABELS } from '@/lib/hd/audit-labels'
import AuditReportsClient from './AuditReportsClient'

export const metadata = { title: 'Insurance Audit Reports — NWI HD Suite' }
export const dynamic = 'force-dynamic'

// /hd/reports/audit - the insurance audit exports (spec 5.2 and 5.3).
//
// The policy period defaults to the shop's current calendar year, or comes from
// ?from&to. The downloads are plain links to the export routes, so what this page
// renders is exactly what the routes will be asked for.

export default async function HDAuditReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')
  if (!(await checkHDStarterAccess(user.id))) redirect('/hd/upgrade')

  const params = await searchParams
  const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined)

  let ctx: Awaited<ReturnType<typeof loadShopContext>> | null = null
  let loadError: string | null = null
  try {
    ctx = await loadShopContext(supabase, user.id)
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Could not read the shop profile'
  }
  const timeZone = ctx?.timeZone ?? 'America/New_York'
  const today = localDate(new Date().toISOString(), timeZone)!
  const parsed = parseRange(one(params.from), one(params.to), today)
  const range = parsed.ok ? { from: parsed.from, to: parsed.to } : currentYearRange(today)

  const categories = await getEquipmentCategories(supabase, user.id, { includeInactive: true })

  return (
    <main className="flex-1 p-4 sm:p-6 space-y-6">
      <div>
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>HD Suite · Reports</p>
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">INSURANCE AUDIT</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(var(--hd-ink-rgb), 0.5)' }}>
          An equipment schedule and a work order documentation packet for a policy period, built from the
          work orders and invoices you recorded. Nothing is recomputed from current settings.
        </p>
      </div>

      {loadError && <p className="text-sm text-red-400">{loadError}</p>}
      {!parsed.ok && <p className="text-sm text-red-400" data-testid="audit-range-error">{parsed.error} Showing the current year instead.</p>}

      <AuditReportsClient
        initialFrom={range.from}
        initialTo={range.to}
        shopName={ctx?.shop.name ?? null}
        labels={ctx?.labels ?? DEFAULT_AUDIT_LABELS}
        labelsAvailable={ctx?.labelsAvailable ?? false}
        categories={categories.map(c => ({ id: c.id, name: c.name, isActive: c.is_active }))}
      />
    </main>
  )
}
