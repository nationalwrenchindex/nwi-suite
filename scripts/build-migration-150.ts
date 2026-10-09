// Generate migration 150 from the REAL data, rather than typing 32 numbers by hand.
//
// Reads data/outreach/do-not-contact.csv plus both existing opt-out tables, and emits
// plain-ASCII SQL that creates do_not_contact and seeds it. Writing the migration this
// way means the file cannot disagree with the export it came from.

import fs from 'fs'
import path from 'path'
import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

interface Entry { phone: string; at: string; reason: string; evidence: string }

function readCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false }
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = [] }
    else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const header = rows.shift()!
  return rows.filter(r => r.some(v => v.trim())).map(r =>
    Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

// SQL string literal. Single quotes doubled; everything non-ASCII stripped, because
// every migration here is plain 7-bit ASCII and a smart quote in an evidence string
// would break that rule inside a string literal.
function lit(v: string): string {
  const ascii = v.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim()
  return `'${ascii.replace(/'/g, "''")}'`
}

async function main() {
  const csvPath = path.join('data', 'outreach', 'do-not-contact.csv')
  const rows = readCsv(csvPath)

  const byPhone = new Map<string, Entry>()
  for (const r of rows) {
    byPhone.set(r.phone, {
      phone: r.phone,
      at: r.opted_out_at,
      reason: r.reasons,
      evidence: r.evidence.slice(0, 300),
    })
  }

  // The existing opt-out tables, so nothing already recorded is lost.
  for (const table of ['directory_optouts', 'hd_directory_optouts']) {
    const res = await fetch(`${S}/rest/v1/${table}?select=phone,opted_out_at`, { headers: H })
    if (!res.ok) { console.error(`${table} -> ${res.status}`); continue }
    for (const r of await res.json() as Array<Record<string, unknown>>) {
      const phone = String(r.phone)
      if (byPhone.has(phone)) continue
      byPhone.set(phone, {
        phone,
        at: String(r.opted_out_at),
        reason: `migrated_from_${table}`,
        evidence: `Carried over from ${table} on 2026-10-08.`,
      })
    }
  }

  const entries = [...byPhone.values()].sort((a, b) => a.phone.localeCompare(b.phone))
  const valid = entries.filter(e => /^\+[1-9][0-9]{9,14}$/.test(e.phone))
  const skipped = entries.filter(e => !/^\+[1-9][0-9]{9,14}$/.test(e.phone))

  const values = valid.map(e =>
    `  (${lit(e.phone)}, ${lit(e.at)}, ${lit(e.reason)}, ${lit(e.evidence)})`,
  ).join(',\n')

  const sql = `-- =============================================================================
-- 150  do_not_contact - the block that lives in the database
-- =============================================================================
--
-- ADDITIVE ONLY. One new table, one function, no existing row touched, nothing
-- dropped. Safe to run twice.
--
-- -- WHY THIS EXISTS -------------------------------------------------------
--
-- 32 numbers opted out of the directory outreach programme between 2026-06-30 and
-- 2026-10-04. One received 36 messages before replying STOP. One received 8 and then
-- had FOUR MORE SENDS ATTEMPTED AFTER its STOP; Twilio refused them with error 21610.
--
-- The opt-out WAS recorded - in directory_optouts and hd_directory_optouts - and the
-- send path never read either table. The check existed only on the inbound reply
-- handler, so an opt-out stopped nothing on the way out.
--
-- At the moment of the shutdown, +16154963900 had been texted 16 times, had already
-- produced a 21610, and was STILL sitting at status='pending' - selected for the next
-- daily batch.
--
-- -- WHAT MAKES THIS DIFFERENT FROM THE TABLES WE ALREADY HAD ---------------
--
-- Nothing about the table. Everything about who reads it. The application's send
-- wrapper now consults this table BEFORE every outbound message and refuses, and it
-- FAILS CLOSED: if this table cannot be read, no message is sent. A guard that lets
-- messages through when the database is unreachable is not a guard.
--
-- One table for every product, every campaign and every message type, so a number
-- blocked once is blocked everywhere. The two old tables stay exactly as they are -
-- they are evidence, and this seeds itself from them.

BEGIN;

CREATE TABLE IF NOT EXISTS public.do_not_contact (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- E.164. UNIQUE, so a second opt-out from the same number cannot create a row that
  -- some query then misses.
  phone         TEXT        NOT NULL UNIQUE,

  -- When they asked. Kept from the original evidence rather than defaulted to now(),
  -- because if a complaint ever arrives the date they asked is the whole argument.
  opted_out_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- How we know. 'twilio_21610_unsubscribed', 'replied_stop_bare_keyword',
  -- 'app_database_optout', 'migrated_from_directory_optouts', and so on.
  reason        TEXT        NOT NULL,

  -- The quoted message or the refusal that proves it. This is the defence.
  evidence      TEXT,

  -- A number may be blocked by a person rather than by a reply.
  blocked_by    TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.do_not_contact IS
  'Numbers that must never receive an outbound message, for any product or message type. Read by the application send wrapper before every send, which fails closed if this table is unreadable. Never delete a row to resume contact without reading the evidence column first.';

COMMENT ON COLUMN public.do_not_contact.opted_out_at IS
  'When the person asked, not when the row was written. Seeded from the original Twilio and application timestamps.';

COMMENT ON COLUMN public.do_not_contact.evidence IS
  'The quoted reply or the Twilio refusal behind this row. Kept verbatim because it is what we would show a regulator.';

CREATE INDEX IF NOT EXISTS do_not_contact_phone_idx ON public.do_not_contact (phone);

-- -----------------------------------------------------------------------------
-- The seed. ${valid.length} numbers.
-- -----------------------------------------------------------------------------
-- ON CONFLICT DO NOTHING so re-running keeps the EARLIEST recorded opt-out rather
-- than overwriting it with a later import.
INSERT INTO public.do_not_contact (phone, opted_out_at, reason, evidence) VALUES
${values}
ON CONFLICT (phone) DO NOTHING;

-- -----------------------------------------------------------------------------
-- sms_send_log - what the frequency cap counts
-- -----------------------------------------------------------------------------
--
-- The 36-message number was reached one text at a time, by a daily job, with nothing
-- anywhere counting how many had already gone. A cap needs a count, and a count needs
-- a row per send.
--
-- This is NOT a replacement for Twilio's own history, which stays the authoritative
-- record. It exists so the guard can answer "how many has this number had this week"
-- without an API call on the send path.
CREATE TABLE IF NOT EXISTS public.sms_send_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      TEXT        NOT NULL,
  -- What kind of message: 'booking_confirmation', 'appointment_reminder',
  -- 'invoice_sent', and so on. Makes it possible to see at a glance whether a spike is
  -- transactional or something that should not be running at all.
  kind       TEXT        NOT NULL,
  twilio_sid TEXT,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sms_send_log_phone_time_idx
  ON public.sms_send_log (phone, sent_at DESC);

COMMENT ON TABLE public.sms_send_log IS
  'One row per outbound SMS, written by the send guard so a per-number frequency cap can be enforced. Append only. Do not delete rows: with Twilio history this is the evidence of what was sent to whom and when.';

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
ALTER TABLE public.do_not_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_send_log   ENABLE ROW LEVEL SECURITY;

-- No policy at all on sms_send_log: service role only. It is an audit trail, and no
-- subscriber has a reason to read or alter other people's message history.

-- Readable by any signed-in user so the application can check it. Deliberately NO
-- insert, update or delete policy: writes go through the service role. A subscriber
-- must not be able to delete someone else's opt-out.
DROP POLICY IF EXISTS "Authenticated read do_not_contact" ON public.do_not_contact;
CREATE POLICY "Authenticated read do_not_contact"
  ON public.do_not_contact FOR SELECT TO authenticated USING (true);

-- -----------------------------------------------------------------------------
-- Check it
-- -----------------------------------------------------------------------------
-- Expect ${valid.length}, and 0.
SELECT (SELECT count(*) FROM public.do_not_contact) AS do_not_contact_rows,
       (SELECT count(*) FROM public.sms_send_log)   AS sms_send_log_rows;

-- Expect zero rows: every phone must be E.164.
SELECT phone FROM public.do_not_contact WHERE phone !~ '^\\+[1-9][0-9]{9,14}$';

-- Expect zero rows: nothing in the old opt-out tables should be missing from here.
SELECT o.phone, 'directory_optouts' AS missing_from_dnc
FROM   public.directory_optouts o
WHERE  NOT EXISTS (SELECT 1 FROM public.do_not_contact d WHERE d.phone = o.phone)
UNION ALL
SELECT o.phone, 'hd_directory_optouts'
FROM   public.hd_directory_optouts o
WHERE  NOT EXISTS (SELECT 1 FROM public.do_not_contact d WHERE d.phone = o.phone);

-- Expect two rows: do_not_contact and sms_send_log.
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('do_not_contact', 'sms_send_log')
ORDER BY table_name;

-- How each row got here.
SELECT reason, count(*) AS rows
FROM   public.do_not_contact
GROUP  BY reason
ORDER  BY rows DESC;

-- The oldest and newest opt-out, so the span is on the record.
SELECT min(opted_out_at) AS earliest, max(opted_out_at) AS latest
FROM   public.do_not_contact;

COMMIT;
`

  const out = path.join('supabase', 'migrations', '150_do_not_contact.sql')
  fs.writeFileSync(out, sql)

  let nonAscii = 0
  for (const b of fs.readFileSync(out)) if (b > 127) nonAscii++

  console.log(`\nwrote ${out}`)
  console.log(`  numbers seeded ....... ${valid.length}`)
  console.log(`  skipped (not E.164) .. ${skipped.length}${skipped.length ? ': ' + skipped.map(s => s.phone).join(', ') : ''}`)
  console.log(`  non-ASCII bytes ...... ${nonAscii}`)
  console.log(`  last line ............ ${sql.trimEnd().split('\n').pop()}`)
  const reasons = new Map<string, number>()
  valid.forEach(e => reasons.set(e.reason, (reasons.get(e.reason) ?? 0) + 1))
  console.log('  by reason:')
  for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)}  ${r}`)
}

main().catch(e => { console.error(e); process.exitCode = 1 })
