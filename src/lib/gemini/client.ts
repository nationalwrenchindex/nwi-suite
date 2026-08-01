import { GoogleGenAI } from '@google/genai'

// Primary diagnostic AI for HD QuickWrench. Gemini 3.6 Flash with Google Search
// grounding does the thinking + search; a second Gemini pass (see ./formatter) reshapes the raw
// output into our standard section structure.

const MODEL_ID          = 'gemini-3.6-flash'
const GEMINI_TIMEOUT_MS = 55_000

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')
  return new GoogleGenAI({ apiKey })
}

// gemini-3.6 requires the `googleSearch` grounding tool. The new @google/genai
// SDK types `googleSearch` natively, so no cast is needed.
const GROUNDING_TOOL = { googleSearch: {} }

export interface GeminiResult {
  text:      string
  citations: string[]   // grounding source URLs Gemini returned
}

// Generate a diagnostic with grounding enabled. Returns the raw text plus the
// deduped grounding source URLs.
export async function generateDiagnostic(
  prompt: string,
  systemInstruction: string,
): Promise<GeminiResult> {
  const client = getClient()

  const response = await client.models.generateContent({
    model:    MODEL_ID,
    contents: prompt,
    config: {
      systemInstruction,
      tools: [GROUNDING_TOOL],
      httpOptions: { timeout: GEMINI_TIMEOUT_MS },
    },
  })

  const text = response.text ?? ''

  const citations: string[] = Array.from(
    new Set(
      (response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
        .map((c: { web?: { uri?: string } }) => c.web?.uri)
        .filter((u): u is string => typeof u === 'string' && u.length > 0),
    ),
  )

  return { text, citations }
}

// General-purpose Gemini text generation WITHOUT Google Search grounding. Used
// for reshaping/formatting, structured-JSON extraction, and copy generation —
// cases where grounding would be wrong because the model must not inject any
// outside web content. Returns the raw text (caller parses/validates).
export async function generateText(
  prompt: string,
  systemInstruction: string,
  opts: { maxOutputTokens?: number } = {},
): Promise<string> {
  const client = getClient()

  const response = await client.models.generateContent({
    model:    MODEL_ID,
    contents: prompt,
    config: {
      systemInstruction,
      ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
      httpOptions: { timeout: GEMINI_TIMEOUT_MS },
    },
  })

  return response.text ?? ''
}

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY
}
