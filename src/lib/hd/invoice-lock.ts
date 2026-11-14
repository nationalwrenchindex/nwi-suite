// ─── When an HD invoice may change, and what a change after sending records ────
//
// Pure: no database. The invoice PUT, the refresh-from-work-order route and the
// screens all read these, so the server and the screen cannot disagree about whether
// an invoice is open.
//
// LOCKED    paid, partial and void. Money has been taken against a paid or partially
//           paid invoice's figures, and a void one is closed. None of them is edited
//           or refreshed - by the screen or by the API. (Before Nov 14 the PUT took any
//           body at any status, so a paid invoice could be rewritten through the API.)
//
// SENT      An unpaid invoice that has gone to the customer may still be corrected,
//           but the customer is then holding a copy that no longer matches it. Every
//           such change stamps changed_after_send_at (migration 188) and appends a
//           dated line to internal_notes - the note is written whether or not 188 is
//           applied, so the record never depends on a hand-run migration.

export const LOCKED_INVOICE_STATUSES = ['paid', 'partial', 'void'] as const

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

export function isInvoiceLocked(status: unknown): boolean {
  return (LOCKED_INVOICE_STATUSES as readonly string[]).includes(str(status).toLowerCase())
}

/** The sentence a refused edit or refresh returns. */
export function lockedMessage(invoice: Record<string, unknown>, action: 'edited' | 'refreshed' = 'edited'): string {
  const num = str(invoice.invoice_number) || 'This invoice'
  const s = str(invoice.status).toLowerCase()
  const why = s === 'paid' ? 'is paid'
    : s === 'partial' ? 'is partially paid - money has been taken against its figures'
    : 'is void'
  return `${num} ${why}, so it cannot be ${action}.`
}

/** Has this invoice gone to the customer? Any of the send stamps, or a sent status. */
export function wasSent(invoice: Record<string, unknown>): boolean {
  if (invoice.sent_at || invoice.last_sent_at) return true
  const s = str(invoice.status).toLowerCase()
  return s === 'sent' || s === 'overdue'
}

/** When the customer last received it: the latest send, else the first. */
export function lastSentAt(invoice: Record<string, unknown>): string | null {
  const v = invoice.last_sent_at ?? invoice.sent_at
  return v ? str(v) : null
}

/**
 * The customer is holding an older copy: the invoice changed after the last time it
 * was sent. Resending clears it (the send route moves last_sent_at past the change).
 */
export function holdsOlderCopy(invoice: Record<string, unknown>): boolean {
  const changed = invoice.changed_after_send_at ? Date.parse(str(invoice.changed_after_send_at)) : NaN
  if (!Number.isFinite(changed)) return false
  const sent = lastSentAt(invoice)
  if (!sent) return false
  return changed > Date.parse(sent)
}

/**
 * Keys that are bookkeeping, not what the customer reads. A change to only these is
 * not a change to the invoice the customer holds.
 */
const BOOKKEEPING_KEYS = new Set([
  'status', 'paid_at', 'sent_at', 'last_sent_at', 'sent_count', 'due_date', 'internal_notes',
  'updated_at', 'terms_snapshot', 'changed_after_send_at', 'parts_cost', 'parts_sell',
  'customer_id', 'unit_id', 'fleet_account_id',
])

/**
 * JSON with object keys sorted. A jsonb column hands its objects back in Postgres's
 * own key order (shorter keys first), not the order they were written in, so a plain
 * JSON.stringify called a stored tax_breakdown different from the identical one just
 * computed - and a refresh that changed nothing reported a change.
 */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)))
    : val))
}

function same(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null
  if (typeof a === 'number' || typeof b === 'number') {
    const x = Number(a), y = Number(b)
    if (Number.isFinite(x) && Number.isFinite(y)) return Math.abs(x - y) < 1e-9
  }
  return canonical(a) === canonical(b)
}

/** The customer-facing fields this update actually changes on the stored row. */
export function customerFacingChanges(stored: Record<string, unknown>, update: Record<string, unknown>): string[] {
  return Object.keys(update).filter(k => !BOOKKEEPING_KEYS.has(k) && !same(update[k], stored[k])).sort()
}

const usd = (n: unknown) => `$${(Math.round(Number(n ?? 0) * 100) / 100).toFixed(2)}`

/** A dated line appended to internal_notes. */
export function appendDatedNote(existing: unknown, line: string, now = new Date()): string {
  const stamped = `[${now.toISOString().slice(0, 16).replace('T', ' ')} UTC] ${line}`
  const prior = str(existing).trim()
  return prior ? `${prior}\n${stamped}` : stamped
}

/**
 * What a change to a SENT invoice adds to the update: the stamp (when the column
 * exists - `hasStampColumn`, read off the stored row) and a note naming when the
 * customer last received it and what moved. Nothing when it was never sent, or when
 * the update changes nothing the customer reads.
 */
export function changedAfterSendFields(
  stored: Record<string, unknown>,
  update: Record<string, unknown>,
  how: 'edit' | 'refresh',
  now = new Date(),
): Record<string, unknown> {
  if (!wasSent(stored)) return {}
  const changed = customerFacingChanges(stored, update)
  if (!changed.length) return {}
  const sent = lastSentAt(stored)
  const totalMoved = 'total' in update && !same(update.total, stored.total)
    ? ` Total ${usd(stored.total)} -> ${usd(update.total)}.` : ''
  const line = `Changed after it was sent${sent ? ` (last sent ${sent.slice(0, 10)})` : ''} by ${how === 'refresh' ? 'a refresh from the work order' : 'an edit'}: ${changed.join(', ')}.${totalMoved} The customer is holding the earlier copy until it is sent again.`
  const notesBase = 'internal_notes' in update ? update.internal_notes : stored.internal_notes
  return {
    ...('changed_after_send_at' in stored ? { changed_after_send_at: now.toISOString() } : {}),
    internal_notes: appendDatedNote(notesBase, line, now),
  }
}
