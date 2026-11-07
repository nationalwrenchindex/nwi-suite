// ─── An HD document's address, as one printed line ────────────────────────────
//
// LINE 2 IS NEVER A SECOND COPY OF LINE 1. INV-2026-0029 billed "123 sesame st., 123
// sesame st., Winston salem, NC, 27105": the customer record held the street in BOTH
// address_line1 and address_line2, the work order and invoice copied it faithfully, and
// the template printed both. It was self-sustaining: that printed line, pasted back
// into the paste box, splits to line 1 = line 2 again, and customer logging never
// clears a stored line 2 (blanks are dropped so a save cannot erase an address). The
// template was right; the data was wrong, and nothing stopped it. Now a line 2 that is
// the same street as line 1 (case, spacing and punctuation aside) is not printed, not
// parsed out of a paste, and not written to a customer.

const key = (v: unknown): string => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** True when line 2 is only a repeat of line 1 ("123 Sesame St." / "123 sesame st"). */
export function sameStreet(line1: unknown, line2: unknown): boolean {
  const a = key(line1)
  return a !== '' && a === key(line2)
}

/** Line 2 as it should be stored or printed: null when blank or a repeat of line 1. */
export function distinctLine2(line1: unknown, line2: unknown): string | null {
  const t = typeof line2 === 'string' ? line2.trim() : ''
  return t === '' || sameStreet(line1, t) ? null : t
}

/** "123 Main St, Suite 4, Winston-Salem, NC, 27105" - blanks and a repeated line 2 left out. */
export function addressLine(line1: unknown, line2: unknown, city: unknown, state: unknown, zip: unknown): string {
  const s = (v: unknown) => String(v ?? '').trim()
  return [s(line1), distinctLine2(line1, line2) ?? '', [s(city), s(state)].filter(Boolean).join(', '), s(zip)]
    .filter(Boolean).join(', ')
}
