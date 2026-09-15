// SERVER-ONLY. The nightly DOT & compliance digest for a Fleet Pro fleet.
//
// One email per fleet, not one per deadline — a department with nine drivers and
// forty trucks can easily have twenty items inside the warning window in the same
// week, and twenty notifications is the same as none. Follows the house pattern set by
// src/lib/fleet-pro/pm-alert-email.ts: lazy Resend client, escape every interpolation,
// never throw, hand the caller { success, error? } to log.
//
// Colours come from the same table the calendar page uses, so an item that is orange
// on screen is orange in the inbox. That consistency is the point: the manager who
// opens the portal after reading this email must see the same picture.

import { Resend } from 'resend'
import {
  COMPLIANCE_COLOR,
  COMPLIANCE_STATE_LABEL,
  COMPLIANCE_STATE_RANK,
  type ComplianceState,
} from './compliance'

const FROM = 'NWI Fleet Pro <onboarding@resend.dev>'

const RED  = COMPLIANCE_COLOR.expired
const INK  = '#111827'
const GREY = '#6B7280'

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(`${s}T12:00:00`)
  return isNaN(d.getTime())
    ? String(s)
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

/** "12 days overdue" / "in 9 days" / "today" / "no date on file". */
function whenLabel(state: ComplianceState, days: number | null): string {
  if (state === 'missing' || days == null) return 'no date on file'
  if (days < 0)  return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
  if (days === 0) return 'today'
  return `in ${days} day${days === 1 ? '' : 's'}`
}

/**
 * The subset of a calendar item this email needs. Structurally satisfied by
 * ComplianceItem, so the cron passes its rows straight through with no mapping.
 */
export interface ComplianceAlertItem {
  type_label:            string
  subject:               'unit' | 'driver' | 'fleet'
  subject_label:         string
  expires_on:            string | null
  days_until_expiration: number | null
  state:                 ComplianceState
  detail:                string | null
}

const SUBJECT_HEADING: Record<ComplianceAlertItem['subject'], string> = {
  unit:   'Unit',
  driver: 'Driver',
  fleet:  'Carrier',
}

/**
 * Send the compliance digest. `to` is the fleet's managers and supervisors — read-only
 * viewers are not sent operational alerts, the same rule the PM cron applies.
 * Best-effort: never throws.
 */
export async function sendComplianceDigestEmail({
  to, fleetName, items, portalUrl,
}: {
  to:         string | string[]
  fleetName:  string
  items:      ComplianceAlertItem[]
  /** Absolute link to /fleet-pro/compliance. Omitted when the base URL is unknown. */
  portalUrl?: string | null
}): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { success: false, error: 'RESEND_API_KEY not configured' }

  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean)
  if (recipients.length === 0) return { success: false, error: 'No recipients' }
  if (!items || items.length === 0) return { success: false, error: 'No items to report' }

  try {
    // Worst first — the expired items are the reason the email exists.
    const sorted = [...items].sort((a, b) => {
      const rank = COMPLIANCE_STATE_RANK[a.state] - COMPLIANCE_STATE_RANK[b.state]
      if (rank !== 0) return rank
      const ad = a.days_until_expiration ?? Number.MAX_SAFE_INTEGER
      const bd = b.days_until_expiration ?? Number.MAX_SAFE_INTEGER
      return ad - bd
    })

    const expired = sorted.filter(i => i.state === 'expired')
    const missing = sorted.filter(i => i.state === 'missing')
    const soon    = sorted.filter(i => i.state !== 'expired' && i.state !== 'missing')

    const subject = expired.length
      ? `COMPLIANCE ALERT — ${expired.length} expired, ${soon.length + missing.length} to action — ${fleetName}`
      : `Compliance Due — ${sorted.length} item${sorted.length === 1 ? '' : 's'} — ${fleetName}`

    const rows = sorted.map(i => {
      const color   = COMPLIANCE_COLOR[i.state]
      const heavy   = i.state === 'expired' || i.state === 'missing'
      const cell    = 'padding:9px 12px;border-top:1px solid #E5E7EB;font-size:13px'
      return `<tr>
        <td style="${cell};font-weight:700;color:${INK}">${esc(i.subject_label)}<div style="font-size:11px;font-weight:400;color:${GREY};text-transform:uppercase;letter-spacing:0.5px">${esc(SUBJECT_HEADING[i.subject])}</div></td>
        <td style="${cell};color:#374151">${esc(i.type_label)}${i.detail ? `<div style="font-size:11px;color:${GREY}">${esc(i.detail)}</div>` : ''}</td>
        <td style="${cell};color:#374151">${esc(fmtDate(i.expires_on))}</td>
        <td style="${cell};font-weight:${heavy ? '700' : '600'};color:${color}">
          ${esc(COMPLIANCE_STATE_LABEL[i.state])}
          <div style="font-size:11px;font-weight:400;color:${GREY}">${esc(whenLabel(i.state, i.days_until_expiration))}</div>
        </td>
      </tr>`
    }).join('')

    // The banner names the out-of-service risk explicitly. An expired medical card or
    // annual inspection is not an administrative nag — it is a truck that cannot
    // legally roll, and the email should say so in the first line.
    const banner = (expired.length || missing.length)
      ? `<div style="margin:0 0 16px;padding:10px 14px;border-radius:8px;background:#FEF2F2;border-left:4px solid ${RED}">
           <p style="margin:0;font-size:13px;font-weight:700;color:${RED}">
             ${esc(expired.length)} item${expired.length === 1 ? '' : 's'} expired${missing.length ? `, ${esc(missing.length)} with no date on file` : ''}.
           </p>
           <p style="margin:4px 0 0;font-size:12px;color:#7F1D1D">
             An expired inspection, medical card or registration can put the unit or the driver out of service at a roadside check.
           </p>
         </div>`
      : ''

    const cta = portalUrl
      ? `<p style="margin:18px 0 0;font-size:13px">
           <a href="${esc(portalUrl)}" style="color:#3A7FD5;font-weight:600;text-decoration:none">Open the compliance calendar →</a>
         </p>`
      : ''

    const th = 'padding:8px 12px;text-align:left;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#6B7280'

    const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;background:#ffffff;color:${INK}">
  <div style="background:#0a0f14;padding:18px 24px">
    <p style="margin:0;color:#fff;font-size:18px;font-weight:800;letter-spacing:1px">DOT &amp; COMPLIANCE CALENDAR</p>
    <p style="margin:2px 0 0;color:#9CA3AF;font-size:13px">${esc(fleetName)}</p>
  </div>
  <div style="padding:20px 24px">
    ${banner}
    <p style="margin:0 0 12px;font-size:13px;color:${GREY}">
      These compliance items are expired, missing a date, or coming due.
    </p>
    <table style="border-collapse:collapse;width:100%;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px">
      <tr style="background:#F3F4F6">
        <th style="${th}">Subject</th>
        <th style="${th}">Item</th>
        <th style="${th}">Date</th>
        <th style="${th}">Status</th>
      </tr>
      ${rows}
    </table>
    ${cta}
    <p style="margin:18px 0 0;font-size:12px;color:${GREY}">
      Update a date or upload a document in NWI Fleet Pro under Compliance. This digest
      is sent again only when the list itself changes.
    </p>
  </div>
  <div style="padding:14px 24px;border-top:1px solid #E5E7EB;text-align:center">
    <p style="margin:0;color:#9CA3AF;font-size:12px">Generated by National Wrench Index — Fleet Pro</p>
  </div>
</div>`

    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({ from: FROM, to: recipients, subject, html })
    if (error) {
      console.error('[compliance-alert-email] Resend error:', error)
      return { success: false, error: 'Email send failed' }
    }
    return { success: true }
  } catch (err) {
    console.error('[compliance-alert-email] error:', err instanceof Error ? err.message : err)
    return { success: false, error: 'Email send failed' }
  }
}

/**
 * The same digest compressed into one SMS. Deliberately a count and the single worst
 * item rather than a list: a text message that runs to four segments costs four times
 * as much and is read half as often, and the detail is one tap away in the portal.
 */
export function buildComplianceDigestSms({
  fleetName, items, portalUrl,
}: {
  fleetName:  string
  items:      ComplianceAlertItem[]
  portalUrl?: string | null
}): string {
  const expired = items.filter(i => i.state === 'expired' || i.state === 'missing').length
  const soon    = items.length - expired

  const worst = [...items].sort(
    (a, b) => COMPLIANCE_STATE_RANK[a.state] - COMPLIANCE_STATE_RANK[b.state]
             || (a.days_until_expiration ?? 9_999) - (b.days_until_expiration ?? 9_999),
  )[0]

  const head = expired
    ? `NWI Fleet Pro: ${expired} compliance item${expired === 1 ? '' : 's'} EXPIRED`
    : `NWI Fleet Pro: ${soon} compliance item${soon === 1 ? '' : 's'} due soon`
  const tail = expired && soon ? `, ${soon} due soon` : ''
  const lead = worst
    ? ` Worst: ${worst.subject_label} — ${worst.type_label} (${whenLabel(worst.state, worst.days_until_expiration)}).`
    : ''

  return `${head}${tail} for ${fleetName}.${lead}${portalUrl ? ` ${portalUrl}` : ''}`
}
