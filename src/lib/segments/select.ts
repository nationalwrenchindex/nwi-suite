// Shared select + shaping for segment reads.
//
// Not in a route file because Next rejects any export from one that is not a handler
// or a route-segment config, and because the tech-facing routes and the public
// approval route must read the SAME columns — a customer approving a total the tech
// cannot see, or vice versa, is the failure this guards against.

import type { WorkOrderSegment } from '@/types/segments'

// The !segment_id hint is REQUIRED, not decorative. There are TWO foreign keys between
// these tables — work_order_segment_options.segment_id -> segments.id, and
// segments.selected_option_id -> options.id — so an unhinted embed is ambiguous and
// PostgREST rejects the whole query with PGRST201. Without it every segment route
// fails, which is exactly how it was found: fabricated test objects never touch this
// string, and the live query did.
export const SEGMENT_SELECT = `
  *,
  options:work_order_segment_options!segment_id(*)
`

/** PostgREST returns the embedded options ordered by nothing in particular; sort so
 *  Good/Better/Best render in the order the shop entered them. */
export function shapeSegments(rows: unknown): WorkOrderSegment[] {
  if (!Array.isArray(rows)) return []
  return (rows as WorkOrderSegment[]).map(seg => ({
    ...seg,
    line_items: Array.isArray(seg.line_items) ? seg.line_items : [],
    options: Array.isArray(seg.options)
      ? [...seg.options].sort((a, b) => a.sort_order - b.sort_order)
      : [],
  }))
}
