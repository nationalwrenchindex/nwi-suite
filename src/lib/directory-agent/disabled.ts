// The cold-outreach shutdown, as one importable refusal.
//
// 2026-10-08. See src/lib/directory-agent/sms.ts for what happened and why.
//
// sendAgentSms already refuses, which is the kill that matters - it is the single
// chokepoint every outreach path goes through. This exists so the ROUTES refuse too,
// before they read a prospect list, iterate it, or write a contacted_at. Two reasons:
//
//   1. A route that loops 25 prospects calling a refusing sender still logs 25
//      failures a day and still looks like a system trying to send. Refusing at the
//      door makes the shutdown visible in one line of logs instead of buried in
//      failures that read like a Twilio outage.
//
//   2. The invite route marks a prospect 'contacted' based on the send result. With
//      the sender refusing, that is harmless - but a future edit to the error handling
//      could make it start stamping contacted_at on people it never texted, and the
//      database is the record we would defend ourselves with.

import { NextResponse } from 'next/server'

export const COLD_OUTREACH_DISABLED_AT = '2026-10-08'

/**
 * The response every cold-outreach route returns now.
 *
 * 410 Gone, not 503: 503 means "try again later" and a scheduler would. This endpoint
 * is not coming back.
 */
export function coldOutreachDisabled(route: string): NextResponse {
  console.error(`[${route}] REFUSED: cold outreach permanently disabled ${COLD_OUTREACH_DISABLED_AT}`)
  return NextResponse.json(
    {
      error: 'Cold outreach is permanently disabled.',
      disabled_at: COLD_OUTREACH_DISABLED_AT,
      detail:
        'Unsolicited SMS to businesses that never opted in is discontinued. ' +
        'Transactional messaging to people who provided their number is unaffected.',
      sent: 0,
      failed: 0,
    },
    { status: 410 },
  )
}
