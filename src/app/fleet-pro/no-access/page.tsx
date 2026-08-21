export const metadata = { title: 'Fleet Pro — No Access' }

export default function FleetProNoAccessPage() {
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div
        className="max-w-md w-full rounded-xl p-8 text-center"
        style={{ background: '#111920', border: '1px solid #1e3040' }}
      >
        <p className="text-xs uppercase tracking-widest mb-2" style={{ color: '#E85D24' }}>
          NWI Fleet Pro
        </p>
        <h1 className="font-condensed font-bold text-2xl text-white tracking-wide mb-3">
          NO ACTIVE FLEET ACCESS
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
          This account is not currently a member of a Fleet Pro fleet. If your
          department has a Fleet Pro subscription, ask your fleet manager to send
          you an invitation. If your subscription has lapsed, your maintenance
          contractor can reactivate it.
        </p>
      </div>
    </main>
  )
}
