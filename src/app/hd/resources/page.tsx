import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'

export const metadata = { title: 'OEM Resources — NWI HD Suite' }

const HD_ORANGE = '#E85D24'

const RESOURCES = [
  {
    name: 'Cummins QuickServe Online',
    url:  'https://quickserve.cummins.com',
    note: 'Free public access to fault code lookup and basic service information. Dealer account required for full service manual access.',
  },
  {
    name: 'FMCSA Federal Motor Carrier Regulations',
    url:  'https://www.fmcsa.dot.gov/regulations',
    note: 'Federal inspection requirements and compliance regulations for commercial motor vehicles.',
  },
  {
    name: 'EPA Highway Diesel Regulations',
    url:  'https://www.epa.gov/otaq/highway-diesel',
    note: 'Federal emissions standards and aftertreatment compliance requirements.',
  },
]

export default async function ResourcesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDStarterAccess(user.id)
  if (!hasAccess) redirect('/hd/upgrade')

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="max-w-2xl">

        <div className="mb-6">
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            HD Suite — Reference
          </p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">OEM RESOURCES</h1>
        </div>

        {/* Message */}
        <div
          className="rounded-xl p-5 mb-6"
          style={{ background: '#1a1a1a', border: `1px solid ${HD_ORANGE}40` }}
        >
          <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>
            NWI HD Suite exists because independent techs deserve better than being told to call a dealer.
            The resources below require separate access — everything else you need is already in HD QuickWrench.
          </p>
        </div>

        {/* Resource links */}
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
          {RESOURCES.map((link, i) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-[#162030] block"
              style={{
                background:  '#111920',
                borderTop:   i > 0 ? '1px solid #1e3040' : undefined,
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-semibold text-white">{link.name}</p>
                  <svg
                    className="w-3 h-3 flex-shrink-0"
                    style={{ color: 'rgba(255,255,255,0.3)' }}
                    fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  {link.note}
                </p>
                <p className="text-xs mt-1" style={{ color: HD_ORANGE, opacity: 0.65 }}>
                  {link.url.replace('https://', '').split('/')[0]}
                </p>
              </div>
            </a>
          ))}
        </div>

      </div>
    </main>
  )
}
