export const metadata = { title: 'NWI Reefer' }

// /reefer/login and /reefer/signup: bare background, no nav, no gate. Their own group so
// that signing in crosses into (app)/layout.tsx, which then renders fresh - gate and nav
// included - instead of keeping this bare render (see (app)/layout.tsx).
export default function ReeferAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh" style={{ background: 'var(--hd-bg)' }}>
      {children}
    </div>
  )
}
