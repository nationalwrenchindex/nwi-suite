// SERVER ONLY. A shop's LD document defaults (lib/document-defaults), for the routes and
// server pages that start a document. Takes a Supabase client.
//
// Read in groups, each tolerating its own missing migration, because migrations are
// applied by hand and a select naming one absent column fails the whole query - which
// would take the labour rate down with the extras.

import type { SupabaseClient } from '@supabase/supabase-js'
import { documentDefaultsFrom, type DocumentDefaults } from '@/lib/document-defaults'
import { TAX_SETTINGS_SELECT } from '@/lib/tax'
import { EXTRAS_SETTINGS_SELECT } from '@/lib/billable-extras'
import { LD_SERVICE_CALL_SELECT } from '@/lib/service-call'

const BASE = 'default_labor_rate, default_parts_markup_percent, default_tax_percent'

export async function loadDocumentDefaults(supabase: SupabaseClient, userId: string): Promise<DocumentDefaults> {
  const read = async (cols: string) => {
    const { data, error } = await supabase.from('profiles').select(cols).eq('id', userId).maybeSingle()
    return error ? null : (data as Record<string, unknown> | null)
  }
  const [base, tax, extras, call] = await Promise.all([
    read(BASE), read(TAX_SETTINGS_SELECT), read(EXTRAS_SETTINGS_SELECT), read(LD_SERVICE_CALL_SELECT),
  ])
  // Pre-140 there are no split columns: the legacy single rate, labour taxed.
  const taxRow = tax ?? (await read('default_tax_percent'))
  return documentDefaultsFrom({ ...(base ?? {}), ...(taxRow ?? {}), ...(extras ?? {}), ...(call ?? {}) })
}
