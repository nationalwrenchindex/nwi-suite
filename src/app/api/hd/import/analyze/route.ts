import { NextResponse, type NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

const anthropic = new Anthropic()

const UNIT_FIELDS = [
  { key: 'unit_number',   label: 'Unit Number',        required: true  },
  { key: 'manufacturer',  label: 'Manufacturer / Make', required: true  },
  { key: 'model',         label: 'Model',               required: false },
  { key: 'year',          label: 'Year',                required: false },
  { key: 'serial_number', label: 'Serial / VIN',        required: false },
  { key: 'engine_hours',  label: 'Engine Hours',        required: false },
  { key: 'total_hours',   label: 'Total Hours / SMH',   required: false },
  { key: 'fleet_name',    label: 'Fleet / Customer',    required: false },
  { key: 'unit_type',     label: 'Unit Type (truck/trailer)', required: false },
  { key: 'notes',         label: 'Notes',               required: false },
]

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { headers: string[]; sample_rows?: string[][] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const { headers, sample_rows = [] } = body
  if (!headers?.length) return NextResponse.json({ error: 'No headers' }, { status: 400 })

  const fieldList = UNIT_FIELDS.map(f => `- ${f.key} (${f.label}${f.required ? ', REQUIRED' : ''})`).join('\n')
  const sampleStr = sample_rows.slice(0, 3).map(r => r.join(', ')).join('\n')

  const prompt = `You are mapping CSV columns from a heavy-duty fleet service company to database fields.

CSV headers: ${headers.join(', ')}
${sampleStr ? `Sample data (first 3 rows):\n${sampleStr}` : ''}

Target fields for fleet unit import:
${fieldList}

Common HD industry variations to recognize:
- "truck number", "trailer number", "asset #", "asset number", "equip #" → unit_number
- "make", "manufacturer", "brand", "OEM" → manufacturer
- "s/n", "serial", "VIN", "vin number" → serial_number
- "SMH", "service hours", "meter", "hourmeter", "total hours" → total_hours or engine_hours
- "customer", "fleet", "company", "account" → fleet_name
- "type", "unit type", "asset type" → unit_type

Return a JSON array:
[{"csv_header":"exact header","field_key":"target key or null","confidence":"high|medium|low"}]

Include all CSV headers. Use null for no match. Return only JSON.`

  let mapping: Array<{ csv_header: string; field_key: string | null; confidence: string }> = []

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '[]'
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (jsonMatch) mapping = JSON.parse(jsonMatch[0])
  } catch {
    // Naive fallback
    mapping = headers.map(h => {
      const lower = h.toLowerCase().replace(/[\s_#-]/g, '')
      const match = UNIT_FIELDS.find(f => {
        const fk = f.key.replace(/_/g, '')
        const fl = f.label.toLowerCase().replace(/[^a-z]/g, '')
        return lower === fk || lower === fl || lower.includes(fk) || fk.includes(lower)
      })
      return { csv_header: h, field_key: match?.key ?? null, confidence: match ? 'medium' : 'low' }
    })
  }

  return NextResponse.json({ mapping, available_fields: UNIT_FIELDS })
}
