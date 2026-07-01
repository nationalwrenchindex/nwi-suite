// Server-side hazard detection for the review-queue flag. If a Gemini-generated
// diagnostic mentions any hazardous electrical / refrigerant / pressure /
// running-engine condition, the cached entry is flagged needs_review so a
// founder verifies the safety content before it is trusted. (The client renders
// its own top-of-result safety block separately — this is only the review gate.)

const HAZARD_PATTERNS: RegExp[] = [
  // High voltage AC
  /\bVAC\b/i,
  /\b3[\s-]?phase\b|three[\s-]?phase/i,
  /\b230\s?V\b|\b460\s?V\b/i,
  /high voltage(?:\s+AC)?/i,
  // Energized / live circuits, motor terminals
  /energized circuit|live circuit|motor terminal/i,
  // Refrigerant handling
  /refrigerant recovery|EPA\s?608|system opening|open(?:ing)?\s+the\s+system/i,
  // High pressure
  /high pressure line|discharge pressure|pressurized/i,
  // Running engine / rotating components
  /engine running|running engine|rotating component/i,
]

export function detectsHazard(text: string): boolean {
  if (!text) return false
  if (HAZARD_PATTERNS.some(re => re.test(text))) return true

  // Discharge / refrigerant pressure above 200 PSI.
  const psiMatches = text.match(/(\d{2,4})\s?psi/gi)
  if (psiMatches) {
    for (const m of psiMatches) {
      const n = parseInt(m, 10)
      if (Number.isFinite(n) && n > 200) return true
    }
  }
  return false
}
