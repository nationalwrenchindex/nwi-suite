// POST /api/quickwrench/tech-guide
// Generates a vehicle-specific repair guide via Gemini (Google Search grounded).
// Shared guide prompt + JSON parsing live in src/lib/tech-guide.ts.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasQuickWrenchAccess } from '@/lib/subscription'
import { callTechGuideGemini } from '@/lib/tech-guide'
import { isGeminiConfigured } from '@/lib/gemini/client'
import type { TechGuideRequest } from '@/types/quickwrench'

// Gemini grounding runs up to 55s per attempt; 60s prevents Vercel's default timeout kill.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasQuickWrenchAccess(user.id)) {
    return NextResponse.json({ error: 'QuickWrench requires QuickWrench or Elite plan.' }, { status: 403 })
  }

  if (!isGeminiConfigured()) {
    console.error('[tech-guide] GEMINI_API_KEY is not set in environment variables')
    return NextResponse.json({ error: 'AI service not configured.' }, { status: 503 })
  }

  let body: TechGuideRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { vehicle, job } = body
  if (!vehicle?.year || !vehicle?.make || !vehicle?.model || !job?.name) {
    return NextResponse.json({ error: 'vehicle and job are required.' }, { status: 400 })
  }

  const guide = await callTechGuideGemini(vehicle, job)

  if (!guide) {
    return NextResponse.json(
      { error: 'AI response could not be parsed. Please try again.' },
      { status: 502 },
    )
  }

  return NextResponse.json({ guide })
}
