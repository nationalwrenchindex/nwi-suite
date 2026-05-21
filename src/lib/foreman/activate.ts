import { createServiceClient } from '@/lib/supabase/service'

export type ForemanActivationReason = 'on_job' | 'after_hours' | 'manual' | null

export async function setForemanActive(
  userId: string,
  active: boolean,
  reason: ForemanActivationReason,
): Promise<void> {
  const svc = createServiceClient()
  const { error } = await svc
    .from('foreman_settings')
    .update({
      is_enabled:                active,
      foreman_activated_reason:  active ? reason : null,
      updated_at:                new Date().toISOString(),
    })
    .eq('user_id', userId)

  if (error) {
    console.error(`[foreman/activate] setForemanActive(${userId}, ${active}, ${reason}) error:`, error)
    throw error
  }
  console.log(`[foreman/activate] user=${userId} active=${active} reason=${reason}`)
}

export interface BusinessHoursDay {
  open:   string  // HH:MM
  close:  string  // HH:MM
  closed: boolean
}

export type BusinessHours = Partial<Record<string, BusinessHoursDay>>

export function shouldForemanBeActiveForHours(businessHours: BusinessHours | null | undefined): boolean {
  if (!businessHours) return false
  const days   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const now    = new Date()
  const day    = days[now.getDay()]
  const config = businessHours[day]

  if (!config) return true  // no config for this day = treat as always after-hours
  if (config.closed) return true  // closed day = Foreman active all day

  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const t  = `${hh}:${mm}`
  return t < config.open || t >= config.close
}
