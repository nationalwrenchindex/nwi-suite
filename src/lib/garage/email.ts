// Garage sections appended to the invoice email.
//
// Two mutually exclusive outcomes: the customer has a Garage and we just filed
// the service in it, or they do not and we invite them with the vehicle already
// filled in. Every helper returns both HTML and a plain-text equivalent, since
// the invoice email sends multipart and the text part has to stand alone.

import type { GarageSyncResult } from './link'

const BRAND  = '#F26B21'
const BORDER = '#e5e5e5'
const MUTED  = '#6b7280'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Notification that the service was filed — no action required of them. */
function updatedHtml(nwiGarageId: string | null): string {
  return `
  <div style="border:1px solid ${BORDER};border-radius:10px;padding:20px;margin:28px 0;background:#fafafa">
    <p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#111">Your NWI Garage has been updated</p>
    <p style="margin:0;font-size:14px;line-height:1.6;color:${MUTED}">
      This service was added to your vehicle's history automatically${
        nwiGarageId ? ` (garage ${escapeHtml(nwiGarageId)})` : ''
      }. There is nothing you need to do.
    </p>
  </div>`
}

function updatedText(nwiGarageId: string | null): string {
  return [
    '',
    'YOUR NWI GARAGE HAS BEEN UPDATED',
    `This service was added to your vehicle's history automatically${nwiGarageId ? ` (garage ${nwiGarageId})` : ''}.`,
    'There is nothing you need to do.',
  ].join('\n')
}

/** Signup invitation with the vehicle pre-filled from the invoice. */
function joinHtml(joinUrl: string): string {
  return `
  <div style="border:1px solid ${BORDER};border-radius:10px;padding:24px;margin:28px 0;text-align:center">
    <p style="margin:0 0 6px;font-size:16px;font-weight:600;color:#111">Keep your service records in one place</p>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:${MUTED}">
      NWI Garage keeps every repair, mileage update and service reminder for your vehicle. It is free,
      and we have already filled in your vehicle details.
    </p>
    <a href="${escapeHtml(joinUrl)}"
       style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;
              font-weight:600;font-size:15px;padding:13px 28px;border-radius:8px">
      Get Your Free NWI Garage
    </a>
  </div>`
}

function joinText(joinUrl: string): string {
  return [
    '',
    'GET YOUR FREE NWI GARAGE',
    'Keep every repair, mileage update and service reminder for your vehicle in one place.',
    'Your vehicle details are already filled in:',
    joinUrl,
  ].join('\n')
}

export function garageEmailSection(result: GarageSyncResult): { html: string; text: string } {
  if (result.linked) {
    // A linked customer whose post did not land still gets the neutral notice
    // rather than a signup pitch for an account they already have.
    return { html: updatedHtml(result.nwiGarageId), text: updatedText(result.nwiGarageId) }
  }
  return { html: joinHtml(result.joinUrl), text: joinText(result.joinUrl) }
}

/** Wraps the invoice body and garage section into one HTML email. */
export function invoiceHtmlEmail({
  heading,
  bodyLines,
  garageHtml,
}: {
  heading:    string
  bodyLines:  string[]
  garageHtml: string
}): string {
  const paragraphs = bodyLines
    .filter(Boolean)
    .map(l => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#111">${escapeHtml(l)}</p>`)
    .join('')

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f5f5">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
        <tr><td>
          <p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#111">${escapeHtml(heading)}</p>
          ${paragraphs}
          ${garageHtml}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}
