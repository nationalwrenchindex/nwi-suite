// Shared pieces of the fleet manager dashboard. Server-safe (no hooks) except SignOut.
import Link from 'next/link'
import type { PmDue } from '@/lib/hd/pm-due'

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

/** PM OVERDUE / PM DUE SOON / PM OK - the Intel Hub rule (lib/hd/pm-due), in words. */
export function PmBadge({ due }: { due: PmDue }) {
  const s = due.status
  const label = s === 'overdue' ? 'PM OVERDUE' : s === 'due_soon' ? 'PM DUE SOON' : 'PM OK'
  const style = s === 'overdue'
    ? { background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5' }
    : s === 'due_soon'
      ? { background: '#FFEDD5', color: '#9A3412', border: '1px solid #FDBA74' }
      : { background: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0' }
  return (
    <span data-testid="fm-pm-badge" data-pm={s ?? 'ok'} className="inline-block rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap" style={style}>
      {label}
    </span>
  )
}

/** One line under the badge saying why: hours left, or the date it falls due. */
export function pmDetail(due: PmDue): string | null {
  const parts: string[] = []
  if (due.hoursUntil != null) parts.push(due.hoursUntil <= 0 ? `${Math.abs(due.hoursUntil).toLocaleString('en-US')} hrs past due` : `due in ${due.hoursUntil.toLocaleString('en-US')} hrs`)
  if (due.nextDueDate) parts.push(`by date ${fmtDate(due.nextDueDate)}`)
  return parts.length ? parts.join(' / ') : null
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
