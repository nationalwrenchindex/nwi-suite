import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'National Wrench Index Suite',
}

const FEATURES = [
  { icon: '📋', text: 'Job scheduling & dispatch' },
  { icon: '🧾', text: 'Professional invoicing' },
  { icon: '📊', text: 'Expense & revenue tracking' },
  { icon: '🔔', text: 'Automated customer notifications' },
  { icon: '🚗', text: 'Full vehicle service history' },
]

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex">
      {/* ── Left brand panel ── */}
      <div className="hidden lg:flex lg:w-[420px] xl:w-[480px] flex-col bg-blue-gradient relative overflow-hidden flex-shrink-0">
        {/* Decorative circles */}
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white/5" />
        <div className="absolute -bottom-32 -right-16 w-80 h-80 rounded-full bg-white/5" />
        <div className="absolute top-1/3 -right-12 w-48 h-48 rounded-full bg-orange/20" />

        <div className="relative z-10 flex flex-col justify-between h-full p-10">
          {/* Logo */}
          <div>
            <div className="mb-12">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/nwi-logo.png" alt="National Wrench Index Suite™" className="h-14 w-auto" />
            </div>

            <h2 className="font-condensed font-bold text-white text-4xl xl:text-5xl leading-tight mb-4">
              Run your mobile shop <span className="text-orange">smarter.</span>
            </h2>
            <p className="text-white/70 text-base leading-relaxed mb-10">
              Everything a mobile automotive professional needs — from first call to paid invoice.
            </p>

            <ul className="space-y-4">
              {FEATURES.map((f) => (
                <li key={f.text} className="flex items-center gap-3">
                  <span className="text-xl leading-none">{f.icon}</span>
                  <span className="text-white/80 text-sm">{f.text}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Testimonial */}
          <div className="bg-white/10 rounded-xl p-5 border border-white/10">
            <p className="text-white/90 text-sm italic leading-relaxed mb-3">
              &ldquo;I went from tracking jobs in a notebook to running a fully professional operation. NWI paid for itself in the first week.&rdquo;
            </p>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-orange/30 flex items-center justify-center">
                <span className="text-orange font-bold text-xs">MR</span>
              </div>
              <div>
                <p className="text-white text-xs font-semibold">Marcus R.</p>
                <p className="text-white/50 text-xs">Mobile Mechanic, Houston TX</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        {/* Mobile logo strip */}
        <div className="lg:hidden flex items-center gap-3 p-4 border-b border-dark-border bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/nwi-logo.png" alt="National Wrench Index Suite™" className="h-10 w-auto" />
        </div>

        <div className="flex-1 flex items-start justify-center p-6 sm:p-10">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </div>
    </div>
  )
}
