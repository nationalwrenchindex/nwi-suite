// GET /api/parts/counter   the parts counter: what fits this unit, or what is this number
//
// Query parameters
//   maker       Thermo King | Carrier Transicold. Constrains ABSOLUTELY.
//   model       one unit model
//   serial      narrows a serial split, and says so when it cannot
//   bm          a Thermo King BM number; narrows by BM range once ranges are recorded
//   engine      an engine designation, for parts that fit by engine
//   part_type   one part type from the list, exact
//   q           a part number in any format, a cross number, or words ("lube filter")
//   scope       all | reefer. A reefer-only account is held to reefer whatever it sends.
//
// One route for HD and Reefer Standalone. The surfaces differ only in `scope`, which is
// a filter on the catalog's equipment_type - not a second code path.
//
// WHAT IT NEVER RETURNS: a price, or where a row came from. The counter answers "which
// part" and "how many are on my shelf". Cost and sell live on the inventory screen.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess, reeferStandaloneCan } from '@/lib/hd-access'
import {
  manufacturerMatches, modelMatches, serialApplies, serialLabel, normalizePartNumber, textMatches,
} from '@/lib/parts/search'
import {
  adviceOf, badgeOf, bestTrust, bmInRange, displayOf, followChain, followable, inScope, trustRank,
  typeSynonymMatches, type CounterScope, type Trust,
} from '@/lib/parts/counter'
import { readCatalog, readStockByPart, type CatalogFitment, type CatalogPart } from '@/lib/parts/catalog'
import { parsePartNumber, partNumberSearchKeys } from '@/lib/parts/part-number'

export const dynamic = 'force-dynamic'

interface Card {
  part: CatalogPart
  matchedFitment: CatalogFitment[]
  trust: Trust
  matchedOn: string
  was: string[]
  unresolvedSerial: boolean
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hdAccess = await checkHDAccess(user.id)
  if (!hdAccess && !(await reeferStandaloneCan(user.id, 'reefer_parts_reference'))) {
    return NextResponse.json({ error: 'A parts subscription is required' }, { status: 403 })
  }

  const p = request.nextUrl.searchParams
  const val = (k: string) => p.get(k)?.trim() || null
  const maker = val('maker'), model = val('model'), serial = val('serial'), bm = val('bm')
  const engine = val('engine'), partType = val('part_type'), q = val('q')
  // A Reefer Standalone account sees the reefer catalog whatever it asks for.
  const scope: CounterScope = !hdAccess || p.get('scope') === 'reefer' ? 'reefer' : 'all'

  let catalog
  try {
    catalog = await readCatalog(supabase)
  } catch (err) {
    console.error('[parts/counter] catalog read failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Could not read the parts catalog' }, { status: 500 })
  }
  const stock = await readStockByPart(supabase, user.id)

  const parts = catalog.parts.filter(pt => inScope(pt.equipment_type, scope) && manufacturerMatches(pt.manufacturer, maker))
  const byId = new Map(parts.map(pt => [pt.id, pt]))
  const byNumber = new Map(catalog.parts.map(pt => [pt.part_number_normalized, pt]))
  const fitByPart = new Map<string, CatalogFitment[]>()
  for (const f of catalog.fitment) fitByPart.set(f.part_id, [...(fitByPart.get(f.part_id) ?? []), f])

  const partTrust = (pt: CatalogPart): Trust => ({ tier: pt.confidence, verified: pt.verified })
  const fitTrust  = (f: CatalogFitment): Trust => ({ tier: f.confidence, verified: f.verified })
  const typeOk = (pt: CatalogPart) =>
    (!partType || pt.part_type === partType) &&
    (!q || /[0-9]/.test(q) || typeSynonymMatches(pt.part_type, q) || textMatches(pt, q))

  const hasUnit = !!(model || engine || bm)
  const cards: Card[] = []
  let bmRangesRecorded = 0
  let unresolvedSerialCount = 0

  if (hasUnit) {
    // ── by unit ─────────────────────────────────────────────────────────────
    for (const pt of parts) {
      if (!typeOk(pt)) continue
      if (q && /[0-9]/.test(q) && !textMatches(pt, q)) continue
      const rows = fitByPart.get(pt.id) ?? []
      const matched: Array<{ f: CatalogFitment; on: string }> = []
      for (const f of rows) {
        if (f.bm_from) bmRangesRecorded++
        if (model && modelMatches(f.unit_model, model)) matched.push({ f, on: `unit model ${f.unit_model}` })
        else if (engine && (modelMatches(f.engine_model, engine) || modelMatches(f.engine_code, engine)))
          matched.push({ f, on: `engine ${f.engine_code ?? f.engine_model}` })
        else if (bm && f.bm_from && bmInRange(bm, f.bm_from, f.bm_to) === true)
          matched.push({ f, on: `BM ${bm} (range ${f.bm_from}${f.bm_to ? '-' + f.bm_to : ''})` })
      }
      if (!matched.length) continue

      // A serial narrows the split; when the serials cannot be compared the row stays
      // in and the card says so - never silently dropped.
      const kept: typeof matched = []
      let unresolved = false
      for (const m of matched) {
        const applies = serialApplies(m.f, serial)
        if (applies === false) continue
        if (applies === null) unresolved = true
        kept.push(m)
      }
      if (!kept.length) continue
      if (unresolved) unresolvedSerialCount++

      cards.push({
        part: pt,
        matchedFitment: kept.map(k => k.f),
        trust: bestTrust(kept.map(k => fitTrust(k.f)))!,
        matchedOn: `matched on ${kept[0].on}${serial && !unresolved && kept.some(k => k.f.serial_from || k.f.serial_before) ? `, serial ${serial}` : ''}`,
        was: [],
        unresolvedSerial: unresolved,
      })
    }
  } else if (q || partType) {
    // ── by number, cross number or words ────────────────────────────────────
    const digits = !!q && /[0-9]/.test(q)
    // Every typed number goes through the one normalizer: 37-11-9959 is 11-9959.
    const keys = q ? partNumberSearchKeys(q) : []
    const crossHit = new Set(digits
      ? catalog.crosses.filter(c => keys.some(k => normalizePartNumber(c.brand_number).includes(k))).map(c => c.part_id)
      : [])
    for (const pt of parts) {
      if (!typeOk(pt)) continue
      const numberHit = digits && textMatches(pt, q)
      if (digits && !numberHit && !crossHit.has(pt.id)) continue
      cards.push({
        part: pt, matchedFitment: [], trust: partTrust(pt),
        matchedOn: digits ? (numberHit ? 'matched on part number' : 'matched on a cross-reference number') : 'matched on part type',
        was: [], unresolvedSerial: false,
      })
    }
    // A number printed on an old part may be in no part row at all - only in a
    // supersession. Start the chain from what was typed so it still finds the part.
    if (digits && !cards.length) {
      const typed = parsePartNumber(q!)
      const chain = followChain(typed.canonical, typed.key, catalog.links)
      const cur = byId.get(byNumber.get(chain.currentNormalized)?.id ?? '')
      if (cur && chain.was.length) {
        cards.push({ part: cur, matchedFitment: [], trust: partTrust(cur), matchedOn: `matched on superseded number ${q}`, was: [], unresolvedSerial: false })
      }
    }
  }

  // ── supersession: show the current number first, the old one underneath ──
  // A followed replacement that is not a part this surface sells is still reported, with
  // the trust of the link that replaced the matched number.
  const replacedOutsideCatalog = (fromNormalized: string, to: string) => {
    const link = catalog.links.find(l => l.old_number_normalized === fromNormalized && followable(l))
    return link ? { to, note: link.note, trust: { tier: link.confidence, verified: link.verified } } : null
  }
  const merged = new Map<string, Card & { reported: ReturnType<typeof followChain>['reported'] }>()
  for (const card of cards) {
    const chain = followChain(card.part.part_number, card.part.part_number_normalized, catalog.links)
    const current = chain.was.length ? byNumber.get(chain.currentNormalized) : card.part
    // The replacement is shown only when it is a catalog part this surface sells.
    // Otherwise the matched number stays, with the replacement reported as text.
    const usable = current && byId.has(current.id) ? current : card.part
    const followed = usable !== card.part
    const key = usable.id
    const prior = merged.get(key)
    const was = followed ? chain.was : []
    if (prior) {
      prior.matchedFitment.push(...card.matchedFitment)
      prior.was = [...new Set([...prior.was, ...was])]
      prior.trust = bestTrust([prior.trust, card.trust])!
      prior.unresolvedSerial ||= card.unresolvedSerial
    } else {
      merged.set(key, {
        ...card, part: usable, was,
        reported: followed || !chain.was.length ? chain.reported : replacedOutsideCatalog(card.part.part_number_normalized, chain.current),
      })
    }
  }

  const results = [...merged.values()]
    .sort((a, b) =>
      trustRank(a.trust) - trustRank(b.trust) ||
      Number(a.unresolvedSerial) - Number(b.unresolvedSerial) ||
      a.part.part_number.localeCompare(b.part.part_number))
    .map(c => {
      const display = displayOf(c.trust)
      const st = stock.get(c.part.id)
      const crosses = catalog.crosses.filter(x => x.part_id === c.part.id)
      const brands = new Map<string, Array<{ number: string; badge: string; display: string }>>()
      for (const x of crosses) {
        const t = { tier: x.confidence, verified: x.verified }
        brands.set(x.brand, [...(brands.get(x.brand) ?? []), { number: x.brand_number, badge: badgeOf(t), display: displayOf(t) }])
      }
      return {
        id: c.part.id,
        part_number: c.part.part_number,
        manufacturer: c.part.manufacturer,
        part_type: c.part.part_type,
        description: c.part.description,
        notes: c.part.notes,
        badge: badgeOf(c.trust),
        display,
        advice: adviceOf(display),
        matched_on: c.matchedOn,
        was: c.was,
        reported_replaced_by: c.reported
          ? { to: c.reported.to, note: c.reported.note, badge: badgeOf(c.reported.trust) }
          : null,
        unresolved_serial: c.unresolvedSerial,
        fitment: c.matchedFitment.map(f => ({
          id: f.id,
          unit_model: f.unit_model,
          engine: f.engine_code ?? f.engine_model,
          compressor_model: f.compressor_model,
          serial_label: serialLabel(f),
          build_date_before: f.build_date_before,
          qty_per_unit: f.qty_per_unit,
          note: f.note,
          badge: badgeOf(fitTrust(f)),
          display: displayOf(fitTrust(f)),
        })),
        crosses: [...brands.entries()].map(([brand, numbers]) => ({ brand, numbers })),
        stock: st ?? { on_hand: 0, allocated: 0, available: 0, locations: [] },
      }
    })

  return NextResponse.json({
    scope,
    tiers_available: catalog.tiers,
    count: results.length,
    unresolved_serial_count: unresolvedSerialCount,
    // Said plainly so the screen can tell the tech why a BM number changed nothing.
    bm_note: bm && bmRangesRecorded === 0
      ? 'No BM ranges are recorded for these parts yet, so the BM number did not narrow this list.'
      : null,
    results,
  })
}
