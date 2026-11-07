// ─── Unsaved edits on the HD work order screen ────────────────────────────────
//
// The work order screen is several cards that each save their own part: the parts and
// labor lines; drive time / mileage / the service call fee; the unit hours and the
// odometer. "+ Create Invoice"
// converts what is STORED. So anything typed and not yet saved on any card was left
// off the bill without a word - WO-2026-1571 typed 1.0 h of drive time and 50 miles,
// and INV-2026-0027 billed neither. The quote never had this: it is one form and one
// save, so what is on the screen is what is stored.
//
// Each card registers what it has unsaved and how to save it. Saving the lines saves
// the typed fees with them, and Create Invoice saves everything pending before it
// converts - lines first, because shop supplies is a percentage of the saved parts.
//
// Browser-only state, keyed by work order id. No React here, so either card can use it.

export type PendingCard = 'lines' | 'extras' | 'hours' | 'odometer'

interface Entry {
  /** True while the card holds edits the server does not have. */
  dirty: () => boolean
  /** Save them. Resolves to an error message, or null when saved (or nothing to save). */
  flush: () => Promise<string | null>
}

const registry = new Map<string, Map<PendingCard, Entry>>()

/** Register a card's unsaved state. Returns the unregister function for an effect cleanup. */
export function registerPending(workOrderId: string, card: PendingCard, entry: Entry): () => void {
  let cards = registry.get(workOrderId)
  if (!cards) { cards = new Map(); registry.set(workOrderId, cards) }
  cards.set(card, entry)
  return () => {
    const c = registry.get(workOrderId)
    if (c?.get(card) === entry) c.delete(card)
  }
}

/** The cards holding unsaved edits. */
export function pendingCards(workOrderId: string): PendingCard[] {
  const cards = registry.get(workOrderId)
  return cards ? [...cards.entries()].filter(([, e]) => e.dirty()).map(([k]) => k) : []
}

const ORDER: PendingCard[] = ['lines', 'extras', 'hours', 'odometer']

/**
 * Save every card with unsaved edits, lines first. Stops at the first failure and
 * returns its message, so nothing is converted from a half-saved work order.
 */
export async function flushPending(workOrderId: string, only?: PendingCard[]): Promise<string | null> {
  const cards = registry.get(workOrderId)
  if (!cards) return null
  for (const card of ORDER) {
    if (only && !only.includes(card)) continue
    const e = cards.get(card)
    if (!e || !e.dirty()) continue
    const err = await e.flush()
    if (err) return err
  }
  return null
}

/** Broadcast when the lines card gains or loses unsaved edits. */
export const LINES_DIRTY_EVENT = 'hd-wo-lines-dirty'
/** Broadcast when the lines card has saved: shop supplies re-prices on the saved parts. */
export const LINES_SAVED_EVENT = 'hd-wo-lines-saved'

// ─── The extras panel's two rules, pure so the smoke suite can hold them ─────

export interface FeeInputs { hours: string; miles: string; fee: string }

/**
 * The boxes after the panel reloads from the server (a line save re-prices supplies).
 * A box the tech typed into and has not saved keeps what was typed; every other box
 * shows the server's value. `kept` says whether anything typed survived, so the panel
 * re-prices it rather than showing the stored preview.
 */
export function feeInputsAfterReload(typed: FeeInputs, saved: FeeInputs, server: FeeInputs, keepTyped: boolean): FeeInputs & { kept: boolean } {
  const keep = (k: keyof FeeInputs) => keepTyped && typed[k] !== saved[k]
  return {
    hours: keep('hours') ? typed.hours : server.hours,
    miles: keep('miles') ? typed.miles : server.miles,
    fee:   keep('fee')   ? typed.fee   : server.fee,
    kept:  keep('hours') || keep('miles') || keep('fee'),
  }
}

/**
 * What the panel's totals block may print. 'lines-unsaved': the parts card holds edits
 * the server has not priced, so no total at all. 'updating': the boxes changed and the
 * server has not priced them yet. 'priced': the shown total is the server's figure for
 * exactly what is on screen.
 */
export function extrasTotalsState(p: { linesDirty: boolean; feesDirty: boolean; pricedFor: string; showing: string }): 'lines-unsaved' | 'updating' | 'priced' {
  if (p.linesDirty) return 'lines-unsaved'
  if (p.feesDirty && p.pricedFor !== p.showing) return 'updating'
  return 'priced'
}
