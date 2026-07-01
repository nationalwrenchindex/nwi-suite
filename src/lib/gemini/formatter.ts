import Anthropic from '@anthropic-ai/sdk'

// Haiku reshapes raw Gemini diagnostic text into our exact section structure.
// It must NOT add or remove content — especially safety warnings, voltage specs,
// part numbers, and torque specs. On any failure it returns the raw Gemini text
// unchanged: raw text is better than nothing, and we never fail silently.

const FORMAT_INSTRUCTION = `Format the following diagnostic content into these exact sections with these exact headers. Do not add information not present in the source. Do not remove safety warnings. Keep all voltage specs, part numbers, and torque specs exactly as provided:
ALARM MEANING, MOST LIKELY CAUSES, DIAGNOSTIC STEPS, COMMON FIX, PARTS NEEDED, SAFETY WARNINGS, PM NOTE`

export interface FormatContext {
  manufacturer?: string
  model?:        string
  alarmCode?:    string
  engineBrand?:  string
  engineModel?:  string
  spn?:          string
  fmi?:          string
}

export async function formatDiagnostic(rawGeminiText: string, context: FormatContext): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || !rawGeminiText.trim()) return rawGeminiText

  const ctxLine = [
    context.manufacturer && `Manufacturer: ${context.manufacturer}`,
    context.model        && `Unit model: ${context.model}`,
    context.alarmCode    && `Alarm code: ${context.alarmCode}`,
    context.engineBrand  && `Engine brand: ${context.engineBrand}`,
    context.engineModel  && `Engine model: ${context.engineModel}`,
    context.spn          && `SPN: ${context.spn}`,
    context.fmi          && `FMI: ${context.fmi}`,
  ].filter(Boolean).join('\n')

  try {
    const client = new Anthropic({ apiKey })
    const msg = await client.messages.create(
      {
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system:     FORMAT_INSTRUCTION,
        messages: [{
          role:    'user',
          content: `${ctxLine ? ctxLine + '\n\n' : ''}Diagnostic content to format:\n\n${rawGeminiText}`,
        }],
      },
      { timeout: 20_000, maxRetries: 1 },
    )
    const formatted = msg.content
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('\n')
      .trim()
    return formatted || rawGeminiText
  } catch (err) {
    console.error('[gemini/formatter] Haiku formatting failed — returning raw Gemini text', err)
    return rawGeminiText
  }
}
