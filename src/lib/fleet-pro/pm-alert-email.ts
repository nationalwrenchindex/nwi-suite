// SERVER-ONLY. The 30-day PM warning digest for a Fleet Pro fleet.
//
// One email per fleet, not one per unit — a department with forty trailers coming
// due the same week wants a single list, not forty notifications. Follows the same
// house pattern as src/lib/hd/pm-report-email.ts: lazy Resend client, escape
// everything, never throw, hand the caller { success, error? } to log.

import { Resend } from 'resend'

const FROM = 'NWI Fleet Pro <onboarding@resend.dev>'

const RED    = '#ef4444'  // overdue — must be visually distinct on every surface
const ORANGE = '#E85D24'  // due within 30 days

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

/** "12 days overdue" / "due in 9 days" / "due today" */
function dueLabel(days: number | null): string {
  if (days == null) return '—'
  if (days < 0)  return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
  if (days === 0) return 'due today'
  return `due in ${days} day${days === 1 ? '' : 's'}`
}

export interface PmDueUnit {
  unit_number:    string
  next_due_date:  string | null
  days_until_due: number | null   // negative when overdue
}

/**
 * Send the PM digest. `to` may be a single address or the whole notify list —
 * managers and supervisors of the fleet. Best-effort: never throws.
 */
export async function sendPmDueEmail({
  to, fleetName, units,
}: {
  to:        string | string[]
  fleetName: string
  units:     PmDueUnit[]
}): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { success: false, error: 'RESEND_API_KEY not configured' }

  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean)
  if (recipients.length === 0) return { success: false, error: 'No recipients' }
  if (!units || units.length === 0) return { success: false, error: 'No units to report' }

  try {
    // Worst first — the overdue units are the reason the email exists.
    const sorted = [...units].sort(
      (a, b) => (a.days_until_due ?? 9_999) - (b.days_until_due ?? 9_999),
    )
    const overdue  = sorted.filter(u => (u.days_until_due ?? 0) < 0)
    const dueSoon  = sorted.filter(u => (u.days_until_due ?? 0) >= 0)

    const subject = overdue.length
      ? `PM ALERT — ${overdue.length} overdue, ${dueSoon.length} due soon — ${fleetName}`
      : `PM Due Soon — ${dueSoon.length} unit${dueSoon.length === 1 ? '' : 's'} — ${fleetName}`

    const rows = sorted.map(u => {
      const isOverdue = (u.days_until_due ?? 0) < 0
      const color = isOverdue ? RED : ORANGE
      return `<tr>
        <td style="padding:9px 12px;border-top:1px solid #E5E7EB;font-size:13px;font-weight:700;color:#111827">${esc(u.unit_number)}</td>
        <td style="padding:9px 12px;border-top:1px solid #E5E7EB;font-size:13px;color:#374151">${esc(fmtDate(u.next_due_date))}</td>
        <td style="padding:9px 12px;border-top:1px solid #E5E7EB;font-size:13px;font-weight:${isOverdue ? '700' : '600'};color:${color}">${esc(dueLabel(u.days_until_due))}</td>
      </tr>`
    }).join('')

    const banner = overdue.length
      ? `<div style="margin:0 0 16px;padding:10px 14px;border-radius:8px;background:#FEF2F2;border-left:4px solid ${RED}">
           <p style="margin:0;font-size:13px;font-weight:700;color:${RED}">
             ${overdue.length} unit${overdue.length === 1 ? ' is' : 's are'} past the scheduled PM date.
           </p>
         </div>`
      : ''

    const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;color:#111827">
  <div style="background:${ORANGE};padding:18px 24px">
    <p style="margin:0;color:#fff;font-size:18px;font-weight:800;letter-spacing:1px">PREVENTIVE MAINTENANCE DUE</p>
    <p style="margin:2px 0 0;color:#ffe;font-size:13px">${esc(fleetName)}</p>
  </div>
  <div style="padding:20px 24px">
    ${banner}
    <p style="margin:0 0 12px;font-size:13px;color:#6B7280">
      These units are within 30 days of their scheduled PM date, or already past it.
    </p>
    <table style="border-collapse:collapse;width:100%;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px">
      <tr style="background:#F3F4F6">
        <th style="padding:8px 12px;text-align:left;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#6B7280">Unit</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#6B7280">Next Due</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#6B7280">Status</th>
      </tr>
      ${rows}
    </table>
    <p style="margin:18px 0 0;font-size:12px;color:#6B7280">
      Schedule this work with your maintenance contractor, or update the interval in
      NWI Fleet Pro under PM Schedule.
    </p>
  </div>
  <div style="padding:14px 24px;border-top:1px solid #E5E7EB;text-align:center">
    <p style="margin:0;color:#9CA3AF;font-size:12px">Generated by National Wrench Index — Fleet Pro</p>
  </div>
</div>`

    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({ from: FROM, to: recipients, subject, html })
    if (error) {
      console.error('[pm-alert-email] Resend error:', error)
      return { success: false, error: 'Email send failed' }
    }
    return { success: true }
  } catch (err) {
    console.error('[pm-alert-email] error:', err instanceof Error ? err.message : err)
    return { success: false, error: 'Email send failed' }
  }
}
