import { GoogleGenerativeAI } from '@google/generative-ai'

// Field Assist AI helper — Gemini 2.5 Flash for plant / lawn / pest image
// analysis and text-based quick estimates for mobile landscapers.
// Isolated from the HD QuickWrench Gemini client (which uses Search grounding)
// because vision requests don't need — and shouldn't carry — the grounding tool.

const MODEL_ID = 'gemini-2.5-flash'
const TIMEOUT_MS = 55_000

function getApiKey(): string {
  // Support both the existing env name and the one requested for the lawn build.
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY / GOOGLE_GEMINI_API_KEY is not configured')
  return key
}

function getModel(systemInstruction: string) {
  const genAI = new GoogleGenerativeAI(getApiKey())
  return genAI.getGenerativeModel({ model: MODEL_ID, systemInstruction })
}

async function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Field Assist timed out — please try again.')), TIMEOUT_MS),
    ),
  ])
}

// Analyze an uploaded image (base64, no data: prefix) with a system prompt.
export async function analyzeImage(
  systemInstruction: string,
  base64: string,
  mimeType: string,
  userHint?: string,
): Promise<string> {
  const model = getModel(systemInstruction)
  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
    { inlineData: { data: base64, mimeType } },
    { text: userHint?.trim() ? userHint.trim() : 'Analyze this image.' },
  ]
  const res = await withTimeout(model.generateContent(parts))
  const text = res.response.text()
  if (!text?.trim()) throw new Error('The AI could not read this image. Try a clearer, closer photo.')
  return text
}

// Text-only analysis (Quick Estimate tool).
export async function analyzeText(systemInstruction: string, userText: string): Promise<string> {
  const model = getModel(systemInstruction)
  const res = await withTimeout(model.generateContent(userText))
  const text = res.response.text()
  if (!text?.trim()) throw new Error('The AI returned no result — please try again.')
  return text
}
