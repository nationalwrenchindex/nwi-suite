import Anthropic from '@anthropic-ai/sdk'

// Haiku reshapes raw Gemini diagnostic text into our exact section structure.
// It must NOT add or remove content — especially safety warnings, voltage specs,
// part numbers, and torque specs. On any failure it returns the raw Gemini text
// unchanged: raw text is better than nothing, and we never fail silently.

const FORMAT_INSTRUCTION = `You are a technical formatting assistant for a field service diagnostic platform used by mobile mechanics and transport refrigeration technicians.

Your job is to take raw AI diagnostic content and reformat it into clean, structured sections. You are ONLY reformatting — do not add information, do not remove information, do not change any voltage specs, part numbers, resistance values, or technical details. Preserve everything exactly.

FORMAT THE CONTENT INTO THESE EXACT SECTIONS IN THIS EXACT ORDER. Each section must start on a new line with the header in ALL CAPS followed by a colon:

ALARM MEANING:
[2-3 sentences maximum explaining what this code means]

MOST LIKELY CAUSES:
1. [First cause]
2. [Second cause]
3. [Third cause]
(numbered list, one cause per line, maximum 8 causes)

DIAGNOSTIC STEPS:
1. [First step — include exact voltage/ohm specs and test mode]
2. [Second step]
3. [Third step]
(numbered list, one step per line, include all technical specs)

COMMON FIX:
[2-3 sentences on the most common resolution in the field]

PARTS NEEDED:
[List each part on its own line with OEM part number if available]

SPECIAL TOOLS REQUIRED:
[List any special tools, or state: Standard hand tools and digital multimeter only]

SAFETY WARNINGS:
[Safety warnings — include specific voltages and whether unit must be running or off for each phase of diagnosis and repair]

PM NOTE:
[Preventive maintenance notes relevant to this code]

CRITICAL FORMATTING RULES:
- Never write a paragraph when a list will do
- Every diagnostic step must be on its own numbered line
- Every cause must be on its own numbered line
- Never combine two steps into one line
- Use plain language a field tech can read at a glance
- Short sentences. No run-ons.
- If the source content does not have information for a section, write: Not specified — never leave a section blank
- Preserve ALL numbers exactly: voltages, resistances, part numbers, torque specs, temperatures

Preserve ALL voltage specifications exactly as provided — do not simplify, round, or generalize voltage values. If the source states 400-480VAC 3-phase, format it exactly as 400-480VAC 3-phase. Never substitute a different voltage value during formatting.`

// Parts Manager uses its own Haiku formatting pass — a parts list, not the
// 8-section diagnostic structure.
const PARTS_FORMAT_INSTRUCTION = `Format this parts list cleanly. Each part in its own section. OEM part number on its own line labeled OEM. Supersession chain clearly labeled. Aftermarket options clearly labeled. Specs on their own line. Do not add information not in the source.`

export async function formatParts(rawGeminiText: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || !rawGeminiText.trim()) return rawGeminiText
  try {
    const client = new Anthropic({ apiKey })
    const msg = await client.messages.create(
      {
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system:     PARTS_FORMAT_INSTRUCTION,
        messages: [{ role: 'user', content: `Parts list to format:\n\n${rawGeminiText}` }],
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
    console.error('[gemini/formatter] Haiku parts formatting failed — returning raw text', err)
    return rawGeminiText
  }
}

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
