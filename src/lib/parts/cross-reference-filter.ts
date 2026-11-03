// ─── Cross-references: the manufacturer's numbers only ────────────────────────
//
// THE RULE (Brock, Nov 3, 2026): a cross-reference is a part number issued by the
// company that MANUFACTURES the part. A reseller's SKU is not a cross-reference.
// "FridayParts 42-0100" is the OEM number with a seller's name on it; "TES 10-42-100"
// is a shelf number. Neither is printed. A name that cannot be told apart is left
// out - and listed for Brock, never guessed.
//
// Applied to the AI parts output (QuickWrench Parts Manager and the reefer diagnostic)
// at response time, so a cached answer is cleaned the same way as a fresh one. It
// touches ONLY cross-reference / aftermarket entries and unambiguous reseller names;
// part numbers, descriptions, supersession chains, specs, quantities and the price
// range pass through untouched.

/** Companies that manufacture the parts they number. Matched case-insensitively at the start of an entry. */
const MANUFACTURERS: Array<[RegExp, string]> = [
  // Named by Brock.
  [/^wix\b/i, 'WIX'], [/^fleetguard\b/i, 'Fleetguard'], [/^donaldson\b/i, 'Donaldson'], [/^baldwin\b/i, 'Baldwin'],
  [/^woodward\b/i, 'Woodward'], [/^facet\b/i, 'Facet'], [/^carrier(\s+transicold)?\b/i, 'Carrier'], [/^delco(\s+remy)?\b/i, 'Delco'],
  // The OEMs themselves, and makers whose parts carry their own numbers.
  [/^thermo\s*king\b/i, 'Thermo King'], [/^tk\b(?!\s*by)/i, 'Thermo King'], [/^cummins\b/i, 'Cummins'],
  [/^luber[- ]?finer\b/i, 'Luber-finer'], [/^gates\b/i, 'Gates'], [/^dayco\b/i, 'Dayco'], [/^bando\b/i, 'Bando'],
  [/^bosch\b/i, 'Bosch'], [/^denso\b/i, 'Denso'], [/^litt(?:el|le)fuse\b/i, 'Littelfuse'], [/^prestolite\b/i, 'Prestolite'],
  [/^leece[- ]?neville\b/i, 'Leece-Neville'], [/^red\s*dot\b/i, 'Red Dot'], [/^exide\b/i, 'Exide'],
  [/^bussmann\b/i, 'Bussmann'],
]

/** Resellers, retailers and marketplaces. Never printed beside a number. */
const RESELLERS: Array<[RegExp, string]> = [
  [/\bfriday\s*parts\b/i, 'FridayParts'], [/\bdiselmart\b/i, 'Diselmart'], [/\bdieselmart\b/i, 'Diselmart'],
  [/\be-?bay\b/i, 'eBay'], [/\bnapa\b/i, 'NAPA'], [/\bcarquest\b/i, 'Carquest'], [/\bauto\s*zone\b/i, 'AutoZone'],
  [/\bo['’]?reilly\b/i, "O'Reilly"], [/\brock\s*auto\b/i, 'RockAuto'], [/\bthermo\s*(?:by|-)\s*products\b/i, 'Thermo by Products'],
  [/\bwdpart\b/i, 'WDPART'], [/\btotal\s*parts\b/i, 'Total Parts'], [/\binterstate\s*mcbee\b/i, 'Interstate McBee'],
  [/\bamazon\b/i, 'Amazon'], [/\bdb\s*electrical\b/i, 'DB Electrical'],
]
/** First words that start advice or a category, not a company name. */
const NOT_A_NAME = /^(check|see|verify|use|group|any|standard|universal|generic|common|various|custom|available|widely|oem|heavy|order|consult|contact|part|parts|number|example|e\.g\.?|or|and|similar|equivalent)$/i

/** TES is a reseller only inside a cross-reference ("TES 10-42-100"); elsewhere it is Allison's fluid spec. */
const TES = /^tes\b/i

const LABEL = /^(\s*(?:[-*]\s*)?(?:\*\*)?)(aftermarket(?:\s+options?)?|cross[- ]?ref(?:erence)?s?|alternates?)((?:\*\*)?\s*:?\s*(?:\*\*)?\s*)(.*)$/i
const HEADING_ONLY = /^\s*(?:[-*]\s*)?(?:#+\s*)?(?:\*\*)?(?:aftermarket(?:\s+options?)?|cross[- ]?ref(?:erence)?s?|alternates?)(?:\*\*)?\s*:?\s*$/i

export interface CrossFilterResult {
  text: string
  /** Manufacturer cross-references kept, "Brand NUMBER". */
  kept: string[]
  /** Brand names dropped as resellers. */
  resellers: string[]
  /** Names that could not be told apart - left out, listed for Brock. */
  unknown: string[]
}

function classify(entry: string): { kind: 'keep' | 'reseller' | 'unknown' | 'none'; name: string } {
  const e = entry.trim().replace(/^[-*•]\s*/, '')
  if (!e) return { kind: 'none', name: '' }
  for (const [re, name] of RESELLERS) if (re.test(e)) return { kind: 'reseller', name }
  if (TES.test(e)) return { kind: 'reseller', name: 'TES' }
  // A cross-reference is a name AND a number. Advice ("check cross-references for
  // 40-975") or a category ("Group 31 battery") is neither, and is dropped.
  const words = e.replace(/[()*]/g, ' ').split(/\s+/).filter(Boolean)
  const at = words.findIndex(w => /\d/.test(w))
  const num = at >= 0
  for (const [re, name] of MANUFACTURERS) if (re.test(e)) return { kind: num ? 'keep' : 'none', name }
  // The name is the words before the number: one to three, starting with a capital,
  // and not a sentence ("Check cross-references for", "Group").
  const lead = words.slice(0, at).join(' ')
  const looksLikeName = at >= 1 && at <= 3 && /^[A-Z]/.test(words[0]) && !NOT_A_NAME.test(words[0])
  return { kind: num && looksLikeName ? 'unknown' : 'none', name: lead }
}

function filterEntries(values: string, out: CrossFilterResult): string[] {
  const kept: string[] = []
  for (const raw of values.split(/\s*[,;]\s*|\s+\/\s+|\s+or\s+/i)) {
    const c = classify(raw)
    if (c.kind === 'keep') { kept.push(raw.trim()); out.kept.push(raw.trim()) }
    else if (c.kind === 'reseller') out.resellers.push(c.name)
    else if (c.kind === 'unknown') out.unknown.push(c.name)
  }
  return kept
}

/** Filter one AI parts answer. Pure. */
export function filterCrossReferences(text: string): CrossFilterResult {
  const out: CrossFilterResult = { text: '', kept: [], resellers: [], unknown: [] }
  const lines = text.split('\n')
  const result: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (HEADING_ONLY.test(line)) {
      // A heading, then its values until a blank line or the next heading.
      const values: string[] = []
      let j = i + 1
      while (j < lines.length && lines[j].trim() !== '' && !/^\s*(#|---|\*\*|[A-Z][A-Za-z ]+$)/.test(lines[j])) { values.push(lines[j]); j++ }
      const kept = filterEntries(values.join(', '), out)
      if (kept.length) result.push(line.replace(/aftermarket(?:\s+options?)?|alternates?/i, 'Cross-reference'), kept.join(', '))
      i = j - 1
      continue
    }
    const m = line.match(LABEL)
    if (m && m[4].trim()) {
      const kept = filterEntries(m[4], out)
      if (kept.length) result.push(`${m[1]}Cross-reference${m[3]}${kept.join(', ')}`)
      continue
    }
    // Anywhere else: an unambiguous reseller name beside a number is removed with it.
    let l = line
    for (const [re, name] of RESELLERS) {
      const withSku = new RegExp(`${re.source}\\s*#?\\s*[A-Z0-9][\\w.\\-]*`, 'gi')
      if (withSku.test(l)) { out.resellers.push(name); l = l.replace(withSku, '').replace(/\(\s*\)|,\s*,/g, '').replace(/\s{2,}/g, ' ') }
    }
    result.push(l)
  }
  out.text = result.join('\n')
  out.resellers = [...new Set(out.resellers)]
  out.unknown = [...new Set(out.unknown)].filter(Boolean)
  return out
}
