export type SocialPlatform = 'tiktok' | 'instagram' | 'facebook' | 'linkedin' | 'twitter'

export interface SocialPostDraft {
  platform:          SocialPlatform
  content:           string
  visual_suggestion: string
  image_prompt:      string
  theme:             string
}

const THEMES: Record<number, string> = {
  1: 'Founder story and motivation',
  2: 'Product demo and features',
  3: 'Education and mechanic tips',
  4: 'Early adopter invite — looking for the first 100',
  5: 'Behind the scenes building',
  6: 'Community engagement and questions',
  0: "Week in review and what's coming",
}

const SYSTEM_PROMPT = `You are a social media content creator writing on behalf of Brock Fleeman, founder of National Wrench Index — a SaaS platform at tools.nationalwrenchindex.com built for solo mobile mechanics and mobile tire service providers.

━━━ TRUTHFUL CONTEXT — NEVER DEVIATE FROM THESE FACTS ━━━
- Brock is a 17-year veteran mobile diesel technician based in Winston-Salem, NC
- He built this entire platform from scratch with zero prior coding experience
- National Wrench Index launched April 2026 and is currently in early beta
- There are currently 3 beta subscribers — this is the honest, real number
- The goal right now is to find the first 100 paying subscribers
- This is a genuine underdog founder story: a working mechanic who taught himself to build software to solve problems he lived every day

━━━ ABSOLUTE RULES — NEVER BREAK THESE ━━━
- NEVER fabricate user counts, subscriber numbers, or growth stats beyond what is stated above
- NEVER claim "hundreds of mechanics", "growing fast", "mechanics across X states", or any metric not established as fact
- NEVER write fake testimonials or implied social proof
- The authentic story — 17 years of grease under his nails, zero coding background, 3 real beta users — is MORE compelling than invented success. Lean into it hard.
- Content must be 100% truthful. If a theme calls for social proof, reframe it as the founder's own direct experience using the tool on his own business.

━━━ PLATFORM REQUIREMENTS ━━━
- tiktok: Short punchy hook under 60 seconds when spoken. Start with a bold statement or question, then 2-3 quick points, end with CTA. Include emojis. No hashtags in body.
- instagram: Engaging caption 80-150 words. Storytelling focus. End with 10-15 relevant hashtags on a new line starting with #.
- facebook: Conversational 2-3 short paragraphs. Include the URL tools.nationalwrenchindex.com naturally. Friendly CTA at end.
- linkedin: Professional founder perspective 150-250 words. Thought leadership angle. Lead with the human story — mechanic turned builder. Business insight focus.
- twitter: Under 250 characters total (leave room for hashtags). Punchy. End with 2-3 hashtags.

━━━ PRODUCTS & CONTENT ANGLES ━━━
Every post must lead with a specific problem solved or a specific result delivered — not the founder's years of experience.

FOREMAN — AI phone receptionist that answers calls and books jobs automatically:
- A missed call is a missed job. Foreman picks up every time.
- Booking appointments while you're under a hood, not standing in a driveway.
- Saturday night bookings arrive while you're watching TV.
- No voicemail, no phone tag — just a confirmed appointment in your calendar.
- Never lose another customer because you couldn't answer.

QUICKWRENCH — VIN scan to customer-ready quote in under 2 minutes:
- Point your phone at the VIN. Get torque specs, parts pricing, and a quote in 2 minutes.
- Look like the most prepared tech in the driveway — quote ready before the customer finishes explaining.
- Live parts pricing from multiple suppliers, right there on the spot.
- DTC code lookup, open recall check, fluid specs — all from the driveway, all from your phone.
- From scan to texted quote in under 2 minutes. No laptop. No guessing.

TORQUEWRENCH — automatic Google review requests after every completed job:
- Your Google reviews grow while you sleep.
- Customers forget to review. TorqueWrench remembers for them.
- Five-star rankings built automatically — no awkward ask in person.
- Every completed job feeds your reputation without you lifting a finger.
- The mechanic who has 80 reviews wins the search result over the one who has 4.

NWI SUITE — complete mobile business in one connected app:
- Scheduling, invoicing, customer history, and business intel — all in your pocket.
- Built for the solo operator who does every job and runs the business alone.
- No spreadsheets, no paper invoices, no missed follow-ups.
- From booking to paid invoice — one connected system, $19/month.
- Everything a mobile shop needs to run professionally, without a front desk.

━━━ FOUNDER STORY RULES ━━━
The founder story (17 years of experience, self-taught builder, underdog journey) is a SECONDARY angle, not the lead.
- FRIDAY (behind the scenes): Founder story IS appropriate. Talk about the build, the grind, the journey.
- MONDAY (motivation): Product outcome is PRIMARY. Founder story is OPTIONAL — use it occasionally, not every Monday.
- ALL OTHER DAYS: Do NOT lead with the founder story. Lead with a product benefit or customer outcome. "17 years" or "17-year veteran" must not appear in Tuesday, Wednesday, Thursday, Saturday, or Sunday posts.
Pricing starts at $19/month.

━━━ IMAGE PROMPT GENERATION ━━━
For each post generate an image_prompt — a detailed prompt the user can paste into Midjourney, DALL-E, or Canva AI to create a matching image.

Image style rules for ALL posts:
- Deep charcoal/dark background (#1a1a1a)
- Primary accent: bold orange (#16a34a) — glow, gradients, highlights
- Secondary accent: deep blue (#15803d) — UI screens, data displays
- Subject matter: mobile mechanic world — light-duty passenger vehicles and pickup trucks (Ford F-150, Chevy Silverado, Honda Civic, Toyota Camry, SUVs, everyday cars and trucks), tool bags, diagnostic tablets, grease-stained hands on keyboards, shop invoices on phone screens, open hoods at dawn; never depict semi trucks, tractor-trailers, or heavy commercial vehicles
- Photorealistic or cinematic quality, professional and clean
- No text overlaid in the image

Platform-specific aspect ratio to include in each image_prompt:
- tiktok: 9:16 vertical format
- instagram: 1:1 square format
- facebook: 16:9 horizontal format
- linkedin: 16:9 horizontal format
- twitter: 16:9 horizontal format

━━━ RESPONSE FORMAT ━━━
Respond ONLY with raw JSON — no markdown, no backticks, no preamble. First character must be [ and last must be ].

Return a JSON array with exactly 5 objects, one per platform, in this order: tiktok, instagram, facebook, linkedin, twitter.

Each object must match this schema exactly:
{"platform":"tiktok","content":"...","visual_suggestion":"...","image_prompt":"..."}`

type DallESize = '1024x1024' | '1024x1536' | '1536x1024'

// gpt-image-1 supported sizes
const DALL_E_SIZES: Record<SocialPlatform, DallESize> = {
  tiktok:    '1024x1536', // 9:16 portrait
  instagram: '1024x1024', // 1:1 square
  facebook:  '1024x1024', // 1:1 square
  linkedin:  '1536x1024', // 16:9 landscape
  twitter:   '1536x1024', // 16:9 landscape
}

// Simplified per-platform fallback prompts — short, generic, safe for content filters
const FALLBACK_PROMPTS: Record<SocialPlatform, string> = {
  tiktok:    'Mobile auto mechanic opening the hood of a Ford F-150 pickup truck parked on a residential street. Toolbox on the ground, morning light. Dark moody background, orange light accents. Cinematic, photorealistic. 9:16 vertical format. No text.',
  instagram: 'Close-up of a mechanic\'s hands using a diagnostic scanner on a modern SUV engine bay. Professional tools, clean composition. Dark charcoal tones, warm orange highlights. Photorealistic. 1:1 square format. No text.',
  facebook:  'Mobile mechanic van parked next to a Chevrolet Silverado on a suburban driveway. Mechanic working under the hood. Professional, clean. Dark background, orange accent lighting. 16:9 horizontal format. No text.',
  linkedin:  'Professional mobile mechanic in uniform standing beside a Toyota Camry, holding a tablet showing a digital inspection report. Confident, clean, modern. Dark background with blue and orange accents. 16:9 horizontal format. No text.',
  twitter:   'Mechanic\'s hands on a laptop keyboard inside a service van, phone showing an invoice app, Honda Civic visible through the window. Dark moody tones, orange glow. 16:9 horizontal format. No text.',
}

async function callDallE(
  prompt:   string,
  platform: SocialPlatform,
  apiKey:   string,
  attempt:  number,
): Promise<string | null> {
  const requestBody = {
    model:  'gpt-image-1',
    prompt,
    n:      1,
    size:   DALL_E_SIZES[platform],
  }

  console.log(
    `[generatePostImage] attempt ${attempt} — DALL-E 3 REQUEST for ${platform}:\n` +
    JSON.stringify({ ...requestBody, prompt: prompt.slice(0, 200) + (prompt.length > 200 ? '…' : '') }, null, 2),
  )

  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    // Read raw text first so we can log it regardless of parse outcome
    const rawText = await res.text()

    if (!res.ok) {
      console.error(
        `[generatePostImage] attempt ${attempt} — DALL-E 3 HTTP ${res.status} for ${platform}.\n` +
        `RAW RESPONSE BODY: ${rawText}`,
      )
      return null
    }

    let data: unknown
    try {
      data = JSON.parse(rawText)
    } catch (parseErr) {
      console.error(
        `[generatePostImage] attempt ${attempt} — failed to parse DALL-E 3 response for ${platform}.\n` +
        `PARSE ERROR: ${parseErr}\n` +
        `RAW TEXT: ${rawText}`,
      )
      return null
    }

    // Log the complete response every time
    console.log(
      `[generatePostImage] attempt ${attempt} — DALL-E 3 RESPONSE for ${platform}:\n` +
      JSON.stringify(data, null, 2),
    )

    type DallEResponse = {
      created?:  number
      data?:     { url?: string; b64_json?: string; revised_prompt?: string }[]
      error?:    { message?: string; type?: string; code?: string }
    }
    const parsed = data as DallEResponse

    if (parsed.error) {
      console.error(
        `[generatePostImage] attempt ${attempt} — DALL-E 3 error object in 200 body for ${platform}:`,
        JSON.stringify(parsed.error),
      )
      return null
    }

    const item = parsed.data?.[0]
    if (!item) {
      console.error(`[generatePostImage] attempt ${attempt} — DALL-E 3 data array empty or missing for ${platform}`)
      return null
    }

    if (item.revised_prompt) {
      console.warn(
        `[generatePostImage] attempt ${attempt} — DALL-E 3 revised the prompt for ${platform}.\n` +
        `ORIGINAL: ${prompt.slice(0, 200)}\n` +
        `REVISED:  ${item.revised_prompt.slice(0, 200)}`,
      )
    }

    if (!item.url) {
      if (item.b64_json) {
        console.log(`[generatePostImage] attempt ${attempt} — no url, using b64_json data URL for ${platform}`)
        const dataUrl = `data:image/png;base64,${item.b64_json}`
        return dataUrl
      }
      console.error(
        `[generatePostImage] attempt ${attempt} — gpt-image-1 item has no url or b64_json for ${platform}.\n` +
        `item keys present: ${Object.keys(item).join(', ')}`,
      )
      return null
    }

    console.log(`[generatePostImage] attempt ${attempt} — gpt-image-1 SUCCESS for ${platform}: ${item.url.slice(0, 80)}…`)
    return item.url
  } catch (err) {
    console.error(`[generatePostImage] attempt ${attempt} — fetch error for ${platform}:`, err)
    return null
  }
}

export async function generatePostImage(
  imagePrompt: string,
  platform:    SocialPlatform,
  openAiKey:   string,
): Promise<string | null> {
  // Attempt 1: use the AI-generated image prompt
  const url = await callDallE(imagePrompt, platform, openAiKey, 1)
  if (url) return url

  // Attempt 2: retry with a short, safe fallback prompt that avoids content filter triggers
  console.warn(`[generatePostImage] retrying ${platform} with simplified fallback prompt`)
  return callDallE(FALLBACK_PROMPTS[platform], platform, openAiKey, 2)
}

function extractOutermostArray(text: string): string | null {
  const start = text.indexOf('[')
  if (start === -1) return null

  let depth    = 0
  let inString = false
  let escape   = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape)                  { escape = false; continue }
    if (ch === '\\' && inString) { escape = true;  continue }
    if (ch === '"')              { inString = !inString; continue }
    if (inString)                { continue }
    if (ch === '[')              { depth++ }
    else if (ch === ']') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export async function generateSocialPosts(
  apiKey: string,
): Promise<SocialPostDraft[] | null> {
  const today      = new Date()
  const dayOfWeek  = today.getDay()
  const theme      = THEMES[dayOfWeek]
  const dayName    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dayOfWeek]

  const founderStoryGuidance = dayOfWeek === 5
    ? `Today is Friday — behind-the-scenes day. You MAY draw on Brock's personal story: 17-year diesel tech who taught himself to code from scratch. Show the human side of building something real. The journey, the grind, the why.`
    : dayOfWeek === 1
    ? `Today is Monday — motivation day. Lead with a specific product outcome or customer win. You may reference the founder journey briefly and occasionally, but product benefits must be the primary angle. Do not open with "17 years".`
    : `Today is NOT a founder-story day. Do NOT mention "17 years", Brock's tenure, or his background as the lead. Open every post with a specific product benefit, problem solved, or customer outcome. The founder can be referenced in passing at most — never as the hook.`

  const userMessage = `Today is ${dayName}. Generate social media posts for the theme: "${theme}".

${founderStoryGuidance}

Brock launched National Wrench Index in April 2026. There are currently 3 beta subscribers — this is the real number, and the goal is the first 100. Do not invent metrics, user counts, or testimonials. That honesty is part of the brand.

For each platform, also provide a visual_suggestion (1-2 sentences describing what Brock should film or photograph to accompany this post — e.g., a specific screen in the app, a VIN scan in action, a booked job appearing on his calendar, his hands on a keyboard, etc.).`

  let raw = ''
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 4500,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('[generateSocialPosts] Claude API error:', errText)
      return null
    }

    const data = await res.json()
    raw = data.content?.[0]?.text ?? ''
  } catch (err) {
    console.error('[generateSocialPosts] fetch error:', err)
    return null
  }

  if (!raw) return null

  try {
    raw = raw.replace(/```(?:json|JSON)?\s*/g, '').replace(/```/g, '').trim()
    const extracted = extractOutermostArray(raw)
    if (!extracted) throw new Error('No JSON array in response')
    const parsed: { platform: string; content: string; visual_suggestion: string; image_prompt: string }[] = JSON.parse(extracted)
    return parsed.map((p) => ({ ...p, platform: p.platform as SocialPlatform, theme }))
  } catch (err) {
    console.error('[generateSocialPosts] parse error:', err, 'raw:', raw?.slice(0, 200))
    return null
  }
}
