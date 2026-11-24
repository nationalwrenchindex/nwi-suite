// /fleet-manager/login - the fleet manager signs in with his own email and password.
// Its own page rather than /login: /login sends an account with no business name to
// the mechanic onboarding wizard, which a fleet customer must never see.

import LoginForm from '@/components/fleet-manager/LoginForm'

export const dynamic = 'force-dynamic'

export default async function FleetManagerLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return <LoginForm linkError={error === 'link'} />
}
