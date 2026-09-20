/**
 * Shared shape and filtering for the HD invoice list.
 *
 * Lives outside route.ts because Next rejects any export from a route file that
 * is not a handler or a route-segment config — and because the server page and
 * the "Load More" API must apply byte-identical filters or the header count, the
 * first page and every later page would each describe a different set of rows.
 */

export const HD_INVOICE_LIST_SELECT =
  'id, invoice_number, customer_name, unit_manufacturer, unit_model, total, status, payment_terms, due_date, created_at, paid_at'

/** What the /hd/invoices list asks for per "Load More". */
export const HD_INVOICE_PAGE_SIZE = 50

/**
 * What GET returns when the caller sends no `limit`.
 *
 * Deliberately not HD_INVOICE_PAGE_SIZE: HDFinancialsClient's Invoices tab calls
 * this endpoint bare and totals whatever comes back, so dropping the default to
 * 50 would silently shrink the figures on that dashboard. The list page sends its
 * own limit, so the two do not have to agree.
 */
export const HD_INVOICE_DEFAULT_LIMIT = 200

/** Every status an hd_invoice can carry, in the order the summary strip shows them. */
export const HD_INVOICE_STATUSES = ['unpaid', 'sent', 'overdue', 'paid', 'partial', 'void'] as const

export interface HDInvoiceListRow {
  id:                string
  invoice_number:    string
  customer_name:     string | null
  unit_manufacturer: string | null
  unit_model:        string | null
  total:             number | null
  status:            string
  payment_terms:     string | null
  due_date:          string | null
  created_at:        string
  paid_at:           string | null
}

/** Minimal structural shape of a PostgREST builder, so this can take either a row
 *  query or a `head: true` count query without importing postgrest-js generics. */
type OrFilterable<T> = { or(filters: string): T }

/**
 * Applies the list's `?filter=` to a query.
 *
 * The overdue view used to be a `.filter()` over the rows already in memory, which
 * cannot survive pagination: once the list only holds 50 of 1,545 rows, filtering
 * client-side would show "the overdue ones among the first 50", and the count above
 * it would be just as wrong. Pushing it into the query means the same predicate
 * drives the page, the header count and every later page.
 *
 * "Overdue" is `status = 'overdue'`, or past its due date while still collectable.
 * The status list is spelled out rather than using NOT IN (paid, void) because a
 * null due_date must not match either way, and `.lt` already excludes nulls.
 */
export function applyHDInvoiceListFilter<T extends OrFilterable<T>>(
  query: T,
  filter: string | null | undefined,
): T {
  if (filter !== 'overdue') return query
  const today = new Date().toISOString().slice(0, 10)
  return query.or(`status.eq.overdue,and(due_date.lt.${today},status.in.(unpaid,sent,partial))`)
}
