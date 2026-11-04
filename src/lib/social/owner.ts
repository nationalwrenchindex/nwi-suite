import { NextResponse } from 'next/server'

// NWI Social writes marketing posts FOR NWI SUITE ITSELF. It belongs to the founder
// account and nobody else: the daily cron used to generate a batch for every active
// or trialing subscriber, which put NWI's own marketing drafts into subscriber
// accounts (11 accounts on Nov 4, 2026, some never logged into). Every route, the
// page and the cron check this one id.
export const SOCIAL_OWNER_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

export function isSocialOwner(userId: string | null | undefined): boolean {
  return userId === SOCIAL_OWNER_ID
}

/** 403 for anyone signed in who is not the owner; null for the owner. */
export function denyUnlessSocialOwner(userId: string): NextResponse | null {
  return isSocialOwner(userId) ? null : NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
