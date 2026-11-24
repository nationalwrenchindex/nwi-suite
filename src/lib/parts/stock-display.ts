// How a shop's stock is PRINTED. Display only - no stock number is changed anywhere.
//
// Brock, Nov 24, 2026: the counter printed "On hand -1 / -1 available / Shop: -1" on
// parts whose inventory went negative. A negative availability is not a quantity a tech
// can act on, so:
//   * availability never prints below 0
//   * a negative ON-HAND is not stock: it prints as a count that is wrong and needs
//     correcting, with the recorded figure beside it so the owner can find and fix it
//     (Inventory > Count). It is never hidden and never shown as a quantity.
//
// The ledger and inventory rows keep their real figures; Brock corrects those by hand.

export interface StockFigures {
  on_hand: number
  allocated: number
  available: number
}

/** Availability as printed: never below zero. */
export function shownAvailable(available: number): number {
  const n = Number(available)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** True when the recorded on-hand count is below zero - a wrong count, not stock. */
export function countIsWrong(onHand: number): boolean {
  return Number(onHand) < 0
}

/** The flag printed in place of a negative on-hand count. */
export function wrongCountLabel(onHand: number): string {
  return `Count is wrong (recorded ${onHand}) - correct it in Inventory`
}

/** The lines the parts counter prints for one part's stock, in order. */
export function counterStockLines(stock: StockFigures & {
  locations: Array<{ location_name: string | null; bin: string | null; on_hand: number }>
}): { onHand: string; onHandWrong: boolean; availability: string; locations: string[] } {
  const wrong = countIsWrong(stock.on_hand)
  const avail = shownAvailable(stock.available)
  return {
    onHand: wrong ? 'Count wrong' : String(stock.on_hand),
    onHandWrong: wrong,
    availability: stock.allocated > 0 ? `${stock.allocated} on open jobs - ${avail} available` : `${avail} available`,
    locations: stock.locations.filter(l => l.on_hand !== 0).map(l => {
      const where = `${l.location_name ?? 'Shop'}${l.bin ? ` - bin ${l.bin}` : ''}`
      return countIsWrong(l.on_hand) ? `${where}: count wrong (recorded ${l.on_hand})` : `${where}: ${l.on_hand}`
    }),
  }
}
