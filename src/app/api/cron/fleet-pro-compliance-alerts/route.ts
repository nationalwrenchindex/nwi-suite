// GET /api/cron/fleet-pro-compliance-alerts
//
// Nightly DOT & compliance digest. One email per fleet listing every deadline that is
// expired, has no date on file, or is inside that item type's alert window — plus one
// SMS to the fleet's contact number. Gated by CRON_SECRET through authorizeCron, which
// fails CLOSED when the secret is unset.
//
// Modelled on /api/cron/fleet-pro-pm-alerts, which does almost exactly this for PM.
// Two differences, both forced by the subject matter:
//
//   1. PM has one row per unit carrying its own alert_sent_for stamp. A compliance
//      digest is a SET assembled from five tables plus the federal calendar, and most
//      of its items have no row to stamp (an IFTA quarter end is not stored anywhere).
//      So the dedupe stamp is a FINGERPRINT of the reported set, kept on the fleet's
//      one carrier-level row. Nothing changed -> nothing sent.
//   2. The item list is not re-derived here. It comes from buildComplianceCalendar,
//      the same function GET /api/fleet-pro/compliance renders, so the email can never
//      disagree with the screen.

import { NextResponse, type NextRequest } from 'next/server'
import crypto from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { authorizeCron } from '@/lib/cron-auth'
import { sendSmsResult } from '@/lib/twilio'
import {
  sendComplianceDigestEmail,
  buildComplianceDigestSms,
  type ComplianceAlertItem,
} from '@/lib/fleet-pro/compliance-alert-email'
import { complianceNeedsAlert, todayIso } from '@/lib/fleet-pro/compliance'
import { buildComplianceCalendar } from '@/app/api/fleet-pro/compliance/calendar'

export const dynamic = 'force-dynamic'

const LIVE_FLEET_STATUSES = ['active', 'trialing', 'past_due']

/**
 * Re-send an unchanged digest after this many days. The fingerprint alone would go
 * silent forever on a fleet that never fixes anything, which is exactly the fleet that
 * needs telling. A week is often enough to stay honest and rare enough not to become
 * noise the manager filters.
 */
const RESEND_AFTER_DAYS = 7

/**
 * Fingerprint of the reported set. State and date are included, so an item that merely
 * ticks one day closer does not re-send, but one that crosses from 'upcoming' into
 * 'due_soon' — or whose date is corrected — does.
 */
function digestKey(items: ComplianceAlertItem[], keys: string[]): string {
  const canonical = items
    .map((item, index) => `${keys[index]}|${item.state}|${item.expires_on ?? ''}`)
    .sort()
    .join('\n')
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32)
}

function daysSince(iso: string | null): number {
  if (!iso) return Number.MAX_SAFE_INTEGER
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return Number.MAX_SAFE_INTEGER
  return Math.floor((Date.now() - then) / 86_400_000)
}

export async function GET(request: NextRequest) {
  const denied = authorizeCron(request)
  if (denied) return denied

  const supabase = createServiceClient()
  const today    = todayIso()

  const appUrl    = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ?? null
  const portalUrl = appUrl ? `${appUrl}/fleet-pro/compliance` : null

  // 1. Every fleet whose Fleet Pro subscription is still live. Same liveness rule the
  //    RLS helpers apply — a lapsed department stops being emailed, not just stops
  //    being able to log in.
  const { data: fleets, error: fleetErr } = await supabase
    .from('hd_fleet_accounts')
    .select('id, fleet_name, contact_phone')
    .eq('fleet_pro_enabled', true)
    .in('fleet_pro_status', LIVE_FLEET_STATUSES)

  if (fleetErr) {
    console.error('[fleet-pro-compliance-alerts] fleet load failed:', fleetErr.message)
    return NextResponse.json({ error: fleetErr.message }, { status: 500 })
  }

  let fleetsWithItems = 0
  let emailsSent      = 0
  let smsSent         = 0
  let skippedUnchanged = 0

  for (const fleet of fleets ?? []) {
    const fleetId   = fleet.id as string
    const fleetName = (fleet.fleet_name as string | null) ?? 'Your Fleet'

    // 2. The same calendar the portal renders. No signed URLs — the email links to the
    //    portal, not to the documents, and minting a URL per scan would be a storage
    //    round trip per file for nothing.
    const built = await buildComplianceCalendar(supabase, fleetId, fleetName, today, {
      withSignedUrls: false,
    })

    // 3. Narrow to what is actually worth an alert. Each item type has its own window
    //    (30 or 60 days) — see COMPLIANCE_ALERT_DAYS. Expired and missing always make
    //    the list regardless of type.
    const due = built.items.filter(i => complianceNeedsAlert(i.type, i.expires_on, today))
    if (due.length === 0) continue
    fleetsWithItems++

    const key      = digestKey(due, due.map(i => i.key))
    const unchanged = built.alertKey === key
    const stale     = daysSince(built.alertSentAt) >= RESEND_AFTER_DAYS
    if (unchanged && !stale) {
      skippedUnchanged++
      continue
    }

    // 4. Recipients: active managers and supervisors. Read-only viewers do not get
    //    operational alerts — the same rule the PM cron applies.
    const { data: members, error: memberErr } = await supabase
      .from('fleet_pro_members')
      .select('email')
      .eq('fleet_account_id', fleetId)
      .eq('status', 'active')
      .in('role', ['manager', 'supervisor'])

    if (memberErr) {
      console.error(`[fleet-pro-compliance-alerts] member load failed for ${fleetId}:`, memberErr.message)
      continue
    }

    const to = [...new Set((members ?? [])
      .map(m => (m.email as string | null)?.trim().toLowerCase())
      .filter((e): e is string => !!e))]

    if (to.length === 0) {
      // Nobody to tell. Leave the stamp alone so it sends once someone is seated.
      console.warn(`[fleet-pro-compliance-alerts] no recipients for fleet ${fleetId}`)
      continue
    }

    const result = await sendComplianceDigestEmail({ to, fleetName, items: due, portalUrl })
    if (!result.success) {
      console.error(`[fleet-pro-compliance-alerts] email failed for ${fleetId}: ${result.error}`)
      continue  // no stamp — retry tomorrow
    }
    emailsSent++

    // 5. SMS to the fleet's own contact number, best effort. Sent only when something
    //    is already expired or has no date: a text message is an interruption, and a
    //    deadline six weeks out does not earn one. The email covers the rest.
    const phone = (fleet.contact_phone as string | null)?.trim() ?? null
    const urgent = due.some(i => i.state === 'expired' || i.state === 'missing')
    if (phone && urgent) {
      const sms = await sendSmsResult({
        to:   phone,
        body: buildComplianceDigestSms({ fleetName, items: due, portalUrl }),
      })
      if (sms.success) smsSent++
      else console.error(`[fleet-pro-compliance-alerts] sms failed for ${fleetId}: ${sms.error}`)
    }

    // 6. Stamp only what was actually reported. Upsert because a fleet that has never
    //    opened the compliance settings has no carrier-level row yet, and the digest
    //    must still be de-duplicated for it.
    const now = new Date().toISOString()
    const { error: stampErr } = await supabase
      .from('fleet_pro_fleet_compliance')
      .upsert({
        fleet_account_id: fleetId,
        alert_sent_at:    now,
        alert_digest_key: key,
        updated_at:       now,
      }, { onConflict: 'fleet_account_id' })

    if (stampErr) {
      console.error(`[fleet-pro-compliance-alerts] stamp failed for ${fleetId}:`, stampErr.message)
    }
  }

  console.log(
    `[fleet-pro-compliance-alerts] done: fleets=${(fleets ?? []).length} ` +
    `withItems=${fleetsWithItems} emailsSent=${emailsSent} smsSent=${smsSent} unchanged=${skippedUnchanged}`,
  )

  return NextResponse.json({
    fleets:     (fleets ?? []).length,
    withItems:  fleetsWithItems,
    emailsSent,
    smsSent,
    skippedUnchanged,
  })
}
