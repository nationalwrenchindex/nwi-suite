import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'

export const metadata = { title: 'DOT Inspections — NWI HD Suite' }

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

export default async function DOTInspectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDStarterAccess(user.id)
  if (!hasAccess) redirect('/hd/upgrade')

  const params = await searchParams
  const q       = typeof params.q      === 'string' ? params.q.trim()  : ''
  const result  = typeof params.result === 'string' ? params.result     : ''
  const unitId  = typeof params.unit   === 'string' ? params.unit       : ''
  const acctId  = typeof params.acct   === 'string' ? params.acct       : ''

  // Load inspections
  let query = supabase
    .from('hd_dot_inspections')
    .select(`
      id, inspection_id, inspection_date, overall_result,
      inspector_name, inspector_cert_number, locked, created_at,
      unit:hd_units(unit_number, manufacturer, model),
      fleet_account:hd_fleet_accounts(fleet_name)
    `)
    .eq('user_id', user.id)
    .order('inspection_date', { ascending: false })
    .limit(100)

  if (result === 'pass' || result === 'fail') query = query.eq('overall_result', result)
  if (unitId)  query = query.eq('unit_id', unitId)
  if (acctId)  query = query.eq('fleet_account_id', acctId)

  const { data: inspections } = await query

  // Load units + accounts for filter dropdowns
  const [{ data: units }, { data: accounts }] = await Promise.all([
    supabase.from('hd_units').select('id, unit_number').eq('user_id', user.id).order('unit_number'),
    supabase.from('hd_fleet_accounts').select('id, fleet_name').eq('user_id', user.id).order('fleet_name'),
  ])

  // Client-side search filter on unit number + inspector name
  const rows = (inspections ?? []).filter(ins => {
    if (!q) return true
    const ql = q.toLowerCase()
    const unitNum  = (ins.unit as { unit_number?: string } | null)?.unit_number?.toLowerCase() ?? ''
    const inspector = (ins.inspector_name ?? '').toLowerCase()
    return unitNum.includes(ql) || inspector.includes(ql)
  })

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            HD Suite — Compliance
          </p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">DOT INSPECTIONS</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Annual CVSA inspection records — digitally signed and locked.
          </p>
        </div>
        <Link
          href="/hd/dot-inspections/new"
          className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white flex-shrink-0"
          style={{ background: HD_ORANGE }}
        >
          + New Inspection
        </Link>
      </div>

      {/* Filters */}
      <form method="GET" className="mb-5 grid grid-cols-1 md:grid-cols-4 gap-3">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search unit # or inspector…"
          className="px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/30 col-span-1 md:col-span-2"
          style={{ background: '#111920', border: '1px solid #1e3040' }}
        />
        <select
          name="result"
          defaultValue={result}
          className="px-3 py-2.5 rounded-lg text-sm text-white"
          style={{ background: '#111920', border: '1px solid #1e3040' }}
        >
          <option value="">All Results</option>
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
        </select>
        <select
          name="unit"
          defaultValue={unitId}
          className="px-3 py-2.5 rounded-lg text-sm text-white"
          style={{ background: '#111920', border: '1px solid #1e3040' }}
        >
          <option value="">All Units</option>
          {(units ?? []).map(u => (
            <option key={u.id} value={u.id}>{u.unit_number}</option>
          ))}
        </select>
        <input type="hidden" name="acct" value={acctId} />
        <div className="col-span-1 md:col-span-4 flex gap-2">
          <button
            type="submit"
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ background: HD_BLUE }}
          >
            Filter
          </button>
          {(q || result || unitId || acctId) && (
            <Link
              href="/hd/dot-inspections"
              className="px-4 py-2 rounded-lg text-sm"
              style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }}
            >
              Clear
            </Link>
          )}
        </div>
      </form>

      {/* Fleet account filter chips */}
      {(accounts ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <Link
            href={`/hd/dot-inspections?${new URLSearchParams({ ...(q && { q }), ...(result && { result }), ...(unitId && { unit: unitId }) }).toString()}`}
            className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
            style={!acctId
              ? { background: `${HD_ORANGE}25`, color: HD_ORANGE, border: `1px solid ${HD_ORANGE}50` }
              : { color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }
            }
          >
            All Accounts
          </Link>
          {(accounts ?? []).map(a => (
            <Link
              key={a.id}
              href={`/hd/dot-inspections?${new URLSearchParams({ ...(q && { q }), ...(result && { result }), ...(unitId && { unit: unitId }), acct: a.id }).toString()}`}
              className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
              style={acctId === a.id
                ? { background: `${HD_ORANGE}25`, color: HD_ORANGE, border: `1px solid ${HD_ORANGE}50` }
                : { color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }
              }
            >
              {a.fleet_name}
            </Link>
          ))}
        </div>
      )}

      {/* List */}
      {rows.length === 0 ? (
        <div className="py-20 text-center rounded-xl" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="text-sm mb-2" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {q || result || unitId || acctId ? 'No inspections match your filters' : 'No inspections recorded yet'}
          </p>
          {!q && !result && !unitId && !acctId && (
            <Link href="/hd/dot-inspections/new" className="text-xs" style={{ color: HD_ORANGE }}>
              + Complete your first DOT inspection
            </Link>
          )}
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
          {/* Table header — desktop only */}
          <div
            className="hidden sm:grid text-xs uppercase tracking-widest px-5 py-3"
            style={{ gridTemplateColumns: '1fr 1fr 80px 1fr 120px', background: '#0d1820', color: 'rgba(255,255,255,0.35)' }}
          >
            <span>Unit</span>
            <span>Date</span>
            <span>Result</span>
            <span>Inspector</span>
            <span className="text-right">Actions</span>
          </div>

          {/* Rows */}
          {rows.map((ins, i) => {
            const unit = ins.unit as { unit_number?: string; manufacturer?: string; model?: string } | null
            const acct = ins.fleet_account as { fleet_name?: string } | null
            const isPassed = ins.overall_result === 'pass'
            const rowBg = i % 2 === 0 ? '#111920' : '#0f1820'

            return (
              <div key={ins.id} style={{ borderTop: i > 0 ? '1px solid #1e3040' : undefined }}>
                {/* Mobile card */}
                <div
                  className="sm:hidden px-4 py-4 text-sm"
                  style={{ background: rowBg }}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="font-condensed font-bold text-white text-base tracking-wide leading-tight">
                        {unit?.unit_number ?? '—'}
                      </p>
                      {unit?.manufacturer && (
                        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                          {unit.manufacturer} {unit.model}
                        </p>
                      )}
                      {acct?.fleet_name && (
                        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{acct.fleet_name}</p>
                      )}
                    </div>
                    <span
                      className="text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0"
                      style={{
                        background: isPassed ? '#22C55E20' : '#EF444420',
                        color:      isPassed ? '#22C55E'   : '#EF4444',
                        border:     `1px solid ${isPassed ? '#22C55E50' : '#EF444450'}`,
                      }}
                    >
                      {isPassed ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-white text-sm">
                        {new Date(ins.inspection_date + 'T12:00:00').toLocaleDateString('en-US', {
                          year: 'numeric', month: 'short', day: 'numeric',
                        })}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        {ins.inspector_name ?? '—'}
                      </p>
                    </div>
                    <Link
                      href={`/hd/dot-inspections/${ins.id}`}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white flex-shrink-0"
                      style={{ background: HD_BLUE }}
                    >
                      View
                    </Link>
                  </div>
                </div>

                {/* Desktop grid row */}
                <div
                  className="hidden sm:grid items-center px-5 py-4 text-sm"
                  style={{
                    gridTemplateColumns: '1fr 1fr 80px 1fr 120px',
                    background: rowBg,
                  }}
                >
                  {/* Unit */}
                  <div>
                    <p className="font-condensed font-bold text-white text-base tracking-wide leading-tight">
                      {unit?.unit_number ?? '—'}
                    </p>
                    {unit?.manufacturer && (
                      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        {unit.manufacturer} {unit.model}
                      </p>
                    )}
                    {acct?.fleet_name && (
                      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{acct.fleet_name}</p>
                    )}
                  </div>

                  {/* Date */}
                  <div>
                    <p className="text-white">
                      {new Date(ins.inspection_date + 'T12:00:00').toLocaleDateString('en-US', {
                        year: 'numeric', month: 'short', day: 'numeric',
                      })}
                    </p>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      {ins.inspection_id ?? `DOT-${ins.id.slice(0, 8).toUpperCase()}`}
                    </p>
                  </div>

                  {/* Result */}
                  <div>
                    <span
                      className="text-xs font-bold px-2.5 py-1 rounded-full"
                      style={{
                        background: isPassed ? '#22C55E20' : '#EF444420',
                        color:      isPassed ? '#22C55E'   : '#EF4444',
                        border:     `1px solid ${isPassed ? '#22C55E50' : '#EF444450'}`,
                      }}
                    >
                      {isPassed ? 'PASS' : 'FAIL'}
                    </span>
                  </div>

                  {/* Inspector */}
                  <p style={{ color: 'rgba(255,255,255,0.7)' }}>{ins.inspector_name ?? '—'}</p>

                  {/* Actions */}
                  <div className="flex gap-2 justify-end">
                    <Link
                      href={`/hd/dot-inspections/${ins.id}`}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                      style={{ background: HD_BLUE }}
                    >
                      View
                    </Link>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
