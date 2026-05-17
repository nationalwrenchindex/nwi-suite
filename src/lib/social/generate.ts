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

━━━ PRODUCTS ━━━
- NWI Suite: full shop management — scheduler, customer/vehicle intel, financials, invoicing
- QuickWrench: VIN scan to customer-ready quote in under 2 minutes
- Foreman: AI voice agent that answers calls and books appointments automatically
- Torque Wrench: sends automatic Google review requests after every job
- Pricing starts at $19/month

━━━ IMAGE PROMPT GENERATION ━━━
For each post generate an image_prompt — a detailed prompt the user can paste into Midjourney, DALL-E, or Canva AI to create a matching image.

Image style rules for ALL posts:
- Deep charcoal/dark background (#1a1a1a)
- Primary accent: bold orange (#FF6600) — glow, gradients, highlights
- Secondary accent: deep blue (#2969B0) — UI screens, data displays
- Subject matter: mobile mechanic world — diesel trucks, tool bags, diagnostic tablets, grease-stained hands on keyboards, shop invoices on phone screens, open hoods at dawn
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

  const userMessage = `Today is ${dayName}. Generate social media posts for the theme: "${theme}".

Speak as Brock — a working mechanic who taught himself to code and launched a real SaaS in April 2026. He currently has 3 beta subscribers and is chasing the first 100. That honesty is the brand. Do not invent metrics, user counts, or testimonials. Draw on his 17 years in the field and the genuine difficulty of building something from nothing.

For each platform, also provide a visual_suggestion (1-2 sentences describing what Brock should film or photograph to accompany this post — e.g., a specific screen in the app, a tool in his truck, his hands on a keyboard, etc.).`

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
