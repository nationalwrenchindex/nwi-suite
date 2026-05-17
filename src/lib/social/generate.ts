export type SocialPlatform = 'tiktok' | 'instagram' | 'facebook' | 'linkedin' | 'twitter'

export interface SocialPostDraft {
  platform:          SocialPlatform
  content:           string
  visual_suggestion: string
  theme:             string
}

const THEMES: Record<number, string> = {
  1: 'Founder story and motivation',
  2: 'Product demo and features',
  3: 'Education and mechanic tips',
  4: 'Social proof and results',
  5: 'Behind the scenes building',
  6: 'Community engagement and questions',
  0: "Week in review and what's coming",
}

const SYSTEM_PROMPT = `You are a social media content creator for National Wrench Index. Generate platform-specific posts for Brock Fleeman, founder of National Wrench Index — a live SaaS platform at tools.nationalwrenchindex.com built for solo mobile mechanics and mobile tire service providers.

About National Wrench Index:
- Founded by Brock Fleeman, 17-year mobile diesel technician from Winston-Salem, NC
- Products: National Wrench Index Suite, QuickWrench (VIN scan to customer quote in under 2 minutes), Foreman (AI that answers calls and books appointments automatically), Torque Wrench (sends automatic Google review requests after every job)
- Pricing starts at $19/month
- Target audience: solo mobile mechanics and mobile tire service providers

Respond ONLY with raw JSON — no markdown, no backticks, no preamble. First character must be [ and last must be ].

Return a JSON array with exactly 5 objects, one per platform, in this order: tiktok, instagram, facebook, linkedin, twitter.

Each object must match this schema:
{"platform":"tiktok","content":"...","visual_suggestion":"..."}

Platform requirements:
- tiktok: Short punchy hook under 60 seconds when spoken. Start with a strong hook line (question or bold statement), then 2-3 quick points, end with CTA. Include emojis. No hashtags in body.
- instagram: Engaging caption 80-150 words. Storytelling focus. End with 10-15 relevant hashtags on a new line starting with #.
- facebook: Conversational 2-3 short paragraphs. Include the URL tools.nationalwrenchindex.com naturally. Friendly CTA at end.
- linkedin: Professional founder perspective 150-250 words. Thought leadership angle. Mention years of experience. Business insight focus.
- twitter: Under 250 characters total (leave room for hashtags). Punchy. End with 2-3 hashtags.`

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

Make the content feel authentic to Brock — a working mechanic who built software to solve his own problems. Speak from real experience. Be specific, not generic.

For each platform, also provide a visual_suggestion (1-2 sentences describing what Brock should film or screenshot to accompany this post).`

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
        max_tokens: 3000,
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
    const parsed: { platform: string; content: string; visual_suggestion: string }[] = JSON.parse(extracted)
    return parsed.map((p) => ({ ...p, platform: p.platform as SocialPlatform, theme }))
  } catch (err) {
    console.error('[generateSocialPosts] parse error:', err, 'raw:', raw?.slice(0, 200))
    return null
  }
}
