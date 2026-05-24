import Link from 'next/link'

export const metadata = { title: 'Upgrade — NWI HD Suite' }

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

export default function HDUpgradePage() {
  return (
    <main className="flex-1 p-6 flex items-center justify-center">
      <div className="max-w-md w-full text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
          style={{ background: `${HD_ORANGE}20` }}
        >
          <svg className="w-8 h-8" fill="none" stroke={HD_ORANGE} strokeWidth={1.75} viewBox="0 0 24 24">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <h1 className="font-condensed font-bold text-2xl text-white tracking-wide mb-2">HD STARTER REQUIRED</h1>
        <p className="text-sm mb-6" style={{ color: 'rgba(255,255,255,0.5)' }}>
          This module is available on HD Starter and above. Your current plan includes QuickWrench, EPA 608 Log, and PM intervals.
        </p>
        <div className="rounded-xl p-5 mb-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>Your Reefer Plan Includes</p>
          <div className="space-y-2 text-sm text-left">
            {['HD QuickWrench (alarm codes + web search)', 'EPA 608 Refrigerant Log', 'PM Interval Calculator', 'Alarm Code Lookup'].map(f => (
              <div key={f} className="flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.7)' }}>
                <span style={{ color: '#22C55E' }}>✓</span>{f}
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <a
            href="/billing"
            className="block w-full py-3 rounded-xl font-bold text-white text-sm"
            style={{ background: HD_ORANGE }}
          >
            Upgrade to HD Starter — $149/mo
          </a>
          <Link
            href="/hd/dashboard"
            className="block w-full py-3 rounded-xl text-sm"
            style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }}
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </main>
  )
}
