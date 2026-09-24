// Shared shape for the work-order list.
//
// Lives outside route.ts because Next rejects any export from a route file that is
// not a handler or a route-segment config — and because the server page and the
// "Load More" API must apply byte-identical selects and filters, or the header
// count, the first page and every later page would each describe a different set.

export const WORK_ORDER_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, vin)
`

/** What the list asks for per "Load More". */
export const WORK_ORDER_PAGE_SIZE = 50
