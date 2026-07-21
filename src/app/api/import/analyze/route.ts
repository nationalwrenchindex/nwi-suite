import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

const NWI_FIELDS = [
  'customer_first_name',
  'customer_last_name',
  'customer_full_name',
  'customer_phone',
  'customer_email',
  'vehicle_year',
  'vehicle_make',
  'vehicle_model',
  'vehicle_vin',
  'job_date',
  'job_service_type',
  'job_notes',
  'skip',
] as const

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { headers, firstRows } = await req.json() as {
    headers: string[]
    firstRows: Record<string, string>[]
  }

  if (!headers?.length) {
    return NextResponse.json({ error: 'No headers provided' }, { status: 400 })
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const sampleText = firstRows
    .slice(0, 5)
    .map((row, i) => `Row ${i + 1}: ${JSON.stringify(row)}`)
    .join('\n')

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `You help import data into LawnPlatform, a platform for mobile mechanics and auto technicians.

The user uploaded a CSV with these column headers:
${headers.map(h => `"${h}"`).join(', ')}

Sample data (first rows):
${sampleText}

Map each column to ONE of these NWI fields, or "skip" if it doesn't apply:
${NWI_FIELDS.filter(f => f !== 'skip').map(f => `- ${f}`).join('\n')}
- skip (ignore this column)

Rules:
- customer_full_name if the name is combined (e.g. "John Smith"), otherwise use first/last separately
- job_date for any date column related to when work was done, invoiced, or ordered
- job_service_type for service description, job type, item description, or product name columns
- skip for columns like invoice numbers, internal IDs, tax amounts, discount codes, etc.

Return ONLY a valid JSON object. Keys are the exact original column headers, values are NWI field names.
Example: {"Customer": "customer_full_name", "Phone": "customer_phone", "Invoice Date": "job_date"}`,
      },
    ],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return NextResponse.json({ error: 'AI returned unexpected format' }, { status: 500 })

  try {
    const mapping: Record<string, string> = JSON.parse(match[0])
    // Validate all values are known NWI fields
    for (const [, v] of Object.entries(mapping)) {
      if (!(NWI_FIELDS as readonly string[]).includes(v)) {
        mapping[Object.keys(mapping).find(k => mapping[k] === v)!] = 'skip'
      }
    }
    return NextResponse.json({ mapping })
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
  }
}
