// SERVER ONLY. Loads a shop's tax settings for the API routes that price documents.
//
// Split from lib/tax.ts so that module stays pure and importable from client
// components; this one takes a Supabase client.

import type { SupabaseClient } from '@supabase/supabase-js'
import { taxSettingsFrom, TAX_SETTINGS_SELECT, type TaxSettings } from '@/lib/tax'

function isMissingTaxSettingsColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const m = String((error as { message?: unknown }).message ?? '').toLowerCase()
  const missing =
    m.includes('does not exist') || m.includes('could not find') || m.includes('schema cache')
  return missing && ['tax_parts', 'tax_labor', 'tax_rate_parts', 'tax_rate_labor'].some(c => m.includes(c))
}

/**
 * Read the shop's parts/labor tax settings.
 *
 * Falls back to default_tax_percent with labor taxed when migration 140 has not been
 * applied yet -- which is what every document did before the split existed. It never
 * falls back to a 0% rate or to "labor exempt": guessing exempt would under-collect,
 * and under-collected sales tax is money the shop owes out of its own pocket, where
 * over-collected tax is a refund. Wrong in the recoverable direction, deliberately.
 */
export async function loadTaxSettings(
  supabase: SupabaseClient,
  userId:   string,
): Promise<TaxSettings> {
  let { data, error } = await supabase
    .from('profiles')
    .select(TAX_SETTINGS_SELECT)
    .eq('id', userId)
    .single()

  if (error && isMissingTaxSettingsColumn(error)) {
    ;({ data, error } = await supabase
      .from('profiles')
      .select('default_tax_percent')
      .eq('id', userId)
      .single())
  }

  if (error) {
    console.error('[loadTaxSettings]', error)
    // An empty object resolves to "labor taxed at 0%", which is wrong in the same
    // recoverable direction rather than silently exempting labor.
    return taxSettingsFrom(null)
  }

  return taxSettingsFrom(data)
}
