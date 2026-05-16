import { createServiceClient } from '@/lib/supabase/service'
import { FOREMAN_SUBSCRIBER_CAP } from './config'

export async function getCurrentForemanSubscriberCount(): Promise<number> {
  const svc = createServiceClient()
  const { count } = await svc
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('foreman_addon_active', true)
  return count ?? 0
}

export async function isForemanAvailable(): Promise<boolean> {
  const count = await getCurrentForemanSubscriberCount()
  return count < FOREMAN_SUBSCRIBER_CAP
}

export async function getForemanWaitlistCount(): Promise<number> {
  const svc = createServiceClient()
  const { count } = await svc
    .from('foreman_waitlist')
    .select('*', { count: 'exact', head: true })
  return count ?? 0
}
