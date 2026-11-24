// Shared pieces of the fleet manager dashboard. Server-safe (no hooks) except SignOut.
import Link from 'next/link'

export const INK = '#111827'
export const MUTED = '#4B5563'
export const LINE = '#E5E7EB'
export const ACCENT = '#C2410C'

export function Card({ children, testid }: { children: React.ReactNode; testid?: string }) {
  return (
    <div data-testid={testid} className="rounded-xl p-4" style={{ background: '#FFFFFF', border: `1px solid ${LINE}` }}>
      {children}
    </div>
  )
}

export function fmtHours(h: number | null): string | null {
  return h == null ? null : `${h.toLocaleString('en-US', { maximumFractionDigits: 1 })} hrs`
}
export function fmtMiles(m: number | null): string | null {
  return m == null ? null : `${m.toLocaleString('en-US', { maximumFractionDigits: 0 })} mi`
}
export function fmtDate(d: string | null): string {
  if (!d) return 'No date'
  const t = new Date(`${d}T12:00:00`)
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function Header({ title, sub, back }: { title: string; sub?: string | null; back?: { href: string; label: string } }) {
  return (
    <header className="mb-4">
      {back && (
        <Link href={back.href} className="inline-block py-2 text-sm font-semibold" style={{ color: ACCENT }}>
          {'<'} {back.label}
        </Link>
      )}
      <h1 className="text-2xl font-bold leading-tight" style={{ color: INK }}>{title}</h1>
      {sub && <p className="mt-1 text-sm" style={{ color: MUTED }}>{sub}</p>}
    </header>
  )
}
