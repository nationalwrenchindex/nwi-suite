// Detects OEM / aftermarket part numbers inside a free-text part description and
// splits the text into renderable segments so each detected part number can be
// turned into a clickable Google search link. Pure logic (no JSX) so it can be
// shared by the LD DiagnosticTools panel and the HD QuickWrench page.

export type PartVendor = 'auto' | 'tk' | 'carrier'

export interface PartSegment {
  type:    'text' | 'part'
  content: string
}

// Ordered specific → general. In every pattern, capture group 1 is the actual
// part number to linkify — the "Part#"/"OEM:" prefix stays as plain text.
const PART_PATTERNS: RegExp[] = [
  /Part#\s*([A-Z0-9][A-Z0-9-]{4,14})/gi,   // Part# 84778360
  /OEM[:\s]+([A-Z0-9][A-Z0-9-]{4,14})/gi,  // OEM: 23380704
  /\b([A-Z]{1,5}-?\d{4,10})\b/g,           // letter+digit, e.g. ACDelco style AC-12345
  /\b(\d{7,10})\b/g,                        // standalone 7-10 digit, e.g. 84778360
]

// TK / Carrier reefer part numbers are commonly written bare and dashed
// (66-8560, 41-2345, 25-39135-00). Only enabled for tk/carrier vendors — in the
// LD automotive context this would false-positive on specs like "10-15 ohms" or
// "0.6-0.8mm". The min widths (\d{2}-\d{4,5}) keep those specs out.
const DASHED_REEFER_PATTERN = /\b(\d{2}-\d{4,5}(?:-\d{2})?)\b/g

interface Hit { start: number; end: number; value: string }

// Split text into ordered text/part segments. Every character of the original
// text is preserved across the returned segments (nothing is dropped). The
// vendor decides whether the bare dashed reefer pattern is included.
export function linkifyPartNumbers(text: string, vendor: PartVendor = 'auto'): PartSegment[] {
  if (!text) return [{ type: 'text', content: text ?? '' }]

  const patterns = vendor === 'tk' || vendor === 'carrier'
    ? [...PART_PATTERNS, DASHED_REEFER_PATTERN]
    : PART_PATTERNS

  const hits: Hit[] = []
  for (const pattern of patterns) {
    // Fresh RegExp per pass so the global lastIndex state never leaks between calls.
    const re = new RegExp(pattern.source, pattern.flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const group = m[1]
      if (group) {
        // Anchor the link to the captured group, not the whole match, so the
        // "Part# " / "OEM: " prefix is left as ordinary text.
        const offset = m[0].indexOf(group)
        const start  = m.index + (offset < 0 ? 0 : offset)
        hits.push({ start, end: start + group.length, value: group })
      }
      if (m.index === re.lastIndex) re.lastIndex++ // zero-width guard
    }
  }

  if (hits.length === 0) return [{ type: 'text', content: text }]

  // Resolve overlaps between patterns: earliest start wins, longer wins ties,
  // and any hit overlapping an already-accepted range is dropped (e.g. the same
  // number matched by both the "Part#" pattern and the standalone-digit pattern).
  hits.sort((a, b) => a.start - b.start || b.end - a.end)
  const accepted: Hit[] = []
  let cursor = 0
  for (const h of hits) {
    if (h.start >= cursor) {
      accepted.push(h)
      cursor = h.end
    }
  }

  const segments: PartSegment[] = []
  let pos = 0
  for (const h of accepted) {
    if (h.start > pos) segments.push({ type: 'text', content: text.slice(pos, h.start) })
    segments.push({ type: 'part', content: h.value })
    pos = h.end
  }
  if (pos < text.length) segments.push({ type: 'text', content: text.slice(pos) })
  return segments
}

// Google search URL for a part number. Reefer parts (TK / Carrier) get a
// vendor-specific query so the tech lands on the right supplier listings; every
// other suite defaults to generic "auto parts".
export function partSearchUrl(partNumber: string, vendor: PartVendor = 'auto'): string {
  const suffix =
    vendor === 'tk'      ? 'thermo+king+parts' :
    vendor === 'carrier' ? 'carrier+transicold+parts' :
                           'auto+parts'
  return `https://www.google.com/search?q=${encodeURIComponent(partNumber)}+${suffix}`
}
