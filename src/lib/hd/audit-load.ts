// Reads what the audit exports need beyond the equipment rollup, for ONE account.
//
// Same two layers of scoping as equipment-rollup-load.ts: the caller passes the
// SIGNED-IN user's Supabase client so RLS applies, AND every query filters on user_id
// (hd_work_order_line_items has no user_id - it is read only for work order ids that
// were themselves read under user_id, and its RLS reaches through the parent).
//
// MIGRATIONS ARE APPLIED BY HAND, so a column this file names may not exist yet on the
// database. A select naming a missing column fails whole, so each read lists the
// columns later migrations added as OPTIONAL: when the database says one does not
// exist, it is dropped, the read retried, and the column reported back so the packet
// cover can say which fields print "Not recorded" for that reason. Core columns are
// never dropped - if one of those is missing the export fails loudly instead.
//
// Preview and production share ONE database, so what is applied there is what both
// deployments read.

import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js'
import { fetchAllRowsForIds } from '@/lib/fleet-pro/fetch-scoped'
import { SHOP_BLOCK_SELECT, SHOP_ADDRESS_SELECT_143, shopBlockFrom, type ShopSource } from '@/lib/invoice-document'
import { shopTimeZone } from '@/lib/shop-time'
import { isImportedHistory, localDate, type RollupInput } from './equipment-rollup'
import { resolveAuditLabels, isMissingLabelsColumn, type AuditLabels } from './audit-labels'
import type { ShopHeader } from './audit-schedule'
import type { PacketInput, PacketWorkOrderRow, PacketQuoteRow, PacketInvoiceRow, PacketWoLineRow } from './audit-packet'

// ─── The shop ───────────────────────────────────────────────────────────────

export interface ShopContext {
  shop: ShopHeader
  timeZone: string
  labels: AuditLabels
  /** False until migration 162 adds profiles.hd_report_labels. */
  labelsAvailable: boolean
}

export async function loadShopContext(supabase: SupabaseClient, userId: string): Promise<ShopContext> {
  // The 143 street columns are tried and dropped, as on the invoice print copy.
  let profile: (ShopSource & { business_name?: string | null; full_name?: string | null }) | null = null
  {
    const full = await supabase.from('profiles').select(`${SHOP_BLOCK_SELECT}, ${SHOP_ADDRESS_SELECT_143}`).eq('id', userId).maybeSingle()
    if (!full.error) profile = full.data
    else {
      const basic = await supabase.from('profiles').select(SHOP_BLOCK_SELECT).eq('id', userId).maybeSingle()
      if (basic.error) throw new Error(basic.error.message)
      profile = basic.data
    }
  }

  // Labels in their own read so a missing column costs only the labels.
  let labels = resolveAuditLabels(null)
  let labelsAvailable = true
  const lab = await supabase.from('profiles').select('hd_report_labels').eq('id', userId).maybeSingle()
  if (lab.error) {
    if (!isMissingLabelsColumn(lab.error)) throw new Error(lab.error.message)
    labelsAvailable = false
  } else {
    labels = resolveAuditLabels((lab.data as { hd_report_labels?: unknown } | null)?.hd_report_labels ?? null)
  }

  // A legal name is what the profile records. resolveBranding's "Your Technician"
  // placeholder is right on a customer's invoice and wrong on an insurance document.
  const name = profile?.business_name?.trim() || profile?.full_name?.trim() || 'Shop name not recorded'
  return {
    shop: { name, addressLines: shopBlockFrom(profile).addressLines },
    timeZone: shopTimeZone(profile?.state ?? null),
    labels,
    labelsAvailable,
  }
}

// ─── Resilient column selection ─────────────────────────────────────────────

function mentions(message: string, col: string): boolean {
  return new RegExp(`(^|[^a-z0-9_])${col}([^a-z0-9_]|$)`, 'i').test(message)
}

/**
 * Run `read(columns)`; when it fails because an OPTIONAL column does not exist, drop
 * that column and try again. Anything else - including a missing core column - throws.
 */
export async function readWithOptionalColumns<T>(
  core: string[],
  optional: string[],
  read: (select: string) => Promise<T[]>,
  missing: Set<string>,
  label: string,
): Promise<T[]> {
  let opt = optional.filter(c => !missing.has(`${label}.${c}`))
  for (let attempt = 0; attempt <= optional.length; attempt++) {
    try {
      return await read([...core, ...opt].join(', '))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const looksMissing = /does not exist|could not find|schema cache/i.test(message)
      const culprit = looksMissing ? opt.find(c => mentions(message, c)) : undefined
      if (!culprit) throw err
      missing.add(`${label}.${culprit}`)
      opt = opt.filter(c => c !== culprit)
    }
  }
  throw new Error(`${label}: could not read after dropping optional columns`)
}

// ─── The packet ─────────────────────────────────────────────────────────────

const WO_CORE = [
  'id', 'user_id', 'work_order_number', 'status', 'service_type', 'created_at', 'completed_at',
  'unit_id', 'fleet_account_id', 'customer_name', 'unit_manufacturer', 'unit_model', 'unit_serial',
  'tech_name', 'labor_rate',
]
const WO_OPTIONAL = [
  'unit_number',                                                      // 142
  'unit_year', 'truck_make', 'truck_model', 'truck_year', 'vin',      // 159
  'quote_id', 'authorized_at', 'authorization_method', 'customer_po_number', // 153
]
const QUOTE_CORE = [
  'id', 'user_id', 'quote_number', 'status', 'created_at', 'line_items', 'labor_rate',
  'subtotal_labor', 'subtotal_parts', 'diagnostic_fee', 'road_call_fee', 'tax_amount', 'total',
]
const QUOTE_OPTIONAL = [
  'travel_amount', 'mileage_amount', 'shop_supplies_fee',                     // 142
  'approved_at', 'approval_method', 'customer_response_note', 'customer_po_number', // 153
]
const INVOICE_CORE = ['id', 'user_id', 'invoice_number', 'work_order_id', 'status', 'created_at', 'total', 'line_items', 'labor_rate']
const INVOICE_OPTIONAL = ['tech_name'] // 160
// SELL side only. unit_cost on this table is the shop's COST and is not read.
const WO_LINE_COLS = 'id, work_order_id, type, description, part_number, quantity, unit_price, total, sort_order'

const DEAD_WO = new Set(['cancelled', 'canceled', 'void'])
type Page<T> = PromiseLike<{ data: T[] | null; error: PostgrestError | null }>

export async function loadPacketInput(supabase: SupabaseClient, rollup: RollupInput): Promise<PacketInput> {
  const userId = rollup.userId
  const missing = new Set<string>()

  // The population, decided on the rollup's own work order rows so it is exactly the
  // set workOrdersMissingAuthorization checks.
  const inRange = rollup.workOrders.filter(w => {
    if (w.user_id !== userId) return false
    const d = localDate(w.created_at, rollup.timeZone)
    return d != null && d >= rollup.range.from && d <= rollup.range.to
  })
  const excluded = inRange.filter(w => DEAD_WO.has(String(w.status ?? '').toLowerCase()) || isImportedHistory(w))
  const wanted = inRange.filter(w => !excluded.includes(w)).map(w => w.id)

  const details = await readWithOptionalColumns<PacketWorkOrderRow>(WO_CORE, WO_OPTIONAL, select =>
    fetchAllRowsForIds<PacketWorkOrderRow, string>(wanted, (ids, from, to) => supabase
      .from('hd_work_orders').select(select)
      .eq('user_id', userId).in('id', ids).order('id').range(from, to) as unknown as Page<PacketWorkOrderRow>),
    missing, 'hd_work_orders')

  // Excluded rows only need to be counted; they travel as the rollup read them.
  const workOrders: PacketWorkOrderRow[] = [
    ...details,
    ...excluded.map(w => ({ id: w.id, user_id: w.user_id, work_order_number: w.work_order_number, status: w.status, service_type: w.service_type, created_at: w.created_at })),
  ]

  const quoteIds = [...new Set(details.map(w => w.quote_id).filter((x): x is string => !!x))]
  const [quotes, invoices, workOrderLines] = await Promise.all([
    readWithOptionalColumns<PacketQuoteRow>(QUOTE_CORE, QUOTE_OPTIONAL, select =>
      fetchAllRowsForIds<PacketQuoteRow, string>(quoteIds, (ids, from, to) => supabase
        .from('hd_quotes').select(select)
        .eq('user_id', userId).in('id', ids).order('id').range(from, to) as unknown as Page<PacketQuoteRow>),
      missing, 'hd_quotes'),
    readWithOptionalColumns<PacketInvoiceRow>(INVOICE_CORE, INVOICE_OPTIONAL, select =>
      fetchAllRowsForIds<PacketInvoiceRow, string>(wanted, (ids, from, to) => supabase
        .from('hd_invoices').select(select)
        .eq('user_id', userId).in('work_order_id', ids).order('id').range(from, to) as unknown as Page<PacketInvoiceRow>),
      missing, 'hd_invoices'),
    fetchAllRowsForIds<PacketWoLineRow, string>(wanted, (ids, from, to) => supabase
      .from('hd_work_order_line_items').select(WO_LINE_COLS)
      .in('work_order_id', ids).order('id').range(from, to) as unknown as Page<PacketWoLineRow>),
  ])

  return { rollup, workOrders, quotes, invoices, workOrderLines, missingColumns: [...missing].sort() }
}
