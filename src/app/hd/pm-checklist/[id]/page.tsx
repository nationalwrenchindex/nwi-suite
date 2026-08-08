import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'

export const metadata = { title: 'PM Report — NWI HD Suite' }

const HD_ORANGE = '#E85D24'

interface Flagged { id?: string; text?: string; section?: string }

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export default async function PMChecklistReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) redirect('/hd/upgrade')

  const { data: pm } = await supabase
    .from('hd_pm_checklists')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!pm) notFound()

  let unitLabel = ''
  if (pm.unit_id) {
    const { data: unit } = await supabase
      .from('hd_units')
      .select('unit_number, manufacturer, model')
      .eq('id', pm.unit_id)
      .maybeSingle()
    if (unit) unitLabel = [unit.unit_number, unit.manufacturer, unit.model].filter(Boolean).join(' ')
  }

  const flagged   = Array.isArray(pm.flagged_items) ? (pm.flagged_items as Flagged[]) : []
  const inspected = pm.checklist_data && typeof pm.checklist_data === 'object' ? Object.keys(pm.checklist_data).length : 0
  const sig       = pm.signature_base64 as string | null

  const rows: [string, string][] = [
    ['PM Type', String(pm.pm_type ?? '—')],
    ['Unit', unitLabel || '—'],
    ['Customer', (pm.customer_name as string) || '—'],
    ['Date', fmtDate(pm.completed_at as string | null)],
    ['Technician', (pm.tech_name as string) || (pm.tech_initials as string) || '—'],
    ['Items Inspected', String(inspected)],
    ['Items Flagged', String(flagged.length)],
    ['Battery CCA', pm.battery_cca != null ? `${pm.battery_cca} CCA${Number(pm.battery_cca) < 800 ? ' — REPLACE' : ''}` : '—'],
    ['Alarm Codes Found', (pm.alarm_codes_found as string) || '—'],
    ['Alarm Codes Cleared', (pm.alarm_codes_cleared as string) || '—'],
  ]

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <Link href="/hd/dashboard" className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>← Dashboard</Link>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-2xl">📋</span>
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">PM CHECKLIST REPORT</h1>
          </div>
          {pm.invoice_id && (
            <Link href={`/hd/invoices/${pm.invoice_id}`} className="text-xs mt-1 inline-block" style={{ color: '#60A5FA' }}>
              View linked invoice →
            </Link>
          )}
        </div>

        <div className="rounded-xl overflow-hidden mb-6" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          {rows.map(([label, value], i) => (
            <div key={label} className="flex justify-between gap-4 px-5 py-3 text-sm" style={{ borderTop: i > 0 ? '1px solid #1e3040' : undefined }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</span>
              <span className="text-right text-white">{value}</span>
            </div>
          ))}
        </div>

        <div className="rounded-xl p-5 mb-6" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-3">FLAGGED ITEMS — CUSTOMER REVIEW</p>
          {flagged.length === 0 ? (
            <p className="text-sm" style={{ color: '#22C55E' }}>None — all inspected items passed.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: '#1e3040' }}>
              {flagged.map((f, i) => (
                <div key={f.id ?? i} className="py-2 text-sm">
                  <span style={{ color: HD_ORANGE }}>⚑ </span>
                  <span className="text-white">{f.text}</span>
                  {f.section && <span className="text-xs ml-2" style={{ color: 'rgba(255,255,255,0.3)' }}>{f.section}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-3">TECHNICIAN SIGNATURE</p>
          {sig ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sig} alt="Signature" style={{ maxHeight: 100, background: '#fff', borderRadius: 6, padding: 4 }} />
          ) : (
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>Signed digitally</p>
          )}
        </div>
      </div>
    </main>
  )
}
