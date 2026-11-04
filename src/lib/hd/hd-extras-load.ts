// Server-side read of the shop's HD extras settings, labor rate and tax settings.
//
// Reads migration 178's HD columns, and LD's 142 columns beside them for a database
// without 178 - so the HD screens bill exactly what they billed before it until it
// is applied. `available` says whether 178 is there.

import type { SupabaseClient } from '@supabase/supabase-js'
import { TAX_SETTINGS_SELECT, taxSettingsFrom } from '@/lib/tax'
import { HD_EXTRAS_SELECT, LD_EXTRAS_SELECT, hdExtrasSettingsFrom, hdServiceCallFrom } from '@/lib/hd/hd-extras'
import type { ShopExtras } from '@/lib/hd/work-order-extras'
import { hdLaborRateFrom } from '@/lib/hd/labor-rate'

function isMissingColumn(error: unknown): boolean {
  const e = (error ?? {}) as { code?: string }
  return e.code === '42703' || e.code === 'PGRST204'
}

export async function loadHdShopExtras(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ shop: ShopExtras; available: boolean; profile: Record<string, unknown> }> {
  const base = `hd_labor_rate, ${TAX_SETTINGS_SELECT}, ${LD_EXTRAS_SELECT}`
  let res = await supabase.from('profiles').select(`${base}, ${HD_EXTRAS_SELECT}`).eq('id', userId).maybeSingle()
  let available = true
  if (res.error && isMissingColumn(res.error)) {
    available = false
    res = await supabase.from('profiles').select(base).eq('id', userId).maybeSingle()
  }
  const p = (res.data ?? {}) as Record<string, unknown>
  // HD's own rate only (hdLaborRateFrom) - LD's default_labor_rate never stands in.
  const laborRate = hdLaborRateFrom(p)
  return {
    available,
    profile: p,
    shop: {
      extras: hdExtrasSettingsFrom(p),
      serviceCall: hdServiceCallFrom(p),
      laborRate,
      taxSettings: taxSettingsFrom(p),
    },
  }
}
