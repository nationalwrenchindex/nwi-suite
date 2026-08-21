import DashboardClient from '@/components/fleet-pro/DashboardClient'

export const metadata = { title: 'Fleet — NWI Fleet Pro' }

// The layout already resolved membership and redirected anyone without one, so
// this page only has to hand the shell to the client fetcher.
export default function FleetProDashboardPage() {
  return (
    <main className="flex-1 p-4 sm:p-6">
      <DashboardClient />
    </main>
  )
}
