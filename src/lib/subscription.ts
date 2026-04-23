import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export interface Subscription {
  id:                     string
  user_id:                string
  stripe_customer_id:     string | null
  stripe_subscription_id: string | null
  status:                 string
  tier:                   string | null
  modules:                string[]
  current_period_end:     string | null
  cancel_at_period_end:   boolean
}

// Used in server components / API routes with auth context
export async function getSubscription(userId: string): Promise<Subscription | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single()
  return (data as Subscription | null)
}

// Used in webhook handler (service role, bypasses RLS)
export async function upsertSubscription(
  payload: Partial<Subscription> & { user_id: string },
): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('subscriptions')
    .upsert(payload, { onConflict: 'user_id' })
  if (error) console.error('[upsertSubscription]', error)
}

// Returns the list of module slugs this user can access.
// 'active' and 'trialing' → full access; 'past_due' → grace-period access
export async function getModuleAccess(userId: string): Promise<string[]> {
  const sub = await getSubscription(userId)
  if (!sub) return []
  if (!['active', 'trialing', 'past_due'].includes(sub.status)) return []
  return sub.modules ?? []
}

// Returns true if the user's plan includes QuickWrench (quickwrench or elite tier).
export async function hasQuickWrenchAccess(userId: string): Promise<boolean> {
  const modules = await getModuleAccess(userId)
  return modules.includes('quickwrench')
}

// Resolves user_id from a Stripe customer ID (used in webhooks)
export async function getUserIdByStripeCustomer(
  stripeCustomerId: string,
): Promise<string | null> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', stripeCustomerId)
    .single()
  return data?.user_id ?? null
}

// Resolves user_id from a Stripe subscription ID (used in webhooks)
export async function getUserIdByStripeSubscription(
  stripeSubscriptionId: string,
): Promise<string | null> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .single()
  return data?.user_id ?? null
}
