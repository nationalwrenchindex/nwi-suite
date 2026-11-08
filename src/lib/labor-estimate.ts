// AI labor estimates -> the hours a quote starts with. One rule, LD and HD.
//
// WHY THIS EXISTS (Nov 8, 2026)
//
// A DTC result said "Labor estimate: 2.5 - 4.0 hours mobile labor" and Add to Quote
// billed 2.5h - the parser took the first number in the string, so every range silently
// became its LOW end. Nobody decided that. At $135/h the top of that range is $540
// against the $337.50 that was quoted: $202 left on one job.
//
// The rule now:
//   - a range starts at its MIDPOINT, rounded to the nearest quarter hour
//     (2.5-4.0 -> 3.25);
//   - the range it came from travels with the number and is shown beside it
//     ("estimated 2.5-4.0 hours");
//   - the tech can change it before it reaches the quote - they are at the vehicle;
//   - the line is marked ESTIMATED (labor_estimate on the stored line), so when the
//     work order closes with real hours the two can be compared.
//
// A single number is its own estimate (low = high). Text with no number at all returns
// null: the caller decides, and says so - this never invents an hour.

export interface LaborEstimate {
  /** Where the figure came from. Only the AI produces one today. */
  source:    'ai'
  /** The range as the AI gave it, in hours. low === high for a single figure. */
  low:       number
  high:      number
  /** What the line STARTED at: the midpoint to the quarter hour. The tech may change it. */
  suggested: number
  /** The model's own words, for the record. */
  text:      string
}

/** Nearest quarter hour. 3.25 stays 3.25; 3.3 -> 3.25; 3.4 -> 3.5. */
export function toQuarterHour(h: number): number {
  return Math.round(h * 4) / 4
}

// "2.5 - 4.0", "2.5-4", "2.5 to 4.0", "2.5–4.0" (en dash), "2.5 — 4" (em dash).
const RANGE = /(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)/i
const SINGLE = /(\d+(?:\.\d+)?)/

/**
 * Parse an AI labor estimate. The FIRST range or number in the text is the estimate -
 * "2.5 - 4.0 hours mobile labor (1.5 book)" is 2.5-4.0, not 1.5.
 */
export function parseLaborEstimate(text: string | null | undefined): LaborEstimate | null {
  const t = String(text ?? '').trim()
  if (!t) return null

  const r = t.match(RANGE)
  const s = t.match(SINGLE)
  // A range wins only when it starts where the first number starts - otherwise the
  // first number is a single figure and a later range is something else.
  if (r && s && r.index === s.index) {
    const a = parseFloat(r[1]), b = parseFloat(r[2])
    if (Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b > 0) {
      const low = Math.min(a, b), high = Math.max(a, b)
      return { source: 'ai', low, high, suggested: toQuarterHour((low + high) / 2), text: t }
    }
  }
  if (s) {
    const n = parseFloat(s[1])
    if (Number.isFinite(n) && n > 0) return { source: 'ai', low: n, high: n, suggested: toQuarterHour(n), text: t }
  }
  return null
}

/** "2.5-4.0" or "3.0" - one decimal, as the AI writes them. */
export function formatEstimateRange(e: Pick<LaborEstimate, 'low' | 'high'>): string {
  const f = (n: number) => n.toFixed(1)
  return e.low === e.high ? f(e.low) : `${f(e.low)}-${f(e.high)}`
}

/** "estimated 2.5-4.0 hours" - printed beside the hours wherever the tech sees them. */
export function estimateLabel(e: Pick<LaborEstimate, 'low' | 'high'>): string {
  return `estimated ${formatEstimateRange(e)} hours`
}

/** A stored value read back: an object with numeric low/high, or null. */
export function readLaborEstimate(v: unknown): LaborEstimate | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const low = Number(o.low), high = Number(o.high), suggested = Number(o.suggested)
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null
  return {
    source: 'ai', low, high,
    suggested: Number.isFinite(suggested) ? suggested : toQuarterHour((low + high) / 2),
    text: typeof o.text === 'string' ? o.text : '',
  }
}
