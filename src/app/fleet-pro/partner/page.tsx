import PartnerDashboardClient from '@/components/fleet-pro/partner/PartnerDashboardClient'

export const metadata = { title: 'Fleet Accounts — NWI Fleet Pro' }

// The layout already resolved (or created) the partner row and redirected anyone
// who is not one, so this page only has to hand the shell to the client fetcher.
export default function PartnerOverviewPage() {
  return (
    <main className="flex-1 p-4 sm:p-6">
      <PartnerDashboardClient />
    </main>
  )
}
