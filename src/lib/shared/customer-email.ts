// Plain-text customer email over SMTP.
//
// Lifted from the quote send route so the segment approval send — and the HD one
// after it — do not each carry another copy. Four routes still have their own
// identical local version (quotes/[id]/send, invoices/[id]/send,
// quotes/public/[token]/respond, invoices/public/[token]/view); they are left alone
// rather than refactored inside a feature change, but new senders belong here.
//
// SERVER ONLY — imports nodemailer lazily so it never reaches a client bundle.

export interface SendResult {
  success: boolean
  error?:  string
}

export async function sendCustomerEmail(
  to:      string,
  subject: string,
  text:    string,
): Promise<SendResult> {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT ?? 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM ?? user ?? 'notifications@nationalwrenchindex.com'

  // Not configured is reported, never thrown: a shop with no SMTP set up should still
  // be able to send the SMS half of an approval request.
  if (!host || !user || !pass) return { success: false, error: 'SMTP not configured' }

  try {
    const nodemailer = await import('nodemailer')
    const transport = nodemailer.createTransport({
      host, port, secure: port === 465, auth: { user, pass },
    })
    await transport.sendMail({ from, to, subject, text })
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
