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
  is_comped:              boolean
  vertical:               string
}

// ─── Module access helpers ─────────────────────────────────────────────────────

const FOUNDER_BYPASS_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'
const PAID_TIERS = new Set(['full_suite', 'pro', 'starter', 'hd_elite', 'hd_pro'])

// Checks both 'module' and 'hd_module' variants so HD subscribers pass LD gates.
function hasModuleVariant(modules: string[], module: string): boolean {
  const bare = module.startsWith('hd_') ? module.slice(3) : module
  const hd   = module.startsWith('hd_') ? module : `hd_${module}`
  return modules.includes(bare) || modules.includes(hd)
}

// Single source-of-truth gate for every paid module.
// Rules (any one is sufficient after status check):
//   1. Founder bypass
//   2. is_comped = true
//   3. tier in PAID_TIERS
//   4. modules array includes bare OR hd_ variant of the module slug
export async function canAccessModule(userId: string, module: string): Promise<boolean> {
  if (userId === FOUNDER_BYPASS_ID) return true
  const supabase = await createClient()
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('status, tier, modules, is_comped')
    .eq('user_id', userId)
    .single()
  if (!sub) return false
  if (!['active', 'trialing', 'past_due'].includes(sub.status)) return false
  if (sub.is_comped) return true
  if (sub.tier && PAID_TIERS.has(sub.tier)) return true
  return hasModuleVariant((sub.modules as string[]) ?? [], module)
}

// ─── Public API ───────────────────────────────────────────────────────────────

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
// Normalizes HD aliases (hd_quickwrench → quickwrench) so AppNav module checks
// using bare names work for all subscription types.
export async function getModuleAccess(userId: string): Promise<string[]> {
  const supabase = await createClient()
  const [{ data: subData }, { data: profileData }] = await Promise.all([
    supabase.from('subscriptions').select('*').eq('user_id', userId).single(),
    supabase.from('profiles').select('foreman_addon_active').eq('id', userId).single(),
  ])

  const sub = subData as Subscription | null
  const modules: string[] = []

  if (sub && ['active', 'trialing', 'past_due'].includes(sub.status)) {
    const rawModules = (sub.modules ?? []) as string[]
    // Normalize: include both the raw name and the bare (non-hd_) alias
    for (const m of rawModules) {
      if (!modules.includes(m)) modules.push(m)
      const bare = m.startsWith('hd_') ? m.slice(3) : null
      if (bare && !modules.includes(bare)) modules.push(bare)
    }

    // Founder bypass gets all modules
    if (userId === FOUNDER_BYPASS_ID && !modules.includes('quickwrench')) {
      modules.push('quickwrench', 'foreman', 'torquewrench', 'scheduler')
    }
  }

  if (profileData?.foreman_addon_active && !modules.includes('scheduler')) {
    modules.push('scheduler')
  }

  return modules
}

export async function hasQuickWrenchAccess(userId: string): Promise<boolean> {
  return canAccessModule(userId, 'quickwrench')
}

export async function hasTorqueWrenchAccess(userId: string): Promise<boolean> {
  // Profile flag (legacy add-on path) OR module gate
  if (await canAccessModule(userId, 'torquewrench')) return true
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('torquewrench_addon_active')
    .eq('id', userId)
    .single()
  return data?.torquewrench_addon_active ?? false
}

export async function hasForemanAccess(userId: string): Promise<boolean> {
  // Profile flag (legacy add-on path) OR module gate
  if (await canAccessModule(userId, 'foreman')) return true
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('foreman_addon_active')
    .eq('id', userId)
    .single()
  return data?.foreman_addon_active ?? false
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

// Resolves user_id from a Foreman-specific Stripe subscription ID (used in webhooks).
export async function getUserIdByForemanSubscription(
  stripeSubscriptionId: string,
): Promise<string | null> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('foreman_stripe_subscription_id', stripeSubscriptionId)
    .single()
  return data?.id ?? null
}
