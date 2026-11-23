// /fleet-manager/no-access - signed in, but this login holds no fleet manager access
// (never invited, or the shop removed it).
import SignOut from '@/components/fleet-manager/SignOut'

export default function FleetManagerNoAccess() {
  return (
    <main className="pt-8">
      <h1 className="mb-3 text-2xl font-bold" style={{ color: '#111827' }}>No fleet access on this login</h1>
      <p className="mb-6 text-sm leading-relaxed" style={{ color: '#374151' }}>
        This login is not set up to see a fleet&apos;s service history. Ask your service shop to invite the email address you use.
      </p>
      <SignOut />
    </main>
  )
}
