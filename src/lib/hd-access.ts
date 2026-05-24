import { createClient } from '@/lib/supabase/server'

const HD_TIERS = ['hd_starter', 'hd_pro', 'hd_elite']

export async function checkHDAccess(userId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('subscriptions')
    .select('tier, status, is_comped, vertical')
    .eq('user_id', userId)
    .single()

  if (!data) return false

  // Comped accounts with heavy_duty vertical always have full access
  if (data.is_comped && data.vertical === 'heavy_duty') return true

  // Active/trialing HD tier subscribers
  const active = ['active', 'trialing', 'past_due'].includes(data.status ?? '')
  return active && HD_TIERS.includes(data.tier ?? '')
}
