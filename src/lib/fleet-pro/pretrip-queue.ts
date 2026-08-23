// Client-side offline queue for driver pre-trip inspections.
//
// THE RULE THIS FILE EXISTS FOR: a completed inspection is never lost and is never
// reported as sent when it is not. Everything here therefore writes to localStorage
// BEFORE the network is touched, and every read is defensive — a half-written or
// hand-edited localStorage value must degrade to "empty queue", never throw into a
// yard full of drivers.
//
// Browser-only. Guarded with a typeof window check so importing it from a server
// component (or prerendering the page) does not explode.

import type { PretripSubmission, PretripUnitInfo } from '@/types/fleet-pro-partner'

const QUEUE_KEY     = 'nwi.pretrip.queue.v1'
const REJECTED_KEY  = 'nwi.pretrip.rejected.v1'
const UNIT_PREFIX   = 'nwi.pretrip.unit.v1.'
const DRAFT_PREFIX  = 'nwi.pretrip.draft.v1.'
const DRIVER_KEY    = 'nwi.pretrip.driver.v1'

// Storage is finite and a stuck queue must not grow forever. 50 inspections is far
// more than one driver produces between two chances to get signal.
const MAX_QUEUE     = 50
// A 5xx that keeps repeating is a server problem, not a payload problem, but after
// this many tries we stop retrying automatically and surface it instead of looping.
const MAX_ATTEMPTS  = 8

/** Fired on window after any queue mutation so a second tab updates its badge. */
export const PRETRIP_QUEUE_EVENT = 'nwi-pretrip-queue'

export interface QueuedPretrip {
  submission:  PretripSubmission
  queued_at:   string
  attempts:    number
  last_error:  string | null
}

export interface FlushResult {
  sent:      number
  remaining: number
  rejected:  number
  /** True when the flush stopped because the network is unreachable. */
  offline:   boolean
}

// ── storage primitives ────────────────────────────────────────────────────────

function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage
  } catch {
    // Safari in private mode / storage disabled by policy throws on access.
    return false
  }
}

function readJson<T>(key: string, fallback: T): T {
  if (!hasStorage()) return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return (parsed ?? fallback) as T
  } catch {
    // Corrupt value. Leave it in place rather than deleting — it may be salvageable
    // by hand — and behave as if there were nothing there.
    return fallback
  }
}

function writeJson(key: string, value: unknown): boolean {
  if (!hasStorage()) return false
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    // Quota exceeded or storage disabled. The caller decides what to tell the driver;
    // what it must NOT do is assume the write happened.
    return false
  }
}

function notify(): void {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(PRETRIP_QUEUE_EVENT))
  } catch {
    /* dispatch is best-effort UI sugar */
  }
}

// ── ids ───────────────────────────────────────────────────────────────────────

/**
 * Idempotency key, minted on the device BEFORE the first send attempt and reused on
 * every retry. crypto.randomUUID is unavailable in non-secure contexts (a truck yard
 * hitting the app over plain http on a LAN), so there is a fallback — a duplicated
 * submission is a far worse failure than a slightly weaker random id.
 */
export function newClientUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const b = crypto.getRandomValues(new Uint8Array(16))
      b[6] = (b[6] & 0x0f) | 0x40
      b[8] = (b[8] & 0x3f) | 0x80
      const hex = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    }
  } catch {
    /* fall through */
  }
  const rnd = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
  return `${rnd()}${rnd()}-${rnd()}-4${rnd().slice(1)}-a${rnd().slice(1)}-${rnd()}${rnd()}${rnd()}`
}

// ── queue ─────────────────────────────────────────────────────────────────────

function isQueued(value: unknown): value is QueuedPretrip {
  if (!value || typeof value !== 'object') return false
  const sub = (value as QueuedPretrip).submission
  return !!sub && typeof sub === 'object'
    && typeof sub.client_uuid === 'string' && sub.client_uuid.length > 0
    && typeof sub.unit_id === 'string' && sub.unit_id.length > 0
}

/** Everything still waiting to be sent, oldest first. Never throws. */
export function listPretripQueue(): QueuedPretrip[] {
  const raw = readJson<unknown>(QUEUE_KEY, [])
  if (!Array.isArray(raw)) return []
  return raw.filter(isQueued)
}

export function pretripQueueCount(): number {
  return listPretripQueue().length
}

function saveQueue(items: QueuedPretrip[]): boolean {
  const ok = writeJson(QUEUE_KEY, items)
  notify()
  return ok
}

/**
 * Put a completed inspection on the queue. Returns false ONLY when the write did not
 * land — the caller must then refuse to claim the inspection is safe.
 * Re-enqueueing the same client_uuid replaces the existing entry rather than adding a
 * second copy, so a double tap on Submit cannot double-queue.
 */
export function enqueuePretrip(submission: PretripSubmission): boolean {
  const items = listPretripQueue().filter(q => q.submission.client_uuid !== submission.client_uuid)
  items.push({ submission, queued_at: new Date().toISOString(), attempts: 0, last_error: null })
  // Trim from the FRONT: if it ever overflows, the newest inspection is the one that
  // reflects the truck's condition right now.
  const trimmed = items.length > MAX_QUEUE ? items.slice(items.length - MAX_QUEUE) : items
  return saveQueue(trimmed)
}

export function removePretrip(clientUuid: string): void {
  saveQueue(listPretripQueue().filter(q => q.submission.client_uuid !== clientUuid))
}

// ── rejected (dead letter) ────────────────────────────────────────────────────
// A submission the server will never accept (unit deleted, payload refused) must not
// spin in the queue forever, and must not be silently dropped either. It moves here
// so the UI can tell the driver to show it to a manager.

export function listRejectedPretrips(): QueuedPretrip[] {
  const raw = readJson<unknown>(REJECTED_KEY, [])
  if (!Array.isArray(raw)) return []
  return raw.filter(isQueued)
}

export function rejectedPretripCount(): number {
  return listRejectedPretrips().length
}

function reject(entry: QueuedPretrip, reason: string): void {
  const rejected = listRejectedPretrips().filter(q => q.submission.client_uuid !== entry.submission.client_uuid)
  rejected.push({ ...entry, last_error: reason })
  writeJson(REJECTED_KEY, rejected.slice(-MAX_QUEUE))
  removePretrip(entry.submission.client_uuid)
}

export function clearRejectedPretrips(): void {
  writeJson(REJECTED_KEY, [])
  notify()
}

// ── unit info cache ───────────────────────────────────────────────────────────
// The server component hands the client fresh unit info on the first online load;
// this keeps a copy so a cached page render still shows the driver which truck they
// are standing in front of.

export function cachePretripUnit(info: PretripUnitInfo): void {
  if (!info?.unit_id) return
  writeJson(`${UNIT_PREFIX}${info.unit_id}`, info)
}

export function readCachedPretripUnit(unitId: string): PretripUnitInfo | null {
  const info = readJson<PretripUnitInfo | null>(`${UNIT_PREFIX}${unitId}`, null)
  return info && typeof info === 'object' && typeof info.unit_number === 'string' ? info : null
}

// ── in-progress draft ─────────────────────────────────────────────────────────
// A walkaround takes minutes and phones lock, reload and get dropped. The draft is
// re-read on mount so a driver never restarts a 60-point inspection from zero.

export interface PretripDraft {
  version:      number
  answers:      Record<string, string>
  notes:        Record<string, string>
  odometer:     string
  reefer_hours: string
  driver_name:  string
  saved_at:     string
}

export function savePretripDraft(unitId: string, draft: PretripDraft): void {
  writeJson(`${DRAFT_PREFIX}${unitId}`, draft)
}

export function readPretripDraft(unitId: string, version: number): PretripDraft | null {
  const d = readJson<PretripDraft | null>(`${DRAFT_PREFIX}${unitId}`, null)
  if (!d || typeof d !== 'object') return null
  // A draft written against an older item list is discarded rather than partially
  // applied — half-restored answers on a safety checklist are worse than none.
  if (d.version !== version) return null
  return d
}

export function clearPretripDraft(unitId: string): void {
  if (!hasStorage()) return
  try {
    window.localStorage.removeItem(`${DRAFT_PREFIX}${unitId}`)
  } catch {
    /* nothing sensible to do; the next submit overwrites it anyway */
  }
}

/** The driver's name persists across inspections on the same phone — same driver,
 *  same truck, every morning. Convenience only, never an identity claim. */
export function readDriverName(): string {
  const v = readJson<unknown>(DRIVER_KEY, '')
  return typeof v === 'string' ? v : ''
}

export function saveDriverName(name: string): void {
  writeJson(DRIVER_KEY, name.slice(0, 120))
}

// ── flush ─────────────────────────────────────────────────────────────────────

/** Status codes that mean "this payload will never be accepted, stop retrying". */
function isPermanentRejection(status: number): boolean {
  return status === 400 || status === 404 || status === 409 || status === 413 || status === 422
}

async function runFlush(): Promise<FlushResult> {
  const start = listPretripQueue()
  if (start.length === 0) return { sent: 0, remaining: 0, rejected: rejectedPretripCount(), offline: false }

  let sent = 0
  let offline = false

  try {
    for (const entry of start) {
      // Re-read each round: a sibling tab may have sent this one already.
      const stillQueued = listPretripQueue().some(q => q.submission.client_uuid === entry.submission.client_uuid)
      if (!stillQueued) continue

      let res: Response
      try {
        res = await fetch('/api/inspect/submit', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(entry.submission),
          // No credentials: there is no session to send and a QR page should not be
          // carrying anybody's cookies.
          credentials: 'omit',
          cache:       'no-store',
        })
      } catch {
        // Network unreachable. Not the payload's fault, so attempts is NOT burned —
        // stop the loop and leave the whole queue intact for the next online event.
        offline = true
        break
      }

      if (res.ok) {
        removePretrip(entry.submission.client_uuid)
        sent += 1
        continue
      }

      if (isPermanentRejection(res.status)) {
        reject(entry, `Server refused the submission (${res.status}).`)
        continue
      }

      // 5xx or anything unexpected: retry later, but bounded.
      const attempts = entry.attempts + 1
      if (attempts >= MAX_ATTEMPTS) {
        reject(entry, `Gave up after ${attempts} attempts (last status ${res.status}).`)
        continue
      }
      saveQueue(listPretripQueue().map(q =>
        q.submission.client_uuid === entry.submission.client_uuid
          ? { ...q, attempts, last_error: `HTTP ${res.status}` }
          : q,
      ))
    }
  } catch {
    // A flush must never throw into the UI; whatever is left stays queued.
  }

  return { sent, remaining: pretripQueueCount(), rejected: rejectedPretripCount(), offline }
}

// Flushes are triggered from three places at once — mount, the `online` event, tab
// focus (and the service worker's own sync on top of that). They are SERIALIZED
// rather than deduped: a caller that just enqueued a submission must get a run that
// STARTS after any in-flight run has finished, because an in-flight run already
// snapshotted the queue and would not see the new entry. Deduping ("a flush is
// already running, join it") would silently skip it.
let chain: Promise<FlushResult> = Promise.resolve({ sent: 0, remaining: 0, rejected: 0, offline: false })

/**
 * Try to send everything on the queue. Safe to call at any time from anywhere;
 * returns counts rather than throwing so the caller can render a state instead of an
 * error boundary.
 *
 * IDEMPOTENCY: each entry keeps the client_uuid it was minted with, so a replay of an
 * entry that actually landed (response lost, tab killed mid-request, service-worker
 * sync racing this call) is answered 200 by the server and simply dequeued here.
 */
export function flushPretripQueue(): Promise<FlushResult> {
  chain = chain.then(runFlush, runFlush)
  return chain
}

export type PretripSubmitState = 'sent' | 'queued' | 'rejected' | 'unsaved'

/**
 * Enqueue then immediately try to send. Returns 'sent' ONLY when the server actually
 * confirmed it. Anything else is reported as what it is: 'queued' (saved on this
 * device, will send later), 'rejected' (the server refused it — a human has to look),
 * or 'unsaved' (localStorage itself refused the write, so nothing is safe).
 */
export async function submitPretrip(
  submission: PretripSubmission,
): Promise<{ state: PretripSubmitState; queued: number }> {
  // Queue FIRST. If the POST below succeeds we drop it again a moment later; if the
  // browser is killed mid-request the inspection is already on disk.
  const stored = enqueuePretrip(submission)
  if (!stored) return { state: 'unsaved', queued: pretripQueueCount() }

  const result = await flushPretripQueue()
  const uuid = submission.client_uuid
  if (listPretripQueue().some(q => q.submission.client_uuid === uuid)) {
    return { state: 'queued', queued: result.remaining }
  }
  // Gone from the queue is not automatically success — a permanent rejection also
  // dequeues, into the dead letter list. Check there before claiming it was sent.
  if (listRejectedPretrips().some(q => q.submission.client_uuid === uuid)) {
    return { state: 'rejected', queued: result.remaining }
  }
  return { state: 'sent', queued: result.remaining }
}
