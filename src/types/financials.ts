// ─── Enums ────────────────────────────────────────────────────────────────────

export type QuoteStatus =
  | 'draft'
  | 'sent'
  | 'approved'
  | 'declined'
  | 'converted'
  | 'expired'

export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'paid'
  | 'overdue'
  | 'cancelled'

// Phase 3+ invoice lifecycle (replaces InvoiceStatus for quote-converted invoices)
export type InvoiceProgressStatus =
  | 'in_progress'
  | 'finalized'
  | 'awaiting_payment'
  | 'paid'
  | 'void'

export type PaymentMethod =
  | 'cash'
  | 'card'
  | 'check'
  | 'venmo'
  | 'zelle'
  | 'paypal'
  | 'other'

export type ExpenseCategory =
  | 'parts'
  | 'tools'
  | 'fuel'
  | 'insurance'
  | 'licensing'
  | 'marketing'
  | 'software'
  | 'training'
  | 'vehicle_maintenance'
  | 'office_supplies'
  | 'subcontractor'
  | 'other'

// ─── Core models ──────────────────────────────────────────────────────────────

export interface LineItem {
  description: string
  quantity: number
  unit_price: number
  total: number
}

// Phase 3: items added during the job (stored as JSONB arrays on the invoice)
export interface ShopSupplyItem {
  id: string
  name: string
  qty: number
  unit_cost: number
  total: number
}

export interface AdditionalPartItem {
  id: string
  description: string
  qty: number
  unit_cost: number
  total: number  // after markup
}

export interface AdditionalLaborItem {
  id: string
  description: string
  hours: number
  rate: number
  subtotal: number
}

export interface Invoice {
  id: string
  user_id: string
  job_id: string | null
  customer_id: string | null
  vehicle_id: string | null
  invoice_number: string
  invoice_date: string         // YYYY-MM-DD
  due_date: string | null
  line_items: LineItem[]
  subtotal: number
  tax_rate: number
  tax_amount: number
  discount_amount: number
  total: number
  status: InvoiceStatus
  payment_method: PaymentMethod | null
  paid_at: string | null
  source: 'manual' | 'quickwrench' | 'quote' | null
  job_category: string | null
  job_subtype: string | null
  notes: string | null
  terms: string | null
  created_at: string
  updated_at: string
  // Phase 3 fields
  invoice_status: InvoiceProgressStatus | null
  source_quote_id: string | null
  job_notes: string | null
  shop_supplies: ShopSupplyItem[]
  additional_parts: AdditionalPartItem[]
  additional_labor: AdditionalLaborItem[]
  started_at: string | null
  // Joined relations
  customer?: {
    id: string
    first_name: string
    last_name: string
    phone: string | null
    email: string | null
  } | null
  vehicle?: {
    id: string
    year: number | null
    make: string
    model: string
    vin: string | null
  } | null
  source_quote?: {
    id: string
    quote_number: string
    line_items: LineItem[]
    labor_hours: number | null
    labor_rate: number | null
    parts_subtotal: number | null
    parts_markup_percent: number | null
    labor_subtotal: number | null
    tax_percent: number | null
    tax_amount: number | null
    grand_total: number | null
  } | null
}

export interface Quote {
  id: string
  user_id: string
  quote_number: string
  status: QuoteStatus
  customer_id: string | null
  vehicle_id: string | null
  job_category: string | null
  job_subtype: string | null
  line_items: LineItem[]
  labor_hours: number | null
  labor_rate: number | null
  parts_subtotal: number | null
  parts_markup_percent: number | null
  labor_subtotal: number | null
  tax_percent: number | null
  tax_amount: number | null
  grand_total: number | null
  notes: string | null
  source: string | null
  parent_quote_id: string | null
  converted_invoice_id: string | null
  // Phase 2 — send workflow + approval tracking
  public_token: string | null
  sent_to_phone: string | null
  sent_to_email: string | null
  customer_response_note: string | null
  viewed_at: string | null
  view_count: number
  times_sent: number
  quote_expires_at: string | null
  sent_at: string | null
  approved_at: string | null
  declined_at: string | null
  converted_at: string | null
  created_at: string
  updated_at: string
  customer?: {
    id: string
    first_name: string
    last_name: string
    phone: string | null
    email: string | null
  } | null
  vehicle?: {
    id: string
    year: number | null
    make: string
    model: string
    vin: string | null
  } | null
}

export interface Expense {
  id: string
  user_id: string
  expense_date: string         // YYYY-MM-DD
  category: ExpenseCategory
  description: string
  amount: number
  receipt_url: string | null
  vendor: string | null
  job_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface FinancialsOverview {
  period: string               // YYYY-MM
  revenue_total: number
  expense_total: number
  net_profit: number
  profit_margin: number
  avg_job_value: number
  top_service: string | null
  invoice_count: number
  paid_invoice_count: number
  overdue_invoice_count: number
}

// ─── Payloads ─────────────────────────────────────────────────────────────────

export interface CreateInvoicePayload {
  invoice_number: string
  invoice_date?: string
  due_date?: string | null
  customer_id?: string | null
  job_id?: string | null
  line_items: LineItem[]
  subtotal: number
  tax_rate?: number
  tax_amount?: number
  discount_amount?: number
  total: number
  status?: InvoiceStatus
  notes?: string | null
  terms?: string | null
}

export interface UpdateInvoiceStatusPayload {
  status: 'paid' | 'unpaid' | 'overdue'
  payment_method?: PaymentMethod | null
}

export interface CreateExpensePayload {
  expense_date: string
  category: ExpenseCategory
  description: string
  amount: number
  vendor?: string | null
  receipt_url?: string | null
  job_id?: string | null
  notes?: string | null
}

// ─── API response shapes ──────────────────────────────────────────────────────

export interface InvoicesResponse {
  invoices: Invoice[]
}

export interface InvoiceResponse {
  invoice: Invoice
}

export interface ExpensesResponse {
  expenses: Expense[]
}

export interface ExpenseResponse {
  expense: Expense
}

export interface OverviewResponse {
  overview: FinancialsOverview
}

export interface QuotesResponse {
  quotes: Quote[]
}

export interface QuoteResponse {
  quote: Quote
}

export interface ApiError {
  error: string
}
