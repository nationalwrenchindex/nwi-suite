import { GoogleGenerativeAI, type Tool } from '@google/generative-ai'

// Primary diagnostic AI for HD QuickWrench. Gemini 2.5 Flash with Google Search
// grounding does the thinking + search; Haiku (see ./formatter) reshapes the raw
// output into our standard section structure.

const MODEL_ID          = 'gemini-2.5-flash'
const GEMINI_TIMEOUT_MS = 55_000

function getClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')
  return new GoogleGenerativeAI(apiKey)
}

// gemini-2.5 requires the `googleSearch` grounding tool. The SDK's typed Tool
// union only knows the older Gemini-1.5 `googleSearchRetrieval`, so we cast —
// the object is passed through to the request body as-is.
const GROUNDING_TOOL = { googleSearch: {} } as unknown as Tool

// Returns the gemini-2.5-flash model with Google Search grounding enabled.
export function getGeminiModel(systemInstruction?: string) {
  return getClient().getGenerativeModel({
    model: MODEL_ID,
    tools: [GROUNDING_TOOL],
    ...(systemInstruction ? { systemInstruction } : {}),
  })
}

export interface GeminiResult {
  text:      string
  citations: string[]   // grounding source URLs Gemini returned
}

// Generate a diagnostic with grounding enabled. Returns the raw text plus the
// grounding source URLs. Throws clearly on auth failure or quota exceeded so the
// caller can fall back to Haiku.
export async function generateDiagnostic(prompt: string, systemPrompt: string): Promise<GeminiResult> {
  const model = getGeminiModel(systemPrompt)
  try {
    const result   = await model.generateContent(prompt, { timeout: GEMINI_TIMEOUT_MS })
    const response = result.response
    const text     = response.text()

    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
    const citations = Array.from(
      new Set(
        chunks
          .map(c => c.web?.uri)
          .filter((u): u is string => typeof u === 'string' && u.length > 0),
      ),
    )
    return { text, citations }
  } catch (err) {
    const status = (err as { status?: number }).status
    const msg    = err instanceof Error ? err.message : String(err)
    if (status === 401 || status === 403 || /API key not valid|PERMISSION_DENIED|unauthorized/i.test(msg)) {
      throw new Error(`Gemini auth failed: ${msg}`)
    }
    if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg)) {
      throw new Error(`Gemini quota exceeded: ${msg}`)
    }
    throw new Error(`Gemini generation failed: ${msg}`)
  }
}
