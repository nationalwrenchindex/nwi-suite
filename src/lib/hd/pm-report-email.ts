import { Resend } from 'resend'
import { createServiceClient } from '@/lib/supabase/service'

const FROM = 'NWI HD Suite <onboarding@resend.dev>'

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const d = new Date(s)
  return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

interface Flagged { id?: string; text?: string; section?: string }

// Builds + sends the PM completion report to the tech's business email.
// Re-queries by checklist id so both the completion flow and the re-send endpoint share it.
// Best-effort: returns success/error, never throws.
export async function sendPmReportEmail({
  userId, checklistId,
}: { userId: string; checklistId: string }): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { success: false, error: 'RESEND_API_KEY not configured' }

  try {
    const svc = createServiceClient()

    const { data: pm } = await svc
      .from('hd_pm_checklists')
      .select('id, user_id, unit_id, pm_type, checklist_data, flagged_items, battery_cca, alarm_codes_found, alarm_codes_cleared, tech_name, signature_base64, completed_at')
      .eq('id', checklistId)
      .single()

    // Ownership check — never email a record that isn't the requesting tech's.
    if (!pm || pm.user_id !== userId) return { success: false, error: 'Checklist not found' }

    const { data: profile } = await svc
      .from('profiles')
      .select('email, business_name, hd_tech_name, full_name')
      .eq('id', userId)
      .single()

    const to = profile?.email as string | undefined
    if (!to) return { success: false, error: 'No email on file for this account' }

    let unitLabel = 'Unit'
    let unitNumber = ''
    if (pm.unit_id) {
      const { data: unit } = await svc
        .from('hd_units')
        .select('unit_number, manufacturer, model')
        .eq('id', pm.unit_id)
        .maybeSingle()
      if (unit) {
        unitNumber = (unit.unit_number as string) ?? ''
        unitLabel = [unit.unit_number, unit.manufacturer, unit.model].filter(Boolean).join(' ')
      }
    }

    const dateStr    = fmtDate(pm.completed_at as string | null)
    const techName   = (pm.tech_name as string) || (profile?.hd_tech_name as string) || (profile?.full_name as string) || '—'
    const business   = (profile?.business_name as string) || 'HD Suite'
    const flagged    = Array.isArray(pm.flagged_items) ? (pm.flagged_items as Flagged[]) : []
    const inspected  = pm.checklist_data && typeof pm.checklist_data === 'object'
      ? Object.keys(pm.checklist_data as Record<string, unknown>).length : 0
    const battery    = pm.battery_cca != null ? `${pm.battery_cca} CCA${Number(pm.battery_cca) < 800 ? ' — REPLACE' : ' ✓'}` : '—'
    const sig        = pm.signature_base64 as string | null

    const subject = `PM Checklist Complete — ${unitLabel} — ${dateStr}`

    const flaggedHtml = flagged.length
      ? `<ul style="margin:6px 0 0;padding-left:18px;color:#B45309">${flagged.map(f =>
          `<li style="margin-bottom:3px">${esc(f.text)}${f.section ? ` <span style="color:#9CA3AF">(${esc(f.section)})</span>` : ''}</li>`).join('')}</ul>`
      : `<span style="color:#16A34A">None — all items passed</span>`

    const row = (label: string, value: string) =>
      `<tr><td style="padding:6px 12px;color:#6B7280;font-size:13px;white-space:nowrap">${esc(label)}</td>` +
      `<td style="padding:6px 12px;color:#111827;font-size:13px;font-weight:600">${value}</td></tr>`

    const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;color:#111827">
  <div style="background:#E85D24;padding:18px 24px">
    <p style="margin:0;color:#fff;font-size:18px;font-weight:800;letter-spacing:1px">PM CHECKLIST COMPLETE</p>
    <p style="margin:2px 0 0;color:#ffe;font-size:13px">${esc(business)}</p>
  </div>
  <div style="padding:20px 24px">
    <table style="border-collapse:collapse;width:100%;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px">
      ${row('PM Type', esc(pm.pm_type))}
      ${row('Unit', esc(unitLabel))}
      ${row('Date', esc(dateStr))}
      ${row('Technician', esc(techName))}
      ${row('Items Inspected', String(inspected))}
      ${row('Items Flagged', `<span style="color:${flagged.length ? '#B45309' : '#16A34A'}">${flagged.length}</span>`)}
      ${row('Battery CCA', esc(battery))}
      ${row('Alarm Codes Found', esc(pm.alarm_codes_found) || '—')}
      ${row('Alarm Codes Cleared', esc(pm.alarm_codes_cleared) || '—')}
    </table>

    <p style="margin:18px 0 4px;font-size:13px;font-weight:700;color:#374151">Flagged Items — Customer Review</p>
    ${flaggedHtml}

    <p style="margin:18px 0 4px;font-size:13px;font-weight:700;color:#374151">Technician Signature</p>
    ${sig ? `<img src="${sig}" alt="Signature" style="max-height:90px;border:1px solid #E5E7EB;border-radius:6px;background:#fff" />`
          : `<span style="color:#6B7280;font-size:13px">Signed digitally</span>`}
  </div>
  <div style="padding:14px 24px;border-top:1px solid #E5E7EB;text-align:center">
    <p style="margin:0;color:#9CA3AF;font-size:12px">Generated by National Wrench Index</p>
  </div>
</div>`

    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({ from: FROM, to, subject, html })
    if (error) {
      console.error('[pm-report-email] Resend error:', error)
      return { success: false, error: 'Email send failed' }
    }
    void unitNumber
    return { success: true }
  } catch (err) {
    console.error('[pm-report-email] error:', err instanceof Error ? err.message : err)
    return { success: false, error: 'Email send failed' }
  }
}
