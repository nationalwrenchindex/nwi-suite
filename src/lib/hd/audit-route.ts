// The part both audit export routes share: who is asking, may they, which period, and
// the shop's own name, address, time zone and labels.
//
// 401 when signed out, 403 without HD Starter-or-above access (the same gate as
// /hd/financials), 400 for a bad period. Everything after this point reads with the
// signed-in client, so RLS and an explicit user_id filter both apply.

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import { ensureEquipmentCategories } from './equipment-categories'
import { loadRollupInput } from './equipment-rollup-load'
import { localDate, type RollupInput } from './equipment-rollup'
import { parseRange } from './audit-csv'
import { loadShopContext, type ShopContext } from './audit-load'

export type AuditFormat = 'pdf' | 'csv'

export type AuditRequest =
  | { ok: false; response: NextResponse }
  | { ok: true; supabase: SupabaseClient; userId: string; format: AuditFormat; ctx: ShopContext; rollup: RollupInput }

const text = (status: number, msg: string) =>
  new NextResponse(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' } })

export async function prepareAuditRequest(url: URL): Promise<AuditRequest> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: text(401, 'Unauthorized') }
  if (!(await checkHDStarterAccess(user.id))) return { ok: false, response: text(403, 'HD Starter or above required') }

  const fmt = (url.searchParams.get('format') ?? 'pdf').toLowerCase()
  if (fmt !== 'pdf' && fmt !== 'csv') return { ok: false, response: text(400, 'format must be pdf or csv') }

  let ctx: ShopContext
  try {
    ctx = await loadShopContext(supabase, user.id)
  } catch (err) {
    console.error('[hd audit] shop read failed:', err instanceof Error ? err.message : err)
    return { ok: false, response: text(500, 'Could not read the shop profile') }
  }

  const today = localDate(new Date().toISOString(), ctx.timeZone)!
  const range = parseRange(url.searchParams.get('from'), url.searchParams.get('to'), today)
  if (!range.ok) return { ok: false, response: text(400, range.error) }

  // Categories are seeded on first access, the same way every HD screen does it.
  await ensureEquipmentCategories(supabase)
  let rollup: RollupInput
  try {
    rollup = await loadRollupInput(supabase, user.id, { from: range.from, to: range.to }, ctx.timeZone)
  } catch (err) {
    console.error('[hd audit] rollup read failed:', err instanceof Error ? err.message : err)
    return { ok: false, response: text(500, 'Could not read work orders and invoices for this period') }
  }

  return { ok: true, supabase, userId: user.id, format: fmt, ctx, rollup }
}

export function fileResponse(body: Uint8Array | string, format: AuditFormat, filename: string): NextResponse {
  if (format === 'csv') {
    // BOM so Excel reads accented customer names as UTF-8, the house CSV convention.
    const csv = '﻿' + (body as string)
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  }
  const bytes = body as Uint8Array
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store',
    },
  })
}

export { text as textResponse }
