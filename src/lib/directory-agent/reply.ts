// Shared handling for inbound directory-agent SMS replies.
//
// Three webhooks can receive these: /api/directory-agent/webhook (LD outreach
// number), /api/hd-directory-agent/webhook (HD outreach number), and
// /api/torquewrench/sms-response, which fronts the shared inbound number and
// checks both prospect tables before falling through to review handling.
//
// Everything that differs between the LD and HD agents — which tables to read,
// which number to text from, the copy, and how a listing gets created — is
// carried in a DirectoryVariant, so a YES creates a listing the same way no
// matter which agent or endpoint it arrived through. The variants themselves
// live in ./variant.ts (LD) and ../hd-directory-agent/variant.ts (HD).

import { createServiceClient } from '@/lib/supabase/service'
import { sendAgentSms } from './sms'

export const OPT_OUT_KEYWORDS = ['stop', 'no', 'unsubscribe', 'cancel', 'end', 'quit']

export interface DirectoryProspect {
  id:                 string
  phone:              string
  business_name:      string | null
  city:               string | null
  state:              string | null
  status:             string
  bd_listing_created: boolean | null
  // HD only — absent on LD prospects.
  service_category?:  string | null
}

export interface DirectoryVariant {
  /** Log prefix and disambiguator, e.g. 'directory-agent' / 'hd-directory-agent'. */
  label:           string
  prospectsTable:  string
  optoutsTable:    string
  /** Columns to select for a prospect; must cover DirectoryProspect. */
  prospectColumns: string
  /** Resolved lazily so env changes don't need a redeploy of this module. */
  fromNumber:      () => string
  listedMessage:   string
  optOutMessage:   string
  fallbackMessage: string
  /** Creates the Brilliant Directories listing for this directory. */
  createListing:   (prospect: DirectoryProspect) => Promise<{ listingUrl: string }>
}

// Word-boundary match so "NOPE" doesn't hit on "no" via substring, while
// "no thanks" and "STOP." still do. Case-insensitive.
export function matchesKeyword(message: string, keywords: string[]): boolean {
  const text = message.toLowerCase()
  return keywords.some(k => new RegExp(`\\b${k}\\b`).test(text))
}

// Looks up a prospect by E.164 phone. Pass `statuses` to restrict the match —
// the TorqueWrench route only claims a message when the prospect is still
// pending or contacted, so a provider who already replied can go on to be a
// subscriber's reviewing customer.
export async function findProspectByPhone(
  variant: DirectoryVariant,
  phone: string,
  statuses?: string[],
): Promise<DirectoryProspect | null> {
  const supabase = createServiceClient()
  const query = supabase
    .from(variant.prospectsTable)
    .select(variant.prospectColumns)
    .eq('phone', phone)
  const { data, error } = statuses
    ? await query.in('status', statuses).maybeSingle()
    : await query.maybeSingle()

  if (error) {
    console.error(`[${variant.label}/reply] prospect lookup failed:`, error.message)
    return null
  }
  return (data as DirectoryProspect | null) ?? null
}

// Writes the permanent do-not-contact record and, when we know the prospect,
// moves it to optout. The optouts table is written even for senders with no
// prospect row — it must outlive the prospect record.
export async function recordOptOut(
  variant: DirectoryVariant,
  phone: string,
  prospect: DirectoryProspect | null,
): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from(variant.optoutsTable)
    .upsert(
      { phone, opted_out_at: new Date().toISOString() },
      { onConflict: 'phone', ignoreDuplicates: true },
    )
  if (error) console.error(`[${variant.label}/reply] optout insert failed:`, error.message)

  if (prospect) {
    await supabase
      .from(variant.prospectsTable)
      .update({ status: 'optout', responded_at: new Date().toISOString() })
      .eq('id', prospect.id)
  }

  await sendAgentSms({ to: phone, body: variant.optOutMessage, from: variant.fromNumber() })
  console.log(`[${variant.label}/reply] opted out`, phone)
}

// Records consent, creates the Brilliant Directories listing, and confirms by
// SMS. On a BD failure the prospect stays 'yes' with bd_listing_created false
// so the admin page surfaces it as a manual retry — and no SMS goes out,
// because we never promise a listing that doesn't exist yet.
export async function acceptProspect(
  variant: DirectoryVariant,
  phone: string,
  prospect: DirectoryProspect,
  listedMessage: string,
): Promise<void> {
  const supabase = createServiceClient()

  // Idempotent: a second YES must not mint a second BD listing.
  if (prospect.bd_listing_created === true) {
    console.log(`[${variant.label}/reply] duplicate YES, listing already exists for`, phone)
    return
  }

  await supabase
    .from(variant.prospectsTable)
    .update({ status: 'yes', responded_at: new Date().toISOString() })
    .eq('id', prospect.id)

  const businessName = prospect.business_name || 'Mobile Mechanic'

  try {
    const listing = await variant.createListing(prospect)

    await supabase
      .from(variant.prospectsTable)
      .update({ bd_listing_created: true, bd_listing_url: listing.listingUrl })
      .eq('id', prospect.id)

    await sendAgentSms({ to: phone, body: listedMessage, from: variant.fromNumber() })
    console.log(`[${variant.label}/reply] listed ${businessName} → ${listing.listingUrl}`)
  } catch (err) {
    console.error(
      `[${variant.label}/reply] BD listing failed for ${businessName}:`,
      err instanceof Error ? err.message : String(err),
    )
  }
}

// Full reply routing for a known prospect. Opt-out keywords are checked before
// YES so "no thanks" can never be read as consent.
export async function handleProspectReply(
  variant: DirectoryVariant,
  phone: string,
  message: string,
  prospect: DirectoryProspect,
  listedMessage: string = variant.listedMessage,
): Promise<void> {
  if (matchesKeyword(message, OPT_OUT_KEYWORDS)) {
    await recordOptOut(variant, phone, prospect)
    return
  }

  if (matchesKeyword(message, ['yes'])) {
    await acceptProspect(variant, phone, prospect, listedMessage)
    return
  }

  await sendAgentSms({ to: phone, body: variant.fallbackMessage, from: variant.fromNumber() })
}
