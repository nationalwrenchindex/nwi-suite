// GET  /api/user/profile — returns fuel-tracking, MPI, and pricing default profile fields
// PUT  /api/user/profile — updates average_mpg, fuel_type, offer_mpi_on_booking, and/or pricing defaults

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { missingMigration142Column } from '@/lib/migration-142'
import { taxSettingsFrom } from '@/lib/tax'
import { extrasSettingsFrom } from '@/lib/billable-extras'

// Columns that exist on every deployment.
const BASE_COLUMNS = 'average_mpg, fuel_type, offer_mpi_on_booking, default_labor_rate, default_parts_markup_percent, default_tax_percent'

// Added by migration 140. Same hand-applied-migration problem as the markup column
// below: this endpoint prefills every tax field in both products, so it has to keep
// working in the window between the code deploying and the ALTER TABLE running.
const TAX_COLUMNS = 'tax_parts, tax_labor, tax_rate_parts, tax_rate_labor'

// Added by migration 142. Every form that prices a document reads these, so the
// same hand-applied-migration window applies.
const EXTRAS_COLUMNS =
  'bill_travel, travel_rate_per_hour, bill_mileage, mileage_rate_per_mile, ' +
  'bill_shop_supplies, shop_supplies_percent, shop_supplies_cap'

// True when the error is "this database has not run migration 121 yet". Migrations
// here are applied by hand in the Supabase console, so a deploy can land before the
// ALTER TABLE does. Selecting a column that does not exist fails the WHOLE query,
// which would take the tax rate and the labor rate down with the markup — and this
// endpoint prefills every HD and LD form. Mirrors isMissingCostingColumn() in
// src/lib/hd/invoice-costing.ts, which exists for exactly this window.
function isMissingColumn(error: unknown, names: string[]): boolean {
  if (!error || typeof error !== 'object') return false
  const message = String((error as { message?: unknown }).message ?? '').toLowerCase()
  const isMissing =
    message.includes('does not exist') || message.includes('could not find') || message.includes('schema cache')
  return isMissing && names.some(n => message.includes(n))
}

function isMissingHdMarkupColumn(error: unknown): boolean {
  return isMissingColumn(error, ['hd_parts_markup_percent'])
}

function isMissingTaxColumn(error: unknown): boolean {
  return isMissingColumn(error, ['tax_parts', 'tax_labor', 'tax_rate_parts', 'tax_rate_labor'])
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let { data, error } = await supabase
    .from('profiles')
    .select(`${BASE_COLUMNS}, hd_parts_markup_percent, ${TAX_COLUMNS}, ${EXTRAS_COLUMNS}`)
    .eq('id', user.id)
    .single()

  // Pre-migration fallbacks, narrowest first. Selecting a column that does not exist
  // fails the WHOLE query, which would take the labor rate and the markup down with
  // it — and this endpoint prefills every HD and LD form.
  if (error && missingMigration142Column(error)) {
    ({ data, error } = await supabase
      .from('profiles')
      .select(`${BASE_COLUMNS}, hd_parts_markup_percent, ${TAX_COLUMNS}`)
      .eq('id', user.id)
      .single())
  }
  if (error && isMissingTaxColumn(error)) {
    ({ data, error } = await supabase
      .from('profiles')
      .select(`${BASE_COLUMNS}, hd_parts_markup_percent`)
      .eq('id', user.id)
      .single())
  }
  if (error && isMissingHdMarkupColumn(error)) {
    ({ data, error } = await supabase
      .from('profiles')
      .select(BASE_COLUMNS)
      .eq('id', user.id)
      .single())
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    average_mpg:                   data?.average_mpg                   ?? null,
    fuel_type:                     data?.fuel_type                     ?? 'gasoline',
    offer_mpi_on_booking:          data?.offer_mpi_on_booking          ?? false,
    default_labor_rate:            data?.default_labor_rate            ?? 125,
    default_parts_markup_percent:  data?.default_parts_markup_percent  ?? 20,
    // Two markups, not one. default_parts_markup_percent is the LD number (LD bills
    // from it and LD Settings writes it); hd_parts_markup_percent is HD's own, added
    // by migration 121. They are returned side by side rather than merged because a
    // subscriber who sets 15% on light-duty brake pads has not thereby said anything
    // about heavy-duty reefer parts. NULL = never set, so fall back to 30 — the HD
    // brief's number and DEFAULT_HD_PARTS_MARKUP in src/lib/hd/parts-pricing.ts.
    hd_parts_markup_percent:       data?.hd_parts_markup_percent       ?? 30,
    default_tax_percent:           data?.default_tax_percent           ?? 8.5,
    // Resolved through the shared helper so the pre-140 fallback is defined in ONE
    // place: no tax columns means labor stays taxed at default_tax_percent, which is
    // what the code did before the split existed. Falling back to 'not taxed' would
    // under-collect, and under-collected tax is money the shop owes itself.
    ...taxSettingsFrom(data),
    // Billable extras. All off when 142 has not been applied, which is the correct
    // reading: a shop that has never set these bills none of them.
    ...extrasSettingsFrom(data as Record<string, unknown> | null),
  })
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = {}

  if ('average_mpg' in body) {
    const raw = body.average_mpg
    if (raw === null || raw === '') {
      update.average_mpg = null
    } else {
      const n = Number(raw)
      if (isNaN(n) || n <= 0 || n > 200) {
        return NextResponse.json({ error: 'average_mpg must be a positive number ≤ 200' }, { status: 400 })
      }
      update.average_mpg = Math.round(n * 100) / 100
    }
  }

  if ('fuel_type' in body) {
    const ft = String(body.fuel_type ?? 'gasoline')
    if (!['gasoline', 'diesel'].includes(ft)) {
      return NextResponse.json({ error: 'fuel_type must be gasoline or diesel' }, { status: 400 })
    }
    update.fuel_type = ft
  }

  if ('offer_mpi_on_booking' in body) {
    update.offer_mpi_on_booking = !!body.offer_mpi_on_booking
  }

  if ('default_labor_rate' in body) {
    const n = Number(body.default_labor_rate)
    if (isNaN(n) || n < 0 || n > 9999) {
      return NextResponse.json({ error: 'default_labor_rate must be 0–9999' }, { status: 400 })
    }
    update.default_labor_rate = Math.round(n * 100) / 100
  }

  if ('default_parts_markup_percent' in body) {
    const n = Number(body.default_parts_markup_percent)
    if (isNaN(n) || n < 0 || n > 999) {
      return NextResponse.json({ error: 'default_parts_markup_percent must be 0–999' }, { status: 400 })
    }
    update.default_parts_markup_percent = Math.round(n * 100) / 100
  }

  // HD's own markup (migration 121). Capped at 99 rather than the LD column's 999:
  // this one is a percentage a tech types into a form, and a fat-fingered 300 would
  // quadruple a $900 turbo without anything on screen looking obviously wrong.
  // Writing this key never touches default_parts_markup_percent — that column is
  // what LD bills from, and moving it would silently reprice live LD quotes.
  // No pre-migration fallback on the write side, deliberately: GET degrades to the
  // 30 default because a form still has to render, but a save that cannot persist
  // must fail loudly rather than return ok and quietly discard the tech's number.
  if ('hd_parts_markup_percent' in body) {
    const n = Number(body.hd_parts_markup_percent)
    if (isNaN(n) || n < 0 || n > 99) {
      return NextResponse.json({ error: 'hd_parts_markup_percent must be 0–99' }, { status: 400 })
    }
    update.hd_parts_markup_percent = Math.round(n * 100) / 100
  }

  if ('default_tax_percent' in body) {
    const n = Number(body.default_tax_percent)
    if (isNaN(n) || n < 0 || n > 99) {
      return NextResponse.json({ error: 'default_tax_percent must be 0–99' }, { status: 400 })
    }
    update.default_tax_percent = Math.round(n * 100) / 100
  }

  // ── Billable extras (migration 142) ──
  // The three on/off switches.
  for (const flag of ['bill_travel', 'bill_mileage', 'bill_shop_supplies'] as const) {
    if (flag in body) {
      if (typeof body[flag] !== 'boolean') {
        return NextResponse.json({ error: `${flag} must be true or false` }, { status: 400 })
      }
      update[flag] = body[flag]
    }
  }

  // The rates. NULL IS A MEANINGFUL VALUE and must survive:
  //   travel_rate_per_hour  NULL = bill travel at the labour rate, 0 = travel is free
  //   shop_supplies_cap     NULL = uncapped, 0 = capped at nothing
  // Coercing either to 0 would silently change what a shop charges.
  const EXTRA_RATES: Array<[string, number, number]> = [
    ['travel_rate_per_hour',  0, 9999],
    ['mileage_rate_per_mile', 0, 99],
    ['shop_supplies_percent', 0, 100],
    ['shop_supplies_cap',     0, 99999],
  ]
  for (const [key, min, max] of EXTRA_RATES) {
    if (!(key in body)) continue
    const raw = body[key]
    if (raw === null || raw === undefined || raw === '') {
      update[key] = null
      continue
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < min || n > max) {
      return NextResponse.json({ error: `${key} must be ${min}–${max}, or null` }, { status: 400 })
    }
    // mileage_rate_per_mile is NUMERIC(10,4) — rates are quoted to the tenth of a cent.
    update[key] = key === 'mileage_rate_per_mile'
      ? Math.round(n * 10000) / 10000
      : Math.round(n * 1000) / 1000
  }

  // ── Tax split (migration 140) ──
  for (const flag of ['tax_parts', 'tax_labor'] as const) {
    if (flag in body) {
      if (typeof body[flag] !== 'boolean') {
        return NextResponse.json({ error: `${flag} must be true or false` }, { status: 400 })
      }
      update[flag] = body[flag]
    }
  }
  for (const rate of ['tax_rate_parts', 'tax_rate_labor'] as const) {
    if (rate in body) {
      const n = Number(body[rate])
      if (isNaN(n) || n < 0 || n > 99) {
        return NextResponse.json({ error: `${rate} must be 0–99` }, { status: 400 })
      }
      update[rate] = Math.round(n * 100) / 100
    }
  }

  if ('phone' in body) {
    const raw = body.phone
    update.phone = (typeof raw === 'string' && raw.trim()) ? raw.trim() : null
  }

  // Published to the mechanic's nationalwrenchindex.com directory listing.
  if ('city' in body) {
    const raw = body.city
    update.city = (typeof raw === 'string' && raw.trim()) ? raw.trim() : null
  }

  if ('state' in body) {
    const raw = typeof body.state === 'string' ? body.state.trim().toUpperCase() : ''
    if (raw && !/^[A-Z]{2}$/.test(raw)) {
      return NextResponse.json({ error: 'state must be a 2-letter code' }, { status: 400 })
    }
    update.state = raw || null
  }

  if ('sms_booking_notifications_enabled' in body) {
    update.sms_booking_notifications_enabled = !!body.sms_booking_notifications_enabled
  }

  if ('work_orders_enabled' in body) {
    update.work_orders_enabled = !!body.work_orders_enabled
  }

  if ('bill_consumables_separately' in body) {
    update.bill_consumables_separately = !!body.bill_consumables_separately
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { error } = await supabase.from('profiles').update(update).eq('id', user.id)
  if (error) {
    // NO SILENT FALLBACK ON A SETTINGS WRITE, matching the hd_parts_markup_percent
    // note above: a save that returns ok while discarding the number the shop just
    // typed is how a shop ends up billing a rate it believes it changed. But the
    // message has to say what to do, not just "column does not exist".
    const missing = missingMigration142Column(error)
    if (missing) {
      return NextResponse.json({
        error: `Travel, mileage and shop supplies need migration 142 applied first (missing: ${missing}). Your other pricing defaults were not saved either — nothing was changed.`,
      }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
