'use client'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function SignOut() {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={async () => { await createClient().auth.signOut(); router.push('/fleet-manager/login'); router.refresh() }}
      className="rounded-lg px-3 py-2 text-sm font-semibold"
      style={{ color: '#374151', border: '1px solid #D1D5DB', background: '#FFFFFF' }}
    >
      Sign out
    </button>
  )
}
