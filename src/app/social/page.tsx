import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import SocialClient from '@/components/social/SocialClient'

export const metadata = { title: 'NWI Social' }

export default async function SocialPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, business_name, business_type')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  const FOUNDER_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'
  if (user.id !== FOUNDER_ID) redirect('/dashboard')

  const today    = new Date()
  const todayStr = today.toISOString().slice(0, 10)

  const { data: posts } = await supabase
    .from('social_posts')
    .select('id, platform, content, visual_suggestion, image_prompt, image_url, theme, status, created_at, posted_at')
    .eq('user_id', user.id)
    .gte('created_at', `${todayStr}T00:00:00Z`)
    .lt('created_at', `${todayStr}T23:59:59Z`)
    .order('created_at', { ascending: true })

  const dayOfWeek = today.getDay()
  const dayNames  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const themes    = [
    "Week in review and what's coming",
    'Founder story and motivation',
    'Product demo and features',
    'Education and mechanic tips',
    'Social proof and results',
    'Behind the scenes building',
    'Community engagement and questions',
  ]

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav
        businessName={profile.business_name}
        businessType={profile.business_type ?? undefined}
      />
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6">
        <SocialClient
          initialPosts={posts ?? []}
          todayTheme={themes[dayOfWeek]}
          dayName={dayNames[dayOfWeek]}
        />
      </main>
    </div>
  )
}
