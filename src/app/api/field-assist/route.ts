import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkFieldAssistAccess } from '@/lib/landscaping/access'
import { analyzeImage, analyzeText } from '@/lib/field-assist/gemini'

export const maxDuration = 60

// ── System prompts (per Field Assist tool) ──

const PLANT_PROMPT = `You are an expert horticulturist and landscape professional. Analyze this plant image and provide: common name, botanical name, care requirements (sun, water, soil), seasonal behavior, disease vulnerability, recommended treatments, and whether this plant is invasive in the southeastern United States. Include replacement suggestions if the plant is invasive or problematic. Format your response in clear sections a field landscaper can read quickly on their phone. Use short markdown headers (##) for each section and bullet points.`

const LAWN_PROMPT = `You are an expert turf management specialist. Analyze this lawn image and identify: the specific problem (disease, pest, nutrient deficiency, drought stress, fungus, grubs, or other), the likely cause, recommended treatment products and application rates, whether to treat immediately or monitor, and estimated cost of treatment. Format for a mobile landscaper reading quickly in the field. Use short markdown headers (##) for each section and bullet points.`

const PEST_PROMPT = `You are an expert in turf and landscape pest management and weed identification. Analyze this image and identify: the pest or weed species, the damage it causes, recommended control methods (organic and chemical options), application timing, and whether it poses a serious threat to the lawn or landscape. Format for a mobile landscaper reading quickly on their phone. Use short markdown headers (##) for each section and bullet points.`

const ESTIMATE_PROMPT = `You are an experienced landscaping business owner and estimator working in the southeastern United States. Given a service type, property size tier, and property condition, provide a practical field estimate. Return these sections using short markdown headers (##): Estimated Time to Complete, Suggested Price Range (USD), Materials Needed & Estimated Cost, and Pricing Notes (anything that affects pricing). Base your pricing on typical southeastern US market rates for independent mobile landscapers. Be concise and specific with numbers.`

type Tool = 'plant' | 'lawn' | 'pest' | 'estimate'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await checkFieldAssistAccess(user.id))) {
    return NextResponse.json({ error: 'Field Assist requires an active Landscaping subscription.' }, { status: 403 })
  }

  let body: {
    tool?: Tool
    imageBase64?: string
    mimeType?: string
    hint?: string
    serviceType?: string
    propertySize?: string
    condition?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { tool } = body
  if (!tool) return NextResponse.json({ error: 'Missing tool.' }, { status: 400 })

  try {
    let result: string

    if (tool === 'estimate') {
      const { serviceType, propertySize, condition } = body
      if (!serviceType || !propertySize || !condition) {
        return NextResponse.json({ error: 'Service type, property size, and condition are required.' }, { status: 400 })
      }
      const userText = `Service type: ${serviceType}\nProperty size: ${propertySize}\nCondition: ${condition}\n\nProvide a field estimate.`
      result = await analyzeText(ESTIMATE_PROMPT, userText)
    } else {
      const { imageBase64, mimeType, hint } = body
      if (!imageBase64 || !mimeType) {
        return NextResponse.json({ error: 'An image is required for this tool.' }, { status: 400 })
      }
      const prompt = tool === 'plant' ? PLANT_PROMPT : tool === 'lawn' ? LAWN_PROMPT : PEST_PROMPT
      result = await analyzeImage(prompt, imageBase64, mimeType, hint)
    }

    return NextResponse.json({ result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Field Assist failed. Please try again.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
