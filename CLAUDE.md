# NWI Suite — working rules

## Deployment - do not re-derive this

- Production is **MANUAL PROMOTE** in Vercel. Pushing to master creates a **PREVIEW**
  deployment only.
- Never say "live", "deployed" or "went live" about a push.
- Never poll tools.nationalwrenchindex.com expecting new code after a push - it 404s
  until Brock clicks Promote. This cost two days on Oct 6-8 and recurred three times
  on Oct 13.

## Environment

- **`gh` is NOT installed on this machine.** Do not use it. Brock reads Vercel and
  GitHub from the dashboard himself.
- Brock applies migrations **by hand** in the Supabase SQL editor. Claude Code cannot
  see which are applied - **ask, never assume.**

## Testing

- **Test fixtures must be built from a real row, not an assumed shape.** A wrong
  fixture passes forever while proving nothing - on Oct 14 a part fixture used a shape
  the product cannot produce, which is why a doubled markup survived every run of a
  flow that converted a part line.
- **Column names mean opposite things in different tables.**
  - `hd_quotes.line_items`: `unit_cost` is the **SELL** price, `unit_cost_base` is cost.
  - `hd_work_order_line_items`: `unit_cost` is the **cost**, `unit_price` is the sell.

  This caused the Oct 14 double markup. `wo-to-invoice.ts` documents it; nothing else did.

## Before reporting any work complete

Run the smoke suite against the deployed site and paste the table.

```
npm run smoke
```

**A change is not done until the smoke suite is green.**

A cold build must also pass:

```
rm -rf .next && npm run build
```

**A warm `.next` hides out-of-memory failures that break the Vercel build.** This is not
hypothetical: every build reported "clean" during one session came from a warm cache, and
the cold build was failing with `JavaScript heap out of memory` the whole time. The
deployment sat on old code for an hour while fixes were reported as shipped.

## Why the smoke suite exists

There are ~800 assertions under `scripts/`, and almost all of them test the calculator or
the database — the two things that are usually right. Nothing checked that a **screen**
still works, so every change had a free shot at breaking a button, and the only detector
was the shop owner clicking around in front of a paying subscriber. Three buttons broke
that way in one week.

`npm run smoke` walks the critical flows as a real logged-in user against the deployed
site and reads the rendered HTML. It covers: work order (both pricing modes), convert to
invoice, invoice in progress, finalize, reopen, the customer copy, quotes, and mark as
paid — plus the HD forms and invoice views.

Point it at a preview deployment with `PAGECHECK_BASE`:

```
PAGECHECK_BASE=https://nwi-suite-git-branch.vercel.app npm run smoke
```

## Rules the suite holds itself to, and so should any check added to it

- A route that will not load is a **FAILURE**, never a skip.
- A step that cannot run is a **FAILURE**, and the table says what was missing.
- Controls are asserted against **rendered HTML**, never against source. A control can
  exist in the source and still not render — the travel inputs sat inside an `owns`-gated
  section and were absent from exactly the work orders that needed them.
- **No assertion that cannot fail**, and none that cannot pass either. A check asserting a
  route that does not exist by design made the suite permanently red over a design
  decision, which is how a suite gets ignored.
- Every row it creates is deleted in a `finally` block. A test that litters production a
  little more each run is a test people stop running.
- **Never loosen a check to get green.** If a flow cannot be driven, it fails and says why.
  Correcting an assertion that was wrong about the app is not loosening — but say plainly
  which it was.

## Part numbers - Brock's rules, ground truth, do not re-derive

From 17 years in the trade (Oct 28, 2026):

- **Thermo King OEM:** 6 digits, dash after the first two. `11-9959`
- **Carrier Transicold:** 9 digits, dashes after the first two and before the last two.
  `30-60143-01`
- **A leading `37-` is a vendor's catalog addition, NOT part of the number. Strip it.**
  `37-11-9959` IS `11-9959`, the same part.
- **A leading `20-` on a TK number** is Carrier selling an aftermarket part for a TK
  application. `20-11-9959` relates to TK `11-9959`.
- **An `8` added to the front of the first segment means reman.** `845-1234` is the reman
  of OEM-new `45-1234`.
- **A lost leading zero is damaged data, not a different part.** `78-603` and `78-0603`
  are the SAME part; the canonical form keeps the zero. A TK number is six digits - two,
  a dash, four. `78-603` lost its zero in an import.
  - Pad back exactly ONE zero: TK `78-603` -> `78-0603`, `8-1234` -> `08-1234`; Carrier
    `30-60143-1` -> `30-60143-01`.
  - Never pad a Carrier MIDDLE segment (`30-6143-01` could be a different part with a
    digit lost anywhere), a number short in two places (`8-603`), or bare digits
    (`78603` - no telling which segment lost it). Report those; do not guess.

Every parts search and every parts import goes through one function:
`parsePartNumber` in `src/lib/parts/part-number.ts` (tests: `npx tsx
scripts/verify-part-number.ts`). Only the `37-` rule changes what a number IS. `20-` and
reman are recognized and reported but **never merged, linked or rewritten** - whether they
merge, cross-reference or stay separate is Brock's decision, not code's.

- **A vendor listing's condition marker is not part of the number** (Oct 29). `845-2648-U`
  is a USED `845-2648`. The suffixes `-U`, `-R`, `-RB`, `-K`, `SV` and the vendor prefixes
  `CA-`, `CTK-` (can.ca's own) come off, and the base number goes through
  `parsePartNumber`. `parseListingNumber` does this for IMPORTS only: the condition is
  reported beside the base part, never loaded as a distinct part, and search is unchanged.
- **Reman and OEM-new are RELATED, never the same part** - link them, never merge them.

Not covered by the rules, so never guessed at: other suffixes (`SL`, `RM`, `PB`, `SRV`,
`KIT`, `SS`, `FA`, `E`), and shapes that fit no rule (`306-221`, `204-2436`, `18-00091-105`, `96-153-01K`) -
those stay exactly as written and are matched as written.

## Money rules that are settled, do not re-litigate

- **Tax is rounded per bucket where it is first agreed, then summed — never recomputed.**
  The work order rounds each segment; the invoice carries those figures and prices only
  what has been added since. Re-deriving lands a cent or two from what the customer
  approved.
- **Travel** is taxed as labour. **Shop supplies** is taxed as parts. **Mileage is not
  taxed at all** — it is reimbursement of a cost, not a sale. It still belongs in the
  subtotal.
- **Shop supplies is a percentage of the post-markup parts total only.** Never labour,
  never travel, never mileage, never a diagnostic or road-call fee. Capped if a cap is set.
  Zero parts means no line at all.
- **A document's recorded rates beat current settings.** A saved price is never recomputed
  from a setting that has changed since. This includes the billing *flags*: a recorded
  percentage proves the document bills that extra.
- **An invoice must never display a charge that is not inside its total.** `extrasAgree`
  enforces it at convert, at save and on the in-progress screen.
- Mileage at $2.00/mi is a mobile call-out rate, not an IRS reimbursement rate. Correct as
  configured. Do not flag it.

## SQL

- **Plain 7-bit ASCII only**, in every migration and every hand-run script, including
  inside string literals. Windows `clip.exe` reads stdin in the console code page, not
  UTF-8, and silently corrupted technician-facing text once already. Check with
  `node scripts/check-sql-ascii.cjs`.
- Migrations are applied **by hand** in the Supabase SQL editor. Code deploys
  independently, so any write path touching a new column needs a missing-column retry.
- Destructive SQL is handed over, never run. End it in `ROLLBACK` with the checks above it,
  or arm it with `COMMIT` only when asked.
- **Every new view sets `security_invoker = true` and revokes anon explicitly.** Supabase
  grants anon and authenticated SELECT on every new view in `public` by default, and a view
  without `security_invoker` runs as its owner (postgres), which skips row level security.
  Together that hands every row to anyone holding the anon key, which ships in every page.
  `inventory_position` (151) shipped exactly that way and needed migration 173.

  ```sql
  CREATE VIEW public.x WITH (security_invoker = true) AS ...;
  REVOKE ALL ON public.x FROM anon, PUBLIC;
  GRANT SELECT ON public.x TO authenticated;
  ```

  The migration's self-check must fail if `has_table_privilege('anon', 'public.x',
  'SELECT')` is true. The one deliberate exception is `profiles_booking` (122), a definer
  view whose column list is the public booking surface. Any other exception needs Brock's
  explicit sign-off.
- **Every policy names its role** with `TO authenticated` (or `TO service_role`). A policy
  with no `TO` clause applies to PUBLIC, which includes anon. `pm_items_select` (144) leaked
  its catalog rows that way and needed migration 174.

## Gotchas that have cost real time

- `work_orders` has **no `subtotal` column** — only `parts_subtotal`, `labor_subtotal`,
  `grand_total`. Writing one fails the whole UPDATE silently.
- `invoices` has no `sent_at`; the real columns are `sent_to_customer_at`, `times_sent`,
  `customer_viewed_at`, `customer_view_count`.
- `work_orders` has no `customer_name`.
- Work order **status** changes go to `/api/work-orders/[id]/status`, not the PATCH route.
- PostgREST returns at most **1000 rows**. `hd_work_orders` has more, so a plain select
  silently truncates. Use `count=exact` with a filter, or `fetchAllRows`.
- `useExtrasSettings` reports "bills nothing" until its fetch resolves. Use
  `useExtrasSettingsState` and honour `loaded` — "not loaded" is a third state and must
  never be collapsed into "off".
