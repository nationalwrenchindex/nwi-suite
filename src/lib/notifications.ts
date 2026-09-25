/**
 * National Wrench Index — Notification Service
 *
 * Handles SMS (Twilio) and email (Resend) for all four trigger types.
 * Resolves {{merge_tags}} from live job/customer/profile data.
 * Logs every send attempt to notification_logs for audit.
 *
 * Four triggers:
 *   booking_confirmation — fired on POST /api/jobs  (auto)
 *   day_before_reminder  — fired by /api/notifications/reminders cron (auto)
 *   on_my_way            — fired manually by the tech (button in My Jobs)
 *   job_completed        — fired on PUT /api/jobs/[id] when status → completed (auto)
 */

import { formatDate, formatTime } from './scheduler'
import { getContactSuppression } from '@/lib/customer-contact'

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationTrigger =
  | 'booking_confirmation'
  | 'day_before_reminder'
  | 'on_my_way'
  | 'work_started'
  | 'job_completed'

// Minimal duck-typed DB client (both SSR and JS Supabase clients satisfy this)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any

interface MergeContext {
  customer_name:  string
  first_name:     string
  job_date:       string
  job_time:       string
  service_type:   string
  business_name:  string
  tech_name:      string
  vehicle:        string
  location:       string
  invoice_total:  string
  invoice_number: string
}

export interface DispatchResult {
  success:  boolean
  channel:  string
  message?: string
  sms?:    { success: boolean; sid?: string; error?: string }
  email?:  { success: boolean; id?: string; error?: string }
  error?:  string
}

// ─── Trigger → template_type mapping ─────────────────────────────────────────

const TRIGGER_TEMPLATE_TYPE: Record<NotificationTrigger, string> = {
  booking_confirmation: 'appointment_confirmation',
  day_before_reminder:  'appointment_reminder',
  on_my_way:            'on_my_way',
  // Its own type rather than reusing on_my_way: 'on the way' is a travel notice,
  // and a work order going in_progress means the unit is already in the bay. A shop
  // that edits one message must not silently change the other.
  work_started:         'work_started',
  job_completed:        'job_completed',
}

// ─── Built-in fallback messages (used when no active template exists) ─────────

const FALLBACK_SMS: Record<NotificationTrigger, string> = {
  booking_confirmation:
    'Hi {{first_name}}! Your {{service_type}} is confirmed for {{job_date}} at {{job_time}}. — {{business_name}}',
  day_before_reminder:
    'Hi {{first_name}}, reminder: your {{service_type}} is tomorrow at {{job_time}}. Reply CONFIRM or call to reschedule. — {{business_name}}',
  on_my_way:
    'Hi {{first_name}}, {{tech_name}} is on the way for your {{service_type}}! See you soon. — {{business_name}}',
  work_started:
    'Hi {{first_name}}, we have started work on your {{vehicle}}. We will let you know as soon as it is done. — {{business_name}}',
  job_completed:
    'Your {{service_type}} is complete! Great having you as a customer, {{first_name}}. — {{business_name}} 🔧',
}

const FALLBACK_SUBJECT: Record<NotificationTrigger, string> = {
  booking_confirmation: 'Appointment Confirmed — {{business_name}}',
  day_before_reminder:  "Reminder: Your appointment is tomorrow — {{business_name}}",
  on_my_way:            '{{tech_name}} is on the way! — {{business_name}}',
  work_started:         'Work Started — {{business_name}}',
  job_completed:        'Service Complete — {{business_name}}',
}

// ─── Merge tag resolver ────────────────────────────────────────────────────────

function resolve(template: string, ctx: Partial<MergeContext>): string {
  return template
    .replace(/\{\{customer_name\}\}/g,  ctx.customer_name  ?? '')
    .replace(/\{\{first_name\}\}/g,     ctx.first_name     ?? '')
    .replace(/\{\{job_date\}\}/g,       ctx.job_date       ?? '')
    .replace(/\{\{job_time\}\}/g,       ctx.job_time       ?? '')
    .replace(/\{\{service_type\}\}/g,   ctx.service_type   ?? '')
    .replace(/\{\{business_name\}\}/g,  ctx.business_name  ?? '')
    .replace(/\{\{tech_name\}\}/g,      ctx.tech_name      ?? '')
    .replace(/\{\{vehicle\}\}/g,        ctx.vehicle        ?? '')
    .replace(/\{\{location\}\}/g,       ctx.location       ?? '')
    .replace(/\{\{invoice_total\}\}/g,  ctx.invoice_total  ?? '')
    .replace(/\{\{invoice_number\}\}/g, ctx.invoice_number ?? '')
}

// ─── Twilio SMS (native fetch — no package required) ─────────────────────────

async function sendSms(
  to: string,
  body: string,
): Promise<{ success: boolean; sid?: string; error?: string }> {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from  = process.env.TWILIO_PHONE_NUMBER

  if (!sid || !token || !from) {
    console.warn('[NWI/SMS] Twilio credentials not configured — skipping')
    return { success: false, error: 'Twilio credentials not configured' }
  }

  // Normalize to E.164
  const digits    = to.replace(/\D/g, '')
  const e164      = digits.startsWith('1') ? `+${digits}` : `+1${digits}`
  const basicAuth = Buffer.from(`${sid}:${token}`).toString('base64')

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: from, To: e164, Body: body }).toString(),
      },
    )
    const data = await res.json() as { sid?: string; message?: string; code?: number }
    if (!res.ok) {
      console.error('[NWI/SMS] Twilio rejected (HTTP', res.status, ', code', data.code, '):', data.message)
      let userError: string
      if (res.status === 401 || data.code === 20003) {
        userError = 'SMS service authentication failed — check Twilio credentials.'
      } else if (data.code === 20008 || data.code === 20009) {
        userError = 'SMS service unavailable — insufficient account balance.'
      } else {
        userError = 'SMS delivery failed. Please try again later.'
      }
      return { success: false, error: userError }
    }
    return { success: true, sid: data.sid }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[NWI/SMS] fetch error:', msg)
    return { success: false, error: msg }
  }
}

// ─── SMTP email via nodemailer ────────────────────────────────────────────────

async function sendEmail(
  to: string,
  subject: string,
  text: string,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT ?? 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM ?? user ?? 'notifications@nationalwrenchindex.com'

  if (!host || !user || !pass) {
    console.warn('[NWI/Email] SMTP credentials not configured — skipping')
    return { success: false, error: 'SMTP credentials not configured' }
  }

  try {
    // Dynamic import keeps nodemailer out of edge bundles
    const nodemailer = await import('nodemailer')
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    })

    const info = await transporter.sendMail({ from, to, subject, text })
    return { success: true, id: info.messageId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[NWI/Email] SMTP error:', msg)
    return { success: false, error: msg }
  }
}

// ─── Build merge context from DB ──────────────────────────────────────────────

async function buildContext(jobId: string, db: AnyDB) {
  // Job + joined customer + vehicle
  const { data: job } = await db
    .from('jobs')
    .select(`
      *,
      customer:customers(id, first_name, last_name, phone, email),
      vehicle:vehicles(id, year, make, model)
    `)
    .eq('id', jobId)
    .single()

  if (!job) return { ctx: null, job: null }

  // Tech profile
  const { data: profile } = await db
    .from('profiles')
    .select('full_name, business_name')
    .eq('id', job.user_id)
    .single()

  // Latest invoice for this job (for invoice merge tags)
  const { data: invoice } = await db
    .from('invoices')
    .select('total, invoice_number')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const c = job.customer as { id?: string; first_name: string; last_name: string; phone?: string; email?: string } | null
  const v = job.vehicle  as { year?: number; make: string; model: string } | null

  const ctx: Partial<MergeContext> = {
    customer_name:  c ? `${c.first_name} ${c.last_name}` : '',
    first_name:     c?.first_name ?? '',
    job_date:       formatDate(job.job_date as string),
    job_time:       job.job_time ? formatTime(job.job_time as string) : 'TBD',
    service_type:   job.service_type as string,
    business_name:  profile?.business_name ?? 'Your Technician',
    tech_name:      profile?.full_name     ?? 'Your Technician',
    vehicle:        v ? [v.year, v.make, v.model].filter(Boolean).join(' ') : '',
    location:       (job.location_address as string | null) ?? '',
    invoice_total:  invoice ? `$${Number(invoice.total).toFixed(2)}` : '',
    invoice_number: invoice?.invoice_number ?? '',
  }

  return { ctx, job, customerId: c?.id }
}

// ─── Write to notification_logs ───────────────────────────────────────────────

async function log(
  db: AnyDB,
  row: {
    user_id:      string
    job_id?:      string
    customer_id?: string
    trigger_type: string
    channel:      'sms' | 'email'
    recipient:    string
    message:      string
    subject?:     string
    status:       'sent' | 'failed'
    error?:       string
    provider_id?: string
  },
) {
  try {
    await db.from('notification_logs').insert(row)
  } catch (e) {
    console.error('[NWI/Log]', e)
  }
}

// ─── Main dispatch ────────────────────────────────────────────────────────────

export async function dispatchNotification({
  trigger,
  jobId,
  supabase,
  channelOverride,
}: {
  trigger:          NotificationTrigger
  jobId:            string
  supabase:         AnyDB
  channelOverride?: string
}): Promise<DispatchResult> {
  // Build merge context
  const { ctx, job, customerId } = await buildContext(jobId, supabase)

  if (!job || !ctx) {
    // Nothing to log against — notification_logs.user_id is NOT NULL and the job
    // that would have supplied it is the thing that is missing. Console only.
    console.error(`[NWI/Notify] ${trigger} aborted: job ${jobId} not found or has no customer context`)
    return { success: false, channel: 'none', error: 'Job not found' }
  }

  const userId     = job.user_id as string
  const c          = job.customer as { phone?: string; email?: string } | null
  const smsConsent = Boolean((job as Record<string, unknown>).sms_consent)

  // Find the user's active template for this trigger
  const templateType = TRIGGER_TEMPLATE_TYPE[trigger]
  const { data: rows } = await supabase
    .from('notification_templates')
    .select('*')
    .eq('user_id', userId)
    .eq('template_type', templateType)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)

  const tpl = rows?.[0] ?? null

  const channel  = (channelOverride ?? tpl?.channel ?? 'sms') as 'sms' | 'email' | 'both'
  const rawBody  = (tpl?.message_content ?? FALLBACK_SMS[trigger]) as string
  const rawSubj  = (tpl?.subject ?? FALLBACK_SUBJECT[trigger]) as string
  const message  = resolve(rawBody, ctx)
  const subject  = resolve(rawSubj, ctx)

  // Per-customer suppression. Read once and consulted by both branches below.
  // Distinct from smsConsent, which is opt-IN captured at booking; this is the
  // mechanic marking a customer do-not-contact after the fact. Fails open — a
  // lookup failure must not silently stop a working business's outreach.
  const suppression = await getContactSuppression(supabase, customerId ?? null)

  const result: DispatchResult = { success: false, channel, message }

  // ── SMS ─────────────────────────────────────────────────────────────────────
  // Every reason this can decline to send is resolved FIRST and then logged, so a
  // notification that goes nowhere still leaves a row saying why. Previously the
  // guards sat in the `if`, so a job without consent produced no send, no log and
  // no console line — indistinguishable from the feature not existing.
  const smsReason: string | null =
    (channel !== 'sms' && channel !== 'both') ? `Template channel is '${channel}' — SMS not requested`
    : !smsConsent                             ? 'Customer did not consent to SMS (jobs.sms_consent is false)'
    : suppression.no_sms                      ? 'Customer is flagged do-not-SMS'
    : !c?.phone                               ? 'No phone number on file for customer'
    : null

  if (smsReason === null) {
    const phone = c!.phone as string
    const r = await sendSms(phone, message)
    result.sms = r
    await log(supabase, {
      user_id: userId, job_id: jobId, customer_id: customerId,
      trigger_type: trigger, channel: 'sms', recipient: phone,
      message, status: r.success ? 'sent' : 'failed',
      error: r.error, provider_id: r.sid,
    })
  } else {
    result.sms = { success: false, error: smsReason }
    console.warn(`[NWI/Notify] ${trigger} SMS skipped for job ${jobId}: ${smsReason}`)
    // Logged as 'failed' because notification_logs.status is CHECK-constrained to
    // ('sent','failed') — a 'skipped' value needs a migration. The reason is the
    // part that matters and it goes in `error` verbatim.
    await log(supabase, {
      user_id: userId, job_id: jobId, customer_id: customerId,
      trigger_type: trigger, channel: 'sms',
      recipient: c?.phone ?? '(none on file)',
      message, status: 'failed', error: smsReason,
    })
  }

  // ── Email ───────────────────────────────────────────────────────────────────
  const emailReason: string | null =
    (channel !== 'email' && channel !== 'both') ? `Template channel is '${channel}' — email not requested`
    : suppression.no_email                      ? 'Customer is flagged do-not-email'
    : !c?.email                                 ? 'No email address on file for customer'
    : null

  if (emailReason === null) {
    const email = c!.email as string
    const r = await sendEmail(email, subject, message)
    result.email = r
    await log(supabase, {
      user_id: userId, job_id: jobId, customer_id: customerId,
      trigger_type: trigger, channel: 'email', recipient: email,
      message, subject, status: r.success ? 'sent' : 'failed',
      error: r.error, provider_id: r.id,
    })
  } else {
    result.email = { success: false, error: emailReason }
    console.warn(`[NWI/Notify] ${trigger} email skipped for job ${jobId}: ${emailReason}`)
    await log(supabase, {
      user_id: userId, job_id: jobId, customer_id: customerId,
      trigger_type: trigger, channel: 'email',
      recipient: c?.email ?? '(none on file)',
      message, subject, status: 'failed', error: emailReason,
    })
  }

  result.success = !!(result.sms?.success || result.email?.success)
  return result
}

// ─── Mechanic notification (inspection request, etc.) ─────────────────────────
// Sends SMS + email directly to the mechanic's registered contacts.

export async function notifyMechanic({
  supabase,
  mechanicId,
  message,
  subject,
}: {
  supabase:   AnyDB
  mechanicId: string
  message:    string
  subject:    string
}): Promise<void> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('phone, email')
    .eq('id', mechanicId)
    .single()

  if (profile?.phone) {
    await sendSms(profile.phone as string, message).catch((e: unknown) =>
      console.error('[notifyMechanic/sms]', e),
    )
  }
  if (profile?.email) {
    await sendEmail(profile.email as string, subject, message).catch((e: unknown) =>
      console.error('[notifyMechanic/email]', e),
    )
  }
}

// ─── Dispatch without a job ───────────────────────────────────────────────────
// dispatchNotification() above builds its merge context from a jobs row, which a
// work order does not have. This is the same send — same notification_templates
// lookup, same merge resolver, same suppression check, same logging — driven by a
// context the caller supplies instead.
//
// ONE DELIBERATE DIFFERENCE: the job path also requires jobs.sms_consent, the
// opt-in captured at online booking. A work order has no booking, so there is no
// such record to consult; the customer handed their number to the shop for this
// job. Suppression (the explicit do-not-contact flag) is still honoured, which is
// the same bar api/cron/late-fees texts at.
export async function dispatchNotificationFor({
  trigger,
  supabase,
  userId,
  customerId,
  customer,
  ctx,
  channelOverride,
}: {
  trigger:          NotificationTrigger
  supabase:         AnyDB
  userId:           string
  customerId:       string | null
  customer:         { phone?: string | null; email?: string | null } | null
  ctx:              Partial<MergeContext>
  channelOverride?: string
}): Promise<DispatchResult> {
  const templateType = TRIGGER_TEMPLATE_TYPE[trigger]
  const { data: rows } = await supabase
    .from('notification_templates')
    .select('*')
    .eq('user_id', userId)
    .eq('template_type', templateType)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)

  const tpl = rows?.[0] ?? null

  const channel = (channelOverride ?? tpl?.channel ?? 'sms') as 'sms' | 'email' | 'both'
  const message = resolve((tpl?.message_content ?? FALLBACK_SMS[trigger]) as string, ctx)
  const subject = resolve((tpl?.subject ?? FALLBACK_SUBJECT[trigger]) as string, ctx)

  const suppression = await getContactSuppression(supabase, customerId ?? null)
  const result: DispatchResult = { success: false, channel, message }

  if ((channel === 'sms' || channel === 'both') && !suppression.no_sms) {
    const phone = customer?.phone
    if (phone) {
      const r = await sendSms(phone, message)
      result.sms = r
      await log(supabase, {
        user_id: userId, customer_id: customerId ?? undefined,
        trigger_type: trigger, channel: 'sms', recipient: phone,
        message, status: r.success ? 'sent' : 'failed',
        error: r.error, provider_id: r.sid,
      })
    } else {
      result.sms = { success: false, error: 'No phone number on file for customer' }
    }
  }

  if ((channel === 'email' || channel === 'both') && !suppression.no_email) {
    const email = customer?.email
    if (email) {
      const r = await sendEmail(email, subject, message)
      result.email = r
      await log(supabase, {
        user_id: userId, customer_id: customerId ?? undefined,
        trigger_type: trigger, channel: 'email', recipient: email,
        message, subject, status: r.success ? 'sent' : 'failed',
        error: r.error, provider_id: r.id,
      })
    } else {
      result.email = { success: false, error: 'No email address on file for customer' }
    }
  }

  result.success = !!(result.sms?.success || result.email?.success)
  return result
}
