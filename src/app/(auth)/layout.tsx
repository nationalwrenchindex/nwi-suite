import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'LawnPlatform',
}

const FEATURES = [
  { icon: '📋', text: 'Job scheduling & dispatch' },
  { icon: '🧾', text: 'Professional invoicing' },
  { icon: '📊', text: 'Expense & revenue tracking' },
  { icon: '🔔', text: 'Automated customer notifications' },
  { icon: '🌱', text: 'Full property service history' },
]

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col lg:flex-row">
      {/* ── Left brand panel ── */}
      {/* Mobile: full-width top section. Desktop lg+: fixed-width sidebar */}
      <div className="lg:w-[420px] xl:w-[480px] lg:flex-shrink-0 bg-blue-gradient relative overflow-hidden flex flex-col">
        {/* Decorative circles — desktop only (too large for mobile) */}
        <div className="hidden lg:block absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white/5" />
        <div className="hidden lg:block absolute -bottom-32 -right-16 w-80 h-80 rounded-full bg-white/5" />
        <div className="hidden lg:block absolute top-1/3 -right-12 w-48 h-48 rounded-full bg-orange/20" />

        <div className="relative z-10 flex flex-col lg:justify-between lg:h-full p-6 sm:p-8 lg:p-10">
          {/* Logo */}
          <div>
            <div className="mb-5 lg:mb-12 flex items-center gap-3">
              <span className="flex items-center justify-center h-11 w-11 rounded-lg bg-white/15 font-condensed font-extrabold text-xl text-white">
                LP
              </span>
              <span className="font-condensed font-bold text-white text-xl">LawnPlatform</span>
            </div>

            <h2 className="font-condensed font-bold text-white text-3xl sm:text-4xl xl:text-5xl leading-tight mb-3 lg:mb-4">
              Run your lawn business <span className="text-orange">smarter.</span>
            </h2>
            <p className="text-white/70 text-sm lg:text-base leading-relaxed mb-5 lg:mb-10">
              Everything a lawn and landscape pro needs — from first call to paid invoice.
            </p>

            <ul className="space-y-3 lg:space-y-4">
              {FEATURES.map((f) => (
                <li key={f.text} className="flex items-center gap-3">
                  <span className="text-lg lg:text-xl leading-none">{f.icon}</span>
                  <span className="text-white/80 text-sm">{f.text}</span>
                </li>
              ))}
            </ul>

            {/* Mobile CTA — primary signup button, hidden on desktop (form panel handles CTAs) */}
            <div className="lg:hidden mt-6 pb-2 space-y-3">
              <Link
                href="/signup"
                className="block text-center py-3.5 bg-orange hover:bg-orange/90 text-white font-condensed font-bold text-sm rounded-xl tracking-wide transition-colors"
              >
                GET STARTED FREE →
              </Link>
              <p className="text-white/60 text-xs text-center">
                Already have an account?{' '}
                <Link href="/login" className="text-white underline">Sign in</Link>
              </p>
            </div>
          </div>

          {/* Founder statement — desktop only */}
          <div className="hidden lg:block bg-white/10 rounded-xl p-5 border border-white/10">
            <p className="text-white/90 text-sm italic leading-relaxed mb-3">
              &ldquo;Built for the crews in the field — the software I wished I&rsquo;d had when I started my business.&rdquo;
            </p>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-orange/30 flex items-center justify-center">
                <span className="text-orange font-bold text-xs">BF</span>
              </div>
              <div>
                <p className="text-white text-xs font-semibold">Brock Fleeman, Founder</p>
                <p className="text-white/50 text-xs">Built for lawn and landscape pros</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        <div className="flex-1 flex items-start justify-center p-6 sm:p-10">
          <div className="w-full max-w-md">{children}</div>
        </div>

        <footer className="border-t border-dark-border px-6 py-4 flex items-center justify-center gap-5 text-white/25 text-xs">
          <span>&copy; {new Date().getFullYear()} LawnPlatform · Powered by National Wrench Index LLC</span>
          <Link href="/terms"   className="hover:text-white/50 transition-colors">Terms of Service</Link>
          <Link href="/privacy" className="hover:text-white/50 transition-colors">Privacy Policy</Link>
        </footer>
      </div>
    </div>
  )
}
