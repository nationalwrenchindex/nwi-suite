// ===========================================================================
// directory-agent/invite - PERMANENTLY DISABLED 2026-10-08
// ===========================================================================
//
// WHAT THIS USED TO DO
//
// Sent the cold permission SMS to the highest-rated pending LD prospects, 25 per daily cron run.
//
// WHY IT IS GONE
//
// 32 numbers opted out of this programme between 2026-06-30 and 2026-10-04. One
// received 36 messages before replying STOP; another 16; one received 8 and then had
// FOUR MORE SENDS ATTEMPTED AFTER its STOP, which Twilio refused with error 21610.
//
// The cause was in the invite route's own design, documented at length in
// src/lib/directory-agent/sms.ts:
//
//   * nothing on the send path ever consulted directory_optouts
//   * a failed send deliberately left the prospect 'pending' so the DAILY cron would
//     retry it, with no attempt counter and no cap
//   * error 21610 ("recipient has unsubscribed") was returned as a generic failure and
//     therefore retried like a network blip
//
// THE BODY OF THIS ROUTE HAS BEEN REMOVED, not commented out. A disabled route whose
// send loop is still sitting under an early return is one deleted line away from
// running again. The implementation is in git history if a FUTURE OPT-IN programme
// ever needs it as a reference - it must not be restored as-is.
//
// Its Vercel cron entry has also been removed from vercel.json.
//
// Transactional SMS is unaffected: booking confirmations, appointment reminders,
// invoice and quote sends, and work-order status updates all go through
// src/lib/twilio.ts and src/lib/notifications.ts to people who gave us their number.

import { coldOutreachDisabled } from '@/lib/directory-agent/disabled'

export const dynamic = 'force-dynamic'

export async function POST() {
  return coldOutreachDisabled('directory-agent/invite POST')
}

// Vercel crons call GET. Kept so a stale cron definition anywhere gets the same 410
// rather than a 405 that might read as a deployment fault worth fixing.
export async function GET() {
  return coldOutreachDisabled('directory-agent/invite GET')
}
