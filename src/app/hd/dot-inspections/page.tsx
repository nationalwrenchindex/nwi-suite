import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'DOT Inspections — NWI HD Suite' }

const HD_ORANGE = '#E85D24'

export default async function DOTInspectionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  return (
    <main className="flex-1 p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite — Compliance</p>
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">DOT INSPECTIONS</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
          FMCSA annual inspections, Level I–VI roadside inspections, and vehicle condition reports.
        </p>
      </div>

      <div className="rounded-xl p-10 text-center" style={{ background: '#111920', border: `1px solid ${HD_ORANGE}40` }}>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: `${HD_ORANGE}20` }}>
          <svg className="w-7 h-7" style={{ color: HD_ORANGE }} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>
        <p className="font-condensed font-bold text-white text-xl tracking-wide mb-2">DOT INSPECTIONS</p>
        <p className="text-sm mb-1" style={{ color: 'rgba(255,255,255,0.5)' }}>Coming in HD Suite Phase 2</p>
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Annual inspection tracking, roadside inspection records, out-of-service history, FMCSA compliance calendar
        </p>
      </div>
    </main>
  )
}
