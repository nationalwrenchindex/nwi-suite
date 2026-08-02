import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { generateDiagnostic, isGeminiConfigured } from '@/lib/gemini/client'

export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `You are an expert heavy duty mechanic assistant.
Based on the complaint, diagnosis, and vehicle info,
suggest the most likely labor lines needed for this
repair. Return ONLY a JSON array with no explanation:
[
  {
    "description": "R&R Fuel Filter Primary",
    "mobile_hours": 0.3,
    "book_hours": 0.3,
    "category": "fuel"
  }
]
Maximum 6 suggestions. Use realistic mobile field
times — mobile mechanics work without lifts or air
tools, add 25% to shop times. Only suggest labor
that directly addresses the stated complaint.`

interface Suggestion {
  description: string
  mobile_hours: number
  book_hours: number
  category: string
}

// Extract the first JSON array from a model response (tolerates ``` fences / prose).
function parseSuggestions(text: string): Suggestion[] {
  let raw = text.trim()
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) raw = fence[1].trim()
  const start = raw.indexOf('[')
  const end   = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return []
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1))
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((s: Record<string, unknown>) => {
        const mobile = Number(s.mobile_hours)
        const book   = Number(s.book_hours)
        return {
          description: typeof s.description === 'string' ? s.description.trim() : '',
          mobile_hours: Number.isFinite(mobile) ? mobile : 0,
          book_hours:   Number.isFinite(book) ? book : (Number.isFinite(mobile) ? mobile : 0),
          category:    typeof s.category === 'string' ? s.category.trim() : '',
        }
      })
      .filter(s => s.description.length > 0)
      .slice(0, 6)
  } catch {
    return []
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  if (!isGeminiConfigured()) {
    return NextResponse.json({ error: 'AI suggestions are not configured' }, { status: 503 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '')
  const complaint = str(body.complaint)
  const diagnosis = str(body.diagnosis)
  if (!complaint && !diagnosis) {
    return NextResponse.json({ error: 'complaint or diagnosis is required' }, { status: 400 })
  }

  const isTruck = body.is_truck === true
  const lines: string[] = []
  if (isTruck) {
    const truck = [str(body.truck_year), str(body.truck_make), str(body.truck_model)].filter(Boolean).join(' ')
    if (truck) lines.push(`Truck: ${truck}`)
    if (str(body.vin)) lines.push(`VIN: ${str(body.vin)}`)
  } else {
    const unit = [str(body.unit_year), str(body.unit_manufacturer), str(body.unit_model)].filter(Boolean).join(' ')
    if (unit) lines.push(`Reefer unit: ${unit}`)
    if (str(body.vin)) lines.push(`VIN: ${str(body.vin)}`)
  }
  if (complaint) lines.push(`Complaint: ${complaint}`)
  if (diagnosis) lines.push(`Diagnosis: ${diagnosis}`)

  const userPrompt =
    `${isTruck ? 'This is a heavy-duty truck/tractor repair.' : 'This is a truck reefer (transport refrigeration) unit repair.'}\n` +
    lines.join('\n') +
    `\n\nSuggest the labor lines needed. Return ONLY the JSON array.`

  try {
    const { text } = await generateDiagnostic(userPrompt, SYSTEM_PROMPT)
    const suggestions = parseSuggestions(text)
    return NextResponse.json({ suggestions })
  } catch (err) {
    console.error('[hd/labor-suggestions]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'AI request failed' }, { status: 502 })
  }
}
