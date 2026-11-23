// The fleet manager dashboard: a fleet customer's own login, reading his fleet's units
// and service history through lib/fleet-view/unit-history - never money.
//
// PHONE FIRST. He checks this standing in a yard: one column, big tap targets, dark
// text on a light page that stays readable in sunlight, no tables to scroll sideways.

export const metadata = { title: 'Fleet Service History - NWI' }

export default function FleetManagerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh" style={{ background: '#F4F5F7', color: '#111827' }}>
      <div className="mx-auto w-full max-w-xl px-4 pb-16 pt-4">{children}</div>
    </div>
  )
}
