/**
 * Retries Brilliant Directories listing creation for prospects who consented
 * but whose listing failed at the time.
 *
 * Run:
 *   npm run retry-listings -- --dry-run   # report what would be retried
 *   npm run retry-listings                # retry for real
 *   npm run retry-listings -- --no-sms    # retry without the confirmation SMS
 *
 * Targets status='yes' AND bd_listing_created=false in both directory_prospects
 * (LD) and hd_directory_prospects (HD) — the exact state the webhooks leave
 * behind when BD errors: consent is recorded, the listing is not, and no
 * confirmation SMS was sent because we never promise a listing that failed.
 *
 * On success it sends that overdue confirmation, since these people replied YES
 * and have been waiting on it. --no-sms suppresses that if the delay makes a
 * "you are listed" text more confusing than helpful.
 *
 * Safe to re-run: a row that succeeds flips to bd_listing_created=true and is
 * not selected again.
 */

import { loadEnvConfig } from '@next/env'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createAgentListing } from '../lib/directory-agent/bd'
import { createHdListing } from '../lib/hd-directory-agent/bd'
import { isAutoListCategory } from '../lib/hd-directory-agent/config'

loadEnvConfig(process.cwd())

const BD_DELAY_MS = 500

// Inlined rather than imported from the agent configs: those modules pull in
// next/server and the request-scoped Supabase client, which do not exist in a
// standalone script. Same reasoning as src/scripts/import-truck-stops.ts.
// Keep these byte-identical to LISTED_MESSAGE in src/lib/directory-agent/config.ts
// and HD_LISTED_MESSAGE in src/lib/hd-directory-agent/config.ts. The LD copy had
// already drifted — it still described the pre-email-collection flow, telling
// mechanics to log in without saying where their credentials went.
const LD_LISTED_MESSAGE =
  'You are listed on National Wrench Index. Search your business name at nationalwrenchindex.com ' +
  'to find your profile. Check your email for login details so you can add photos and services. - Brock'

const HD_LISTED_MESSAGE =
  'You are listed on NWI HD. Search your business name at nwihd.com to find your profile. ' +
  'Fleet managers and drivers will find you when they need help on the road. Welcome. - Brock'

const LD_FROM = () => process.env.DIRECTORY_AGENT_FROM_NUMBER ?? '+13367294181'
const HD_FROM = () =>
  process.env.HD_DIRECTORY_AGENT_FROM_NUMBER ??
  process.env.DIRECTORY_AGENT_FROM_NUMBER ??
  '+13362761896'

interface Prospect {
  id:               string
  business_name:    string | null
  phone:            string
  city:             string | null
  state:            string | null
  service_category?: string | null
}

interface Variant {
  label:          string
  table:          string
  columns:        string
  listedMessage:  string
  from:           () => string
  create:         (p: Prospect) => Promise<{ listingUrl: string }>
}

const VARIANTS: Variant[] = [
  {
    label:         'LD',
    table:         'directory_prospects',
    columns:       'id, business_name, phone, city, state',
    listedMessage: LD_LISTED_MESSAGE,
    from:          LD_FROM,
    create: p => createAgentListing({
      businessName: p.business_name || 'Mobile Mechanic',
      city:         p.city,
      state:        p.state,
      phone:        p.phone,
    }),
  },
  {
    label:         'HD',
    table:         'hd_directory_prospects',
    columns:       'id, business_name, phone, city, state, service_category',
    listedMessage: HD_LISTED_MESSAGE,
    from:          HD_FROM,
    create: p => createHdListing({
      businessName:    p.business_name || 'Heavy Duty Service',
      city:            p.city,
      state:           p.state,
      phone:           p.phone,
      serviceCategory: p.service_category ?? null,
    }),
  },
]

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// ===========================================================================
// sendSms - REMOVED 2026-10-08. This was a SECOND WAY TO SEND.
// ===========================================================================
//
// This script called Twilio directly instead of going through sendAgentSms, so
// disabling the directory-agent sender did NOT stop it. It is run by hand
// (npm run retry-listings) and has no cron - but "no scheduler" is not "cannot send".
//
// The body is deleted rather than guarded, because a guarded body is one deleted line
// away from sending again. The Brilliant Directories listing retry in this script is
// untouched: it writes a listing, not a text message. Running with or without --no-sms
// now does the same thing.
//
// See src/lib/directory-agent/sms.ts for what happened and why.
async function sendSms(to: string, body: string, from: string): Promise<{ ok: boolean; error?: string }> {
  void body
  console.error(
    `[retry-listings] SMS REFUSED: cold outreach is permanently disabled (2026-10-08). ` +
    `Would have texted ${to.replace(/\d(?=\d{4})/g, '*')} from ${from} - not sent.`,
  )
  return { ok: false, error: "Cold outreach is permanently disabled." }
}

async function main() {
  const args    = process.argv.slice(2)
  const dryRun  = args.includes('--dry-run')
  const noSms   = args.includes('--no-sms')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log('─'.repeat(72))
  console.log(`Retry BD listings${dryRun ? '  [DRY RUN — nothing will be written]' : ''}${noSms ? '  [SMS suppressed]' : ''}`)
  console.log('─'.repeat(72))

  let created = 0, failed = 0, smsSent = 0, smsFailed = 0

  for (const variant of VARIANTS) {
    const { data, error } = await supabase
      .from(variant.table)
      .select(variant.columns)
      .eq('status', 'yes')
      .eq('bd_listing_created', false)

    if (error) {
      console.error(`[${variant.label}] load failed: ${error.message}`)
      continue
    }

    const rows = (data ?? []) as unknown as Prospect[]
    console.log(`\n[${variant.label}] ${variant.table}: ${rows.length} awaiting retry`)
    if (rows.length === 0) continue

    for (const [i, p] of rows.entries()) {
      const name = p.business_name || '(no name)'
      const loc  = [p.city, p.state].filter(Boolean).join(', ') || '—'
      console.log(`  [${i + 1}/${rows.length}] ${name} — ${loc} — ${p.phone}`)

      if (dryRun) {
        console.log('           would create listing' + (noSms ? '' : ' + send confirmation SMS'))
        continue
      }

      try {
        const listing = await variant.create(p)

        const { error: updErr } = await supabase
          .from(variant.table)
          .update({ bd_listing_created: true, bd_listing_url: listing.listingUrl })
          .eq('id', p.id)

        if (updErr) {
          // Listing exists but we could not record it — say so loudly, otherwise
          // the next run creates a duplicate.
          failed++
          console.error(`           ! LISTING CREATED but DB update failed: ${updErr.message}`)
          continue
        }

        created++
        console.log(`           ✓ listed → ${listing.listingUrl}`)

        // Venues are auto-listed places, not businesses that asked to be here.
        // Texting one a "you are listed" confirmation would be the first
        // message they ever received from us. Suppressed regardless of --no-sms.
        const isVenue = isAutoListCategory(p.service_category)
        if (isVenue) {
          console.log('           · venue — no SMS')
        } else if (!noSms) {
          const sms = await sendSms(p.phone, variant.listedMessage, variant.from())
          if (sms.ok) { smsSent++; console.log('           ✓ confirmation SMS sent') }
          else        { smsFailed++; console.error(`           ! SMS failed: ${sms.error}`) }
        }
      } catch (err) {
        failed++
        console.error(`           ✗ ${err instanceof Error ? err.message : String(err)}`)
      }

      if (i < rows.length - 1) await sleep(BD_DELAY_MS)
    }
  }

  console.log('')
  console.log('─'.repeat(72))
  console.log('SUMMARY')
  console.log(`  Listings created: ${created}`)
  console.log(`  Failed:           ${failed}`)
  if (!dryRun && !noSms) {
    console.log(`  SMS sent:         ${smsSent}`)
    console.log(`  SMS failed:       ${smsFailed}`)
  }
  console.log('─'.repeat(72))
}

main().catch(err => {
  console.error('Retry aborted:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
