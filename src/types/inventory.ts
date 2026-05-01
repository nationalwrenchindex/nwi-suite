// ─── Enums ────────────────────────────────────────────────────────────────────

export type ProductCategory =
  | 'wash'
  | 'wax'
  | 'polish'
  | 'ceramic'
  | 'interior'
  | 'protection'
  | 'odor_elimination'
  | 'other'

export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  wash:              'Wash',
  wax:               'Wax',
  polish:            'Polish / Compound',
  ceramic:           'Ceramic Coating',
  interior:          'Interior Care',
  protection:        'Paint Protection',
  odor_elimination:  'Odor Elimination',
  other:             'Other',
}

export const PRODUCT_CATEGORIES = Object.keys(PRODUCT_CATEGORY_LABELS) as ProductCategory[]

// ─── Models ───────────────────────────────────────────────────────────────────

export interface GlobalProduct {
  id: string
  barcode: string | null
  name: string
  brand: string | null
  container_size: string | null
  default_cost_cents: number | null
  default_uses_per_container: number | null
  category: string | null
  confirmed_count: number
  created_at: string
}

export interface InventoryProduct {
  id: string
  user_id: string
  global_product_id: string | null
  name: string
  brand: string | null
  container_size: string | null
  cost_cents: number
  total_uses: number
  uses_remaining: number
  low_stock_threshold: number
  category: string | null
  created_at: string
  updated_at: string
}

export interface ServiceProduct {
  id: string
  user_id: string
  service_name: string
  product_inventory_id: string
  quantity_used: number
  product?: InventoryProduct
}

export interface UsageLogEntry {
  id: string
  job_id: string | null
  service_name: string | null
  quantity_used: number
  cost_cents_attributed: number
  logged_at: string
}

// ─── API response shapes ──────────────────────────────────────────────────────

export interface InventoryResponse {
  products: InventoryProduct[]
  low_stock_count: number
}

export interface LowStockResponse {
  count: number
}

export interface GlobalLookupResponse {
  hit: boolean
  product: GlobalProduct | null
}
