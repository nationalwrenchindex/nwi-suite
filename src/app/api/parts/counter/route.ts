// GET /api/parts/counter   the parts counter: what fits this unit, or what is this number
//
// Query parameters
//   maker       Thermo King | Carrier Transicold. Constrains ABSOLUTELY.
//   model       one unit model. "S-600" and "Precedent S-600" are one unit (narrow.ts).
//   mount       truck | trailer. Optional: a unit's mount is read from its chart rows.
//   engine      an engine designation. With a model it NARROWS (blank engine = the standard
//               group, a fallback, never a wildcard); without one it finds parts by engine.
//   serial      narrows a serial split, and says so when it cannot
//   build_date  2023, 2023-07 or 07/2023; narrows a build-date split
//   configuration  as charted ("with smart power"); narrows a configuration split
//   bm          a Thermo King BM number; narrows by BM range once ranges are recorded
//   part_type   one part type from the list, exact
//   q           a part number in any format, a cross number, or words ("lube filter",
//               "drive belt" - words also match the role a part is charted for on the unit)
//   show_unconfirmed=1  also return the weaker matches the chart suppressed, marked so
//   scope       all | reefer. A reefer-only account is held to reefer whatever it sends.
//
// One route for HD and Reefer Standalone. The surfaces differ only in `scope`, a filter on
// the catalog's parts.equipment_type - never used to narrow a unit search (Brock, Nov 16).
//
// THE NARROWING (Brock's chart, Part 4) is src/lib/parts/narrow.ts, shared with
// /api/parts/search: mount, unit model, engine, serial, build date, configuration; rows the
// chart contradicts are never returned; weaker unbounded rows lose to the chart.
//
// SUPERSEDED NUMBERS. A number on the old side of a part_supersession row is never offered
// as a current answer. In a unit search its claim moves to its replacement ("was" shows the
// old number) - to every replacement when there are several conditional ones - and an old
// number whose link is too weak to follow is returned below the answers, marked not current,
// with the replacement it is reported to have. Searched by number, the old number is still
// found, marked not current, with every replacement listed, and the replacement is returned.
//
// WHAT IT NEVER RETURNS: a price, or where a row came from. The counter answers "which
// part" and "how many are on my shelf". Cost and sell live on the inventory screen.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess, reeferStandaloneCan } from '@/lib/hd-access'
import { manufacturerMatches, modelMatches, serialLabel, normalizePartNumber, textMatches } from '@/lib/parts/search'
import {
  adviceOf, badgeOf, bestTrust, bmInRange, displayOf, followChain, inScope, replacementsOf, trustRank,
  typeSynonymMatches, type CounterScope, type Trust,
} from '@/lib/parts/counter'
import {
  narrowUnitRows, parseBuildDate, partMountsOf, roleMatches, unitModelMatches,
  type Mount, type NarrowRow,
} from '@/lib/parts/narrow'
import { readCatalog, readStockByPart, type CatalogFitment, type CatalogPart } from '@/lib/parts/catalog'
import { parsePartNumber, partNumberSearchKeys } from '@/lib/parts/part-number'

export const dynamic = 'force-dynamic'

type Replacement = { to: string; note: string | null; trust: Trust; followed: boolean }

interface Card {
  part: CatalogPart
  matchedFitment: CatalogFitment[]
  trust: Trust
  matchedOn: string
  was: string[]
  unresolvedSerial: boolean
  /** False for an old number: found, shown, never offered as the answer. */
  current: boolean
  replacedBy: Replacement[]
  /** The condition on a conditional replacement (the link's note). */
  condition: string | null
  /** Set when the chart suppressed this match and show_unconfirmed asked for it anyway. */
  suppressedReason: string | null
  reported: { to: string; note: string | null; trust: Trust } | null
}

type Row = NarrowRow & { f: CatalogFitment }

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
  const configuration = val('configuration')
  const buildDateRaw = val('build_date')
  const buildDate = parseBuildDate(buildDateRaw)
  const mountParam = val('mount')
  const mount: Mount | null = mountParam === 'truck' || mountParam === 'trailer' ? mountParam : null
  const showUnconfirmed = ['1', 'true', 'yes'].includes((p.get('show_unconfirmed') ?? '').toLowerCase())
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

  // equipment_type is the SURFACE scope (inScope) and nothing else.
  const parts = catalog.parts.filter(pt => inScope(pt.equipment_type, scope) && manufacturerMatches(pt.manufacturer, maker))
  const byId = new Map(parts.map(pt => [pt.id, pt]))
  const byNumber = new Map(catalog.parts.map(pt => [pt.part_number_normalized, pt]))
  const fitByPart = new Map<string, CatalogFitment[]>()
  for (const f of catalog.fitment) fitByPart.set(f.part_id, [...(fitByPart.get(f.part_id) ?? []), f])
  const partMounts = partMountsOf(catalog.fitment)

  const partTrust = (pt: CatalogPart): Trust => ({ tier: pt.confidence, verified: pt.verified })
  const fitTrust  = (f: CatalogFitment): Trust => ({ tier: f.confidence, verified: f.verified })
  const digits = !!q && /[0-9]/.test(q)
  const words  = q && !digits ? q : null
  const typeOk = (pt: CatalogPart) =>
    (!partType || pt.part_type === partType) &&
    (!q || digits || typeSynonymMatches(pt.part_type, q) || textMatches(pt, q))

  const blankCard = (part: CatalogPart, over: Partial<Card>): Card => ({
    part, matchedFitment: [], trust: partTrust(part), matchedOn: '', was: [], unresolvedSerial: false,
    current: true, replacedBy: [], condition: null, suppressedReason: null, reported: null, ...over,
  })

  const cards: Card[] = []
  let bmRangesRecorded = 0
  let unresolvedSerialCount = 0
  let narrowSummary: Record<string, unknown> | null = null
  let suppressedList: Array<{ part_number: string; part_type: string; reason: string }> = []
  let configurationChoices: Array<{ part_type: string; role: string | null; options: Array<{ configuration: string; part_numbers: string[] }> }> = []
  const byUnit = !!(model || engine || bm)

  if (model) {
    // ── by unit model: the chart's narrowing ───────────────────────────────
    const toRow = (f: CatalogFitment): Row => ({
      id: f.id, part_id: f.part_id, family: byId.get(f.part_id)!.part_type,
      engine: f.engine_code ?? f.engine_model,
      serial_from: f.serial_from, serial_before: f.serial_before,
      build_date_from: f.build_date_from, build_date_before: f.build_date_before,
      mount_type: f.mount_type, configuration: f.configuration, role: f.role,
      trust: fitTrust(f), f,
    })
    // Every row for this unit, whatever the part type: they decide its mount.
    const unitRows = catalog.fitment.filter(f => byId.has(f.part_id) && unitModelMatches(f.unit_model, model))
    const candidates = unitRows.filter(f => {
      const pt = byId.get(f.part_id)!
      if (digits && !textMatches(pt, q)) return false
      if (partType && pt.part_type !== partType) return false
      // Words name a part type, a description, or the role it is charted for on this unit.
      return typeOk(pt) || (!!words && !!f.role && roleMatches(f.role, words))
    })
    bmRangesRecorded = candidates.filter(f => f.bm_from).length
    const nr = narrowUnitRows(candidates.map(toRow), { mount, engine, serial, buildDate, configuration, words }, partMounts, unitRows)

    const group = (rows: Row[]) => {
      const m = new Map<string, Row[]>()
      for (const r of rows) m.set(r.part_id, [...(m.get(r.part_id) ?? []), r])
      return m
    }
    for (const [partId, rows] of group(nr.kept)) {
      const unresolved = rows.some(r => nr.unresolvedSerial.has(r.id))
      if (unresolved) unresolvedSerialCount++
      const bounded = rows.some(r => r.serial_from || r.serial_before)
      cards.push(blankCard(byId.get(partId)!, {
        matchedFitment: rows.map(r => r.f),
        trust: bestTrust(rows.map(r => r.trust))!,
        matchedOn: `matched on unit model ${rows[0].f.unit_model}${serial && !unresolved && bounded ? `, serial ${serial}` : ''}`,
        unresolvedSerial: unresolved,
      }))
    }
    const suppressedByPart = group(nr.suppressed.map(s => s.row))
    const reasonOf = new Map(nr.suppressed.map(s => [s.row.part_id, s.reason]))
    suppressedList = [...suppressedByPart.keys()].map(id => ({
      part_number: byId.get(id)!.part_number, part_type: byId.get(id)!.part_type, reason: reasonOf.get(id)!,
    })).sort((a, b) => a.part_number.localeCompare(b.part_number))
    if (showUnconfirmed) {
      for (const [partId, rows] of suppressedByPart) {
        cards.push(blankCard(byId.get(partId)!, {
          matchedFitment: rows.map(r => r.f),
          trust: bestTrust(rows.map(r => r.trust))!,
          matchedOn: `matched on unit model ${rows[0].f.unit_model} - an unconfirmed match the chart does not support`,
          suppressedReason: reasonOf.get(partId)!,
        }))
      }
    }
    configurationChoices = nr.configurationChoices.map(c => ({
      part_type: c.family, role: c.role,
      options: c.options.map(o => ({ configuration: o.configuration, part_numbers: o.part_ids.map(id => byId.get(id)!.part_number).sort() })),
    }))
    narrowSummary = { unit_mount: nr.unitMount, excluded: nr.excluded, suppressed_count: suppressedList.length }
  } else if (engine || bm) {
    // ── by engine or BM alone (no model) ───────────────────────────────────
    for (const pt of parts) {
      if (!typeOk(pt)) continue
      if (digits && !textMatches(pt, q)) continue
      const matched: Array<{ f: CatalogFitment; on: string }> = []
      for (const f of fitByPart.get(pt.id) ?? []) {
        if (f.bm_from) bmRangesRecorded++
        if (f.confidence === 'conflict') continue
        if (engine && (modelMatches(f.engine_model, engine) || modelMatches(f.engine_code, engine)))
          matched.push({ f, on: `engine ${f.engine_code ?? f.engine_model}` })
        else if (bm && f.bm_from && bmInRange(bm, f.bm_from, f.bm_to) === true)
          matched.push({ f, on: `BM ${bm} (range ${f.bm_from}${f.bm_to ? '-' + f.bm_to : ''})` })
      }
      if (!matched.length) continue
      cards.push(blankCard(pt, {
        matchedFitment: matched.map(m => m.f),
        trust: bestTrust(matched.map(m => fitTrust(m.f)))!,
        matchedOn: `matched on ${matched[0].on}`,
      }))
    }
  } else if (q || partType) {
    // ── by number, cross number or words ────────────────────────────────────
    // Every typed number goes through the one normalizer: 37-11-9959 is 11-9959.
    const keys = q ? partNumberSearchKeys(q) : []
    const crossHit = new Set(digits
      ? catalog.crosses.filter(c => keys.some(k => normalizePartNumber(c.brand_number).includes(k))).map(c => c.part_id)
      : [])
    for (const pt of parts) {
      if (!typeOk(pt)) continue
      const numberHit = digits && textMatches(pt, q)
      if (digits && !numberHit && !crossHit.has(pt.id)) continue
      cards.push(blankCard(pt, {
        matchedOn: digits ? (numberHit ? 'matched on part number' : 'matched on a cross-reference number') : 'matched on part type',
      }))
    }
    // A number printed on an old part may be in no part row at all - only in a
    // supersession. Start the chain from what was typed so it still finds the part.
    if (digits && !cards.length) {
      const typed = parsePartNumber(q!)
      const chain = followChain(typed.canonical, typed.key, catalog.links)
      const cur = byId.get(byNumber.get(chain.currentNormalized)?.id ?? '')
      if (cur && chain.was.length) cards.push(blankCard(cur, { matchedOn: `matched on superseded number ${q}` }))
    }
  }

  // ── supersession ─────────────────────────────────────────────────────────
  const merged = new Map<string, Card>()
  const put = (card: Card) => {
    const prior = merged.get(card.part.id)
    // Copied: one old card can feed several conditional replacements, and a merge must
    // never write into another card's arrays.
    if (!prior) { merged.set(card.part.id, { ...card, matchedFitment: [...card.matchedFitment], was: [...card.was] }); return }
    prior.matchedFitment.push(...card.matchedFitment)
    prior.was = [...new Set([...prior.was, ...card.was])]
    prior.trust = bestTrust([prior.trust, card.trust])!
    prior.unresolvedSerial ||= card.unresolvedSerial
    prior.current ||= card.current
    if (card.condition && !prior.condition) prior.condition = card.condition
    if (!card.suppressedReason) prior.suppressedReason = null
  }
  const usable = (normalized: string) => {
    const pt = byNumber.get(normalized)
    return pt && byId.has(pt.id) ? pt : null
  }
  for (const card of cards) {
    const links = replacementsOf(card.part.part_number_normalized, catalog.links)
    if (!links.length) { put(card); continue }
    const replacedBy: Replacement[] = links.map(l => ({ to: l.to, note: l.note, trust: l.trust, followed: l.followed }))
    const chain = followChain(card.part.part_number, card.part.part_number_normalized, catalog.links)
    // Where the followed links lead: one number, or every conditional option.
    const leads: Array<{ part: CatalogPart; was: string[]; condition: string | null; reported: Card['reported'] }> = []
    if (chain.branches.length) {
      // The chain stopped at the number with several replacements: it and everything
      // before it are what each option replaces, newest first.
      for (const b of chain.branches) {
        const pt = usable(b.toNormalized)
        if (pt) leads.push({ part: pt, was: [chain.current, ...chain.was], condition: b.note, reported: null })
      }
    } else if (chain.was.length) {
      const pt = usable(chain.currentNormalized)
      if (pt) leads.push({ part: pt, was: chain.was, condition: null, reported: chain.reported })
    }

    if (byUnit) {
      // The old number is never the answer for a unit; its claim moves to the replacement.
      if (leads.length) {
        for (const l of leads) put({ ...card, part: l.part, was: l.was, condition: l.condition, reported: l.reported, current: true, replacedBy: [] })
      } else {
        put({ ...card, current: false, replacedBy })
      }
    } else {
      // Searched by number: the old number is still found, marked not current ...
      put({ ...card, current: false, replacedBy })
      // ... and what replaced it is returned as the answer.
      for (const l of leads) put(blankCard(l.part, { was: l.was, condition: l.condition, reported: l.reported, matchedOn: `replaces ${card.part.part_number}` }))
    }
  }
  // A current answer that is itself reported replaced by a weak link says so.
  for (const c of merged.values()) {
    if (c.current && !c.reported) c.reported = followChain(c.part.part_number, c.part.part_number_normalized, catalog.links).reported
  }

  const results = [...merged.values()]
    .sort((a, b) =>
      Number(!a.current) - Number(!b.current) ||
      Number(!!a.suppressedReason) - Number(!!b.suppressedReason) ||
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
        current: c.current,
        replaced_by: c.replacedBy.map(r => ({ to: r.to, note: r.note, badge: badgeOf(r.trust), followed: r.followed })),
        condition: c.condition,
        suppressed: !!c.suppressedReason,
        suppressed_reason: c.suppressedReason,
        was: c.was,
        reported_replaced_by: c.current && c.reported
          ? { to: c.reported.to, note: c.reported.note, badge: badgeOf(c.reported.trust) }
          : null,
        unresolved_serial: c.unresolvedSerial,
        fitment: c.matchedFitment.map(f => ({
          id: f.id,
          unit_model: f.unit_model,
          engine: f.engine_code ?? f.engine_model,
          compressor_model: f.compressor_model,
          serial_label: serialLabel(f),
          build_date_from: f.build_date_from,
          build_date_before: f.build_date_before,
          mount_type: f.mount_type,
          configuration: f.configuration,
          role: f.role,
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
    roles_recorded: catalog.roles,
    count: results.filter(r => r.current && !r.suppressed).length,
    unresolved_serial_count: unresolvedSerialCount,
    // Said plainly so the screen can tell the tech why a BM number changed nothing.
    bm_note: bm && bmRangesRecorded === 0
      ? 'No BM ranges are recorded for these parts yet, so the BM number did not narrow this list.'
      : null,
    build_date_note: buildDateRaw && !buildDate ? `"${buildDateRaw}" is not a build date this can read (use 2023-07 or 07/2023), so it did not narrow the list.` : null,
    narrowed: narrowSummary,
    suppressed: suppressedList,
    show_unconfirmed: showUnconfirmed,
    configuration_choices: configurationChoices,
    results,
  })
}
