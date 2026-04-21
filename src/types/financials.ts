// ─── Enums ────────────────────────────────────────────────────────────────────

export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'paid'
  | 'overdue'
  | 'cancelled'

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
  source: 'manual' | 'quickwrench' | null
  job_category: string | null
  job_subtype: string | null
  notes: string | null
  terms: string | null
  created_at: string
  updated_at: string
  // Joined relation
  customer?: {
    id: string
    first_name: string
    last_name: string
    phone: string | null
    email: string | null
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

export interface ApiError {
  error: string
}
