// Shared handling for inbound directory-agent SMS replies.
//
// Two webhooks can receive these: /api/directory-agent/webhook (the outreach
// number's own endpoint) and /api/torquewrench/sms-response (which fronts the
// shared inbound number and checks for a directory prospect before falling
// through to review handling). Both call into here so a YES creates a listing
// the same way regardless of which endpoint Twilio hit.

import { createServiceClient } from '@/lib/supabase/service'
import { sendAgentSms } from './sms'
import { createAgentListing } from './bd'
import { FALLBACK_MESSAGE, LISTED_MESSAGE, OPTOUT_MESSAGE } from './config'

export const OPT_OUT_KEYWORDS = ['stop', 'no', 'unsubscribe', 'cancel', 'end', 'quit']

export interface DirectoryProspect {
  id:                 string
  phone:              string
  business_name:      string | null
  city:               string | null
  state:              string | null
  status:             string
  bd_listing_created: boolean | null
}

const PROSPECT_COLUMNS = 'id, phone, business_name, city, state, status, bd_listing_created'

// Word-boundary match so "NOPE" doesn't hit on "no" via substring, while
// "no thanks" and "STOP." still do. Case-insensitive.
export function matchesKeyword(message: string, keywords: string[]): boolean {
  const text = message.toLowerCase()
  return keywords.some(k => new RegExp(`\\b${k}\\b`).test(text))
}

// Looks up a prospect by E.164 phone. Pass `statuses` to restrict the match —
// the TorqueWrench route only claims a message when the prospect is still
// pending or contacted, so a mechanic who already replied can go on to use
// TorqueWrench as a normal subscriber's customer.
export async function findProspectByPhone(
  phone: string,
  statuses?: string[],
): Promise<DirectoryProspect | null> {
  const supabase = createServiceClient()
  const query = supabase.from('directory_prospects').select(PROSPECT_COLUMNS).eq('phone', phone)
  const { data, error } = statuses
    ? await query.in('status', statuses).maybeSingle()
    : await query.maybeSingle()

  if (error) {
    console.error('[directory-agent/reply] prospect lookup failed:', error.message)
    return null
  }
  return (data as DirectoryProspect | null) ?? null
}

// Writes the permanent do-not-contact record and, when we know the prospect,
// moves it to optout. The optouts table is written even for senders with no
// prospect row — it must outlive the prospect record.
export async function recordOptOut(
  phone: string,
  prospect: DirectoryProspect | null,
): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('directory_optouts')
    .upsert(
      { phone, opted_out_at: new Date().toISOString() },
      { onConflict: 'phone', ignoreDuplicates: true },
    )
  if (error) console.error('[directory-agent/reply] optout insert failed:', error.message)

  if (prospect) {
    await supabase
      .from('directory_prospects')
      .update({ status: 'optout', responded_at: new Date().toISOString() })
      .eq('id', prospect.id)
  }

  await sendAgentSms({ to: phone, body: OPTOUT_MESSAGE })
  console.log('[directory-agent/reply] opted out', phone)
}

// Records consent, creates the Brilliant Directories listing, and confirms by
// SMS. On a BD failure the prospect stays 'yes' with bd_listing_created false
// so the admin page surfaces it as a manual retry — and no SMS goes out,
// because we never promise a listing that doesn't exist yet.
export async function acceptProspect(
  phone: string,
  prospect: DirectoryProspect,
  listedMessage: string,
): Promise<void> {
  const supabase = createServiceClient()

  // Idempotent: a second YES must not mint a second BD listing.
  if (prospect.bd_listing_created === true) {
    console.log('[directory-agent/reply] duplicate YES, listing already exists for', phone)
    return
  }

  await supabase
    .from('directory_prospects')
    .update({ status: 'yes', responded_at: new Date().toISOString() })
    .eq('id', prospect.id)

  const businessName = prospect.business_name || 'Mobile Mechanic'

  try {
    const listing = await createAgentListing({
      businessName,
      city:  prospect.city,
      state: prospect.state,
      phone: prospect.phone,
    })

    await supabase
      .from('directory_prospects')
      .update({ bd_listing_created: true, bd_listing_url: listing.listingUrl })
      .eq('id', prospect.id)

    await sendAgentSms({ to: phone, body: listedMessage })
    console.log(`[directory-agent/reply] listed ${businessName} → ${listing.listingUrl}`)
  } catch (err) {
    console.error(
      `[directory-agent/reply] BD listing failed for ${businessName}:`,
      err instanceof Error ? err.message : String(err),
    )
  }
}

// Full reply routing for a known prospect. Opt-out keywords are checked before
// YES so "no thanks" can never be read as consent.
export async function handleProspectReply(
  phone: string,
  message: string,
  prospect: DirectoryProspect,
  listedMessage: string = LISTED_MESSAGE,
): Promise<void> {
  if (matchesKeyword(message, OPT_OUT_KEYWORDS)) {
    await recordOptOut(phone, prospect)
    return
  }

  if (matchesKeyword(message, ['yes'])) {
    await acceptProspect(phone, prospect, listedMessage)
    return
  }

  await sendAgentSms({ to: phone, body: FALLBACK_MESSAGE })
}
