// Re-export shim. The module moved to @/lib/shared/work-order-lines when work order
// segments needed this same per-line model on both products (migration 137).
//
// Kept so HD's existing importers — api/hd/work-orders/[id]/line-items and
// components/hd/WorkOrderLineItems — do not have to move in the same change that
// introduces segments. There is one implementation; this is only a second name for it.
// New callers should import from @/lib/shared/work-order-lines directly.

export {
  MAX_WORK_ORDER_LINES,
  toMoney,
  toQuantity,
  isLineType,
  lineTotal,
  lineUnitPrice,
  normalizeLine,
  sumLines,
} from '@/lib/shared/work-order-lines'

export type {
  WorkOrderLineType,
  WorkOrderLine,
  WorkOrderLineInput,
  WorkOrderLineTotals,
} from '@/lib/shared/work-order-lines'
