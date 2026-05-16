import { isForemanAvailable } from '@/lib/foreman/cap'
import SignupClient from './SignupClient'

export const metadata = { title: 'Create Account — NWI Suite' }

export default async function SignupPage() {
  const foremanAvailable = await isForemanAvailable()
  return <SignupClient foremanAvailable={foremanAvailable} />
}
