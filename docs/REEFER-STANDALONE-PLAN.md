# Reefer Standalone - plan and build report (Oct 27, 2026, overnight)

## Status - verified Oct 27, 2026 (morning run)

Verification finished on the morning of Oct 27, one step at a time with nothing else
running. Full results are under "Verification results - Oct 27 morning run".

- **Cold build:** exit 0, 86 warnings - the same 86 as before this build.
- **HD + LD smoke:** 499 passed, 1 failed. All 500 checks have the same result as the
  baseline run before the build, compared by name. The one failure is the known missing
  SMOKE_LD_ONLY_ID test account.
- **Reefer flow (Rf):** 63 passed, 1 failed. The quote -> work order -> invoice money
  matched to the cent. The one failure is the 409 guard below.
- **Strays:** none. **Database:** no existing row edited or removed in the 17 shared tables.
- **Not tested: the second-subscription guard on /api/reefer/checkout (409).**
  STRIPE_PRICE_REEFER_STANDALONE is not set locally, and the route checks the price
  before the existing subscription, so it answered 503 and never reached the 409 check.

**Nothing is promoted. Migration 170 is not applied. No SQL was run by me.** The code is
pushed to master, which makes a Preview only (see "Commit").

Still to do:
1. Apply migration 170 (re-copied to the clipboard Oct 27, byte-checked and read back).
   It is needed only for the setpoint and tractor fields on Reefer Units.
2. Create the Stripe price and set STRIPE_PRICE_REEFER_STANDALONE (see "Billing"). Then
   run smoke against the Preview, which also exercises the 409 guard.

---------------------------------------------------------------------------------------

## What was built

A reefer-only product at **/reefer**, in this repo, on the same Supabase project.

| Piece | Where |
|---|---|
| Tier `reefer_standalone`, its own module list, pure gate rules | src/lib/reefer-standalone.ts |
| Gate helpers `reeferStandaloneCan`, `isReeferStandaloneUser`; pure `hdAccessAllowed`, `hdStarterAllowed` extracted (same logic) | src/lib/hd-access.ts |
| Price -> tier (`STRIPE_PRICE_REEFER_STANDALONE`), module list for the webhook + on-arrival provisioning | src/lib/hd-plans.ts |
| Trial rule `reeferTrialDaysFor` (new function; LD and HD trial functions untouched) | src/lib/ld-trial.ts |
| Checkout `/api/reefer/checkout` | src/app/api/reefer/checkout/route.ts |
| `/reefer` layout: own gate, reefer nav, provisioning from a fresh Stripe session | src/app/reefer/layout.tsx |
| 31 pages under src/app/reefer - each a ONE-LINE re-export of the HD page, plus a reefer title | src/app/reefer/** |
| Nav: `HDNav variant="reefer"` (default 'hd' renders exactly as before) | src/components/hd/HDNav.tsx |
| Middleware: /reefer guard, path allow-list, the `nwi_surface` cookie that brings /hd links back to /reefer | src/middleware.ts |
| Server helper "is this request on /reefer" | src/lib/reefer-surface.ts |
| Unit setpoint + tractor fields (NEW table) | supabase/migrations/170_reefer_unit_details.sql, src/lib/reefer-unit-details.ts |
| Trademark footer moved into a component both layouts use (identical markup) | src/components/hd/HDTrademarkFooter.tsx |
| Gate matrix | scripts/verify-reefer-gates.ts |
| Reefer trial tests (11) | scripts/verify-ld-trial.ts |
| Smoke flow Rf + cleanup; strays check for its throwaway account | scripts/smoke.ts, scripts/check-smoke-strays.ts |

**The product surface (/reefer):** Dashboard, Calendar (scheduler), Reefer Diagnostics
(QuickWrench: Reefer Unit, Procedures, Parts Ref tabs; the TK guided diagnostic), Intel
Hub, Financials, Parts Lookup, Work Orders, Reefer Units, Customers (fleet accounts),
Invoicing, Quotes, Labor Cards, Invoices, PM Checklist + PM Schedules, EPA 608 Log,
Reefer Module, Settings, sign-in and sign-up.

**Screens changed for reefer, by prop or by path - never by copying:**
- QuickWrench: tabs limited to Reefer/Procedures/Parts; title "REEFER DIAGNOSTICS"; every
  tab change goes through one setter, so no hand-off can land on a trailer tab.
- Labor cards: `reeferOnly` prop - type fixed at reefer, type picker and type filter
  hidden; reefer categories only. API enforces it (see Gates).
- Reefer Units (fleet-units): "REEFER UNITS"; category picker hidden when the shop has one
  reefer category (set, not asked); "Manage categories" hidden; setpoint, truck make,
  model, year and VIN fields saved to reefer_unit_details; per-unit "Inspections" link
  hidden. With migration 170 unapplied the unit still saves and the page says the
  setpoint/tractor part did not.
- Work order: Start Aerial / DOT / Equipment Inspection buttons hidden; Start Reefer PM
  kept.
- Dashboard: reefer wording ("NWI Reefer", "Active Reefer Units", "REEFER DIAGNOSTICS"),
  trial banner priced at $129.
- PM Schedules: truck & trailer interval cards hidden; TK and Carrier kept.
- Settings: Data Import hidden.
- Sign-in / sign-up: reefer branding; sign-up has the one plan, no picker, no promo, and a
  signed-in account with no subscription goes straight to "Continue to checkout".
- Financials By Equipment: the API returns reefer categories only for a reefer account
  (totals untouched - a unit outside them falls into Uncategorized).

**Shared data, not copied:** every screen reads the same hd_* tables. Labor cards are
rows in hd_repair_items; the NWI catalog (20 reefer rows) is the same 21 rows HD reads.
Diagnostics use the same QuickWrench route: Gemini first, Haiku fallback, the same
hd_cached_diagnostics cache. Nothing was duplicated.

## What was NOT built, and why

- Parts counter, Fleet Finder, Foreman, separate repo/project/domain - excluded by the brief.
- `hd_reefer` ($79, under /hd) - left exactly as it is. It is a different, older product.
- Admin comp tool support for reefer_standalone - it is an admin screen with fixed tiers;
  adding one was not asked for. A comped reefer account cannot be made from it yet.
- Promo codes on the reefer sign-up - the HD promo gives 90 days free on HD prices; no
  rule exists for Reefer, so none is offered.
- Electrical Systems tab - it is a heavy-duty vehicle electrical tutor, not reefer
  diagnostics (decision D6). One line to add back if you want it.
- Import wizard, category manager, OEM Resources, Cargo Watch, inspections, audit
  reports - not in the "it gets" list.

## Decisions I made on my own

| # | Decision | Why |
|---|---|---|
| D1 | New tier `reefer_standalone`, not a reuse of `hd_reefer` | The brief names reefer_standalone and a different price/feature set; reusing hd_reefer would change an HD product |
| D2 | Its subscription row is written with vertical `heavy_duty` | That is what the existing webhook/provisioning HD path writes; no new vertical value, no constraint risk. Every HD gate tests the TIER, so it opens nothing |
| D3 | Routes opened as `HDgate(id) \|\| reeferStandaloneCan(id, module)` | The HD gate runs first unchanged; a route I missed stays CLOSED, never open |
| D4 | Every module name prefixed `reefer_` | The LD gate reads `x` or `hd_x`; plain names would have opened LD Financials/Intel/Scheduler |
| D5 | EPA 608 Log included | Refrigerant compliance; it is on the HD dashboard the product reuses. (Its entry form is still a "coming soon" stub, as in HD) |
| D6 | QuickWrench Electrical tab excluded; the TK "Code 25" guided diagnostic included | Electrical's prompt is a truck/diesel tutor; the guided flow is a Thermo King alarm |
| D7 | A reefer account's labor cards and quote labor library are equipment_type `reefer` only; its quote-modal saves are written as reefer (RF- code) | "Never show truck"; untyped cards could be anything, so they are not shown |
| D8 | A category is "reefer" when its name contains "reefer" | Categories are per-shop names (default "Reefer Unit"); there is no type column to test |
| D9 | Setpoint / truck make, model, year / VIN in a NEW table reefer_unit_details (170) | hd_units has none of them and may not be altered |
| D10 | The whole product is open during the trial | It is the product being trialled; nothing in it costs per use beyond diagnostics HD Elite's trial already opens |
| D11 | /api/reefer/checkout refuses (409) any account with a LIVE subscription of any tier | One subscriptions row per account: a second purchase would leave the first Stripe subscription billing |
| D12 | /api/reefer/checkout answers 503 with no env price, instead of HD's "send to dashboard" | A reefer account with no subscription would only bounce back to sign-up |
| D13 | Auth-only HD routes that are not reefer (aerial POST, import/*, equipment-categories POST/PATCH) refuse a reefer_standalone account | They had no tier check; the refusal fires ONLY for this tier |
| D14 | /hd links inside reused screens are handled by a cookie redirect in middleware, not by editing ~300 hrefs | No screen copied; customer pages (/hd/quote, /hd/invoices/pay) and /api never redirected; a browser without the cookie takes exactly today's path |
| D15 | Only reefer_standalone may use /reefer; an HD subscriber who opens it is sent back with `?leave_reefer=1` (clears the cookie) | HD Elite already has every reefer feature under /hd |
| D16 | The reefer surface exists on the main host only | On the hd. subdomain /reefer already means /hd/reefer and must not change |
| D17 | Data export left as is (its ZIP has an empty dot_inspections.csv for a reefer shop) | Changing it changes HD's export; noted in Worries |

## The gates

Phase 2 is proven by scripts/verify-reefer-gates.ts. It reads EVERY page and API route in
src/app from source, finds each handler's gate, and evaluates it with the app's own pure
rules against fixed subscription rows.

- reefer_standalone (active and trialing): each gate's answer against the expected answer
  written by hand from the brief. **172 rows, 0 mismatches.** Plus 4 in-route checks:
  QuickWrench refuses truck/electrical mode, parts-manager refuses non-TK/Carrier makes,
  labor cards are reefer-only, checkout refuses a live subscriber - all PASS.
- hd_elite, hd_elite (trial), full_suite_plus, hd_reefer, hd_starter, hd_pro, comped HD:
  every route's answer computed from the code at git HEAD (before tonight) and from the
  working tree. **3,115 (route, plan) answers compared: 0 changed.** The 24 new routes
  open to none of those plans (except the public /reefer/login and /reefer/signup).

```
=== 2. Every other plan: answer before this work (git HEAD) vs now ===
  3115 (route, plan) answers compared across 7 plans: 0 changed.
  24 new routes (/reefer, /api/reefer): open to none of the other plans except as listed above.
hd_elite / full_suite_plus, now (= before):
  hd_elite        allowed on 436 of 469 gates
  full_suite_plus allowed on 326 of 469 gates
ALL MATCH
```

The reefer_standalone matrix, in full, is at the bottom of this file.

## Billing

**Env var to add (Vercel, Preview and Production):** `STRIPE_PRICE_REEFER_STANDALONE` =
the price ID you create below. Also added to .env.local.example. Until it is set,
/api/reefer/checkout answers 503 and sign-up says checkout is not available.

**Stripe steps (live mode, then the same in test mode if you test there):**
1. Products -> Add product. Name: `NWI Reefer` (or your choice). Description optional.
2. Pricing: Recurring, Monthly, **$129.00 USD**, flat rate. Do NOT add a trial on the
   price - the 15-day trial is set by the checkout per customer (card required, once per
   customer, cancels if the trial ends with no card).
3. Save, open the price, copy its ID (`price_...`).
4. Vercel -> Settings -> Environment Variables -> add `STRIPE_PRICE_REEFER_STANDALONE`
   with that ID for Production and Preview. Redeploy the Preview to pick it up.
5. No webhook change: the existing Stripe webhook already sends checkout.session.completed
   and customer.subscription.* to /api/webhooks/stripe, which now maps this price to
   reefer_standalone.

How a sale is recorded: the webhook (and /reefer's layout on return from Stripe, from the
session id) resolves the PRICE to `reefer_standalone` via getHdTierFromPriceId and writes
the subscriptions row with Stripe's status (trialing during the trial). Ad links: send
traffic to `/reefer/signup`.

## Verification results

| Step | Result |
|---|---|
| 5.1 Cold build (overnight - superseded by the morning run) | **#1 exit 0** (87 warnings = the 86 baseline + 1 new from me, a hook-dependency warning in LaborCardManager, fixed after). **#2 NOT RUN - killed by the system for low memory.** Full `tsc --noEmit` after the fix: clean |
| 5.2 Full smoke HD + LD (overnight - superseded) | **NOT RUN overnight; ran in the morning, see below** (needs a build and a server) |
| 5.3 Reefer smoke flow (Rf) (overnight - superseded) | **Written, not run overnight; ran in the morning, see below.** It makes a throwaway account (smoke-reefer-<n>@example.com) with a reefer_standalone row, drives the surface, the refused and allowed APIs, labor cards, and quote -> work order -> invoice from a real saved quote's shape with every total read back from the database; then deletes the account and every row it made and proves none is left |
| 5.4 Gate matrix | **ALL MATCH** - 172 reefer rows, 4 in-route checks, 0 of 3,115 HD/LD answers changed |
| 5.5 27-invoice replay | **0 of 27 totals change; 0 of 27 with any stored field changing; 3 refused** |
| 5.6 Stray test rows | No smoke run, so none created. check-smoke-strays.ts now also checks for smoke-reefer accounts and any reefer_standalone subscription |
| 5.7 No table altered, no row changed | No SQL executed; migration 170 creates one NEW table and is not applied. A read-only snapshot of 17 shared tables (subscriptions 8, profiles 42, hd_alarm_codes 100, hd_parts_reference 960, hd_procedures 4, hd_bm_map 4, hd_repair_items 40, hd_cached_diagnostics 46, hd_equipment_categories 27, hd_units 44, hd_fleet_accounts 151, hd_quotes 13, hd_work_orders 3,316, hd_invoices 27, line items 53, customers 877, hd_unit_profiles 4) matches the counts read before the build started. Its row hashes are saved to compare after the smoke run |
| Trial rules | scripts/verify-ld-trial.ts **83 passed, 0 failed** (72 before + 11 reefer) |
| Byte scan | 114 changed/new files: 0 control bytes (one backspace byte from shell escaping was found by the gate matrix in parts-manager and fixed) |

The 5.1, 5.2, 5.3, 5.6 and 5.7 rows above are the overnight state. The morning run below
replaces them.

## Verification results - Oct 27 morning run

Run one step at a time with nothing else running: a cold build, `npm run start`, then
`PAGECHECK_BASE=http://localhost:3000 npm run smoke`, then the strays check and the
database comparison, then the server was stopped. Migration 170 was not applied during
this run. The smoke script cannot run one flow on its own, so flow Rf ran in the same
smoke run as HD + LD.

| Step | Result |
|---|---|
| Cold build (`rm -rf .next && npm run build`) | **Exit 0.** 86 warnings - the same 86 as before this build. The 87th from overnight build #1 was the LaborCardManager hook dependency, which was fixed. Compiled in 83s, 200/200 static pages, no out-of-memory errors |
| Server | `npm run start` ready in 2.1s. Signed out: `/hd/login` 200; `/reefer` 307 -> `/reefer/dashboard` 307 -> `/reefer/login?redirect=...`; `/reefer/login` 200 (title "Sign In - NWI Reefer"); `/reefer/signup` 200. The `nwi_surface=reefer` cookie is set |
| Full smoke, HD + LD | **499 passed, 1 failed.** All 500 checks were compared by name with the last baseline run (smoke-N): the same 500 checks, with the same results. Nothing that passed before fails. The one failure is the known `SMOKE_LD_ONLY_ID is not set` (Z equipment, LD-only subscriber) |
| Reefer flow Rf | **63 passed, 1 failed.** The failure is the 409 guard, described below |
| Strays | **Clean.** 0 smoke-marked rows in hd_quotes, hd_work_orders, hd_invoices, work_orders, quotes, hd_fleet_accounts, hd_units and customers; 0 `smoke-reefer-*` auth users; 0 `reefer_standalone` subscriptions |
| 17 shared tables, compared row by row | **No existing row edited or removed.** 16 tables have the same counts as before the build. `customers` went 877 -> 879: two real customers added at 12:16 and 12:19 UTC by a shop account, about five hours before the smoke run. They are not test rows |

### Flow Rf - the money, every total read back from the database

It ran on a throwaway account, `smoke-reefer-1793121686921@example.com`, with a
`reefer_standalone` subscriptions row. The row was accepted: there is no tier CHECK
constraint. The quote copies the money shape of a real approved HD quote, Q-2026-0011.

| Field | Q-2026-0011 (template) | Reefer quote | Work order | Invoice |
|---|---|---|---|---|
| Labor subtotal | 202.50 | 202.50 | - | - |
| Parts subtotal | 86.45 | 86.45 | - | - |
| Diagnostic, road call, travel, mileage, shop supplies | 0.00 each | 0.00 each | - | - |
| Labor tax, 7.75% on 202.50 | 15.69 | 15.69 | - | - |
| Parts tax, 7.75% on 86.45 | 6.70 | 6.70 | - | - |
| **Tax** | 22.39 | **22.39** | **22.39** | **22.39** |
| **Total** | 311.34 | **311.34** | **311.34** | **311.34** |

- **Quote:** it matched the template on all nine money fields and on its tax breakdown.
  The check: 202.50 + 86.45 + 22.39 = 311.34.
- **Work order and invoice:** these checks compare total and tax against the quote, and
  both are exact.
  - The converter billed 311.34.
  - The stored invoice passes the check that it adds up.
- **Screens and fields:**
  - The quote, work order and invoice pages under `/reefer` each show $311.34.
  - The quote kept the tractor fields (Freightliner, VIN 1FUJGLDR0ZZRF0001).
  - The work order offers Reefer PM and no DOT, aerial or equipment inspection.

Also passed:
- **Surface and redirects:**
  - The surface and nav are reefer-only.
  - 8 non-reefer paths under /reefer go to the dashboard: dot-inspections,
    aerial-inspections/new, equipment-inspections, import, fleet-units/categories,
    resources, reports/audit and foreman.
  - `/hd` sends the account to /hd/signup.
  - On the reefer surface, an /hd link comes back to /reefer: /reefer/quotes, or the
    dashboard for a screen that is not on the reefer surface.
- **Screens:**
  - Reefer Diagnostics shows the Reefer, Procedures and Parts tabs only.
  - Reefer Units shows the setpoint and tractor fields.
  - PM Schedules shows TK and Carrier only.
  - Settings has no data import.
- **Refused APIs, 11 of them:**
  - 403 "HD subscription required": truck-diagnostic, trailer-reference,
    trailer-abs-diagnostic, dot-inspections, equipment-inspections.
  - 403 "Reefer diagnostics only on this plan": quickwrench, both electrical and truck.
  - 403 "Not available on Reefer Standalone": aerial-inspections, import,
    equipment-categories.
  - 403 "Reefer parts only on this plan": parts-manager.
- **Allowed APIs:** alarm-codes 200; parts-reference 200 with 960 parts.
- **Labor cards:**
  - A truck card is refused (400).
  - A reefer card saves as RF-0059 on the account's own row.
  - The screen has no type picker.
  - The library it picks from is reefer-only: 21 items, NWI catalog included.
- **Financials:** By Equipment lists only "Reefer Unit" and "No unit recorded".
- **Pages:** /reefer/scheduler, intel, reefer, epa-log, parts, fleet-accounts and
  invoicing all render.
- **Cleanup:** the throwaway account and every row it made are gone. This is checked
  table by table.

### Not tested: the second-subscription guard (409)

The check "POST /api/reefer/checkout is refused" expects 409 for an account that already
has a live subscription. It got **503** ("Reefer Standalone is not available for checkout
yet").

STRIPE_PRICE_REEFER_STANDALONE is not set locally, and the route checks the price before
the existing subscription. So the request was refused, but for the wrong reason, and the
guard itself has not run.

The test is right about the product, so it was left as written:
- Once the env var is set and smoke runs against the Preview, it exercises the guard.
- Run locally without the var, it will keep failing.
- The other fix is to check the existing subscription before the price in the route.
  That has not been made.

## Commit

Commit **549df424**, pushed to master: a **Preview**, not promoted. (This report line was added in a docs-only follow-up commit.) Preview and production share
one database. Migration 169 (net30 defaults) is still uncommitted and was left out.

## Worries

1. **RESOLVED Oct 27:** Brock's read-only constraint query shows there is no tier CHECK
   on subscriptions, only the pkey, the user_id foreign key and unique(user_id). Flow Rf
   wrote a `reefer_standalone` row without refusal. The original worry follows:
   **The subscriptions.tier CHECK is unknown.** Migration 018 allows only
   starter/pro/full_suite/quickwrench/elite, but live rows hold hd_elite and
   full_suite_plus, so it was changed outside the repo. If a CHECK still lists tiers, the
   webhook's write of `reefer_standalone` will fail and a paying customer gets no access.
   Read-only check:
   `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.subscriptions'::regclass;`
   Flow Rf also tests it: its first write is that row, and it reports a refusal verbatim.
2. **Existing redirect loop (not mine, not changed):** a signed-in account with no HD
   plan that opens any /hd page is sent to /hd/signup by the layout, and the middleware
   sends a signed-in visitor on /hd/signup back to /hd/dashboard. LD-only accounts hit
   this today. A reefer account never does in normal use (the cookie sends it to
   /reefer), but it would if it typed an /hd URL in a fresh browser.
3. **/api/hd/checkout lets an account with a live subscription start a second one**
   (existing behaviour). /api/reefer/checkout refuses that; HD's does not.
4. **Customer-facing documents were not reviewed for HD wording.** Quote/invoice public
   pages, PDFs and emails come from the HD code and may say "HD". The trademark footer
   says "National Wrench Index HD Suite". Not changed - it would change HD.
5. **"A card written in HD shows up in Reefer"** holds for the same table and the NWI
   catalog. Shop cards are per account, so they only cross over within one account, and a
   reefer account sees only its reefer-type cards.
6. **One extra database read** for HD/LD accounts on the 7 auth-only routes that now refuse
   reefer accounts (aerial POST, import x5, equipment-categories POST/PATCH). Answers are
   unchanged; it is latency only.
7. The QuickWrench parts tab still asks /api/hd/trailer-reference for cross-matches; for a
   reefer account that answers 403 and the panel stays silent, as it is built to.
8. Flow Rf creates and deletes an auth user each run. That is new for the suite; its
   cleanup sweeps any left by a crashed run, and the strays check counts them.

---------------------------------------------------------------------------------------

## Phase 1 - recon (written before building)

### 1.1 How LD and HD are separated

| Layer | LD | HD |
|---|---|---|
| Routing | top-level paths (/dashboard, /scheduler, /intel ...) | /hd/* (plus the hd. subdomain, rewritten by middleware) |
| Layout | none; each page mounts AppNav and gates itself | src/app/hd/layout.tsx: checkHDAccess, HDNav, footer |
| Nav | src/components/layout/AppNav.tsx | src/components/hd/HDNav.tsx (static list, no tier filter) |
| Session guard | middleware isLegacyProtected -> /login | middleware isHDProtected -> /hd/login |
| Tier gate | canAccessModule / subscriptionGrantsModule, getModuleAccess | checkHDAccess, checkHDStarterAccess, checkHDReeferAccess, checkHDForemanAccess |
| Checkout | /api/stripe/checkout | /api/hd/checkout |

Reefer follows it: /reefer/* routing, its own layout and nav variant, middleware guard,
its own checkout. One subscriptions row per account.

### 1.2 Classification

REEFER: /hd/reefer, labor-cards, parts, pm-checklist(+[id]), pm-schedules, epa-log,
QuickWrench Reefer/Procedures/Parts + guided; APIs alarm-codes, unit-profile,
parts-reference, parts(+seed), pm-checklist(+email, pdf), labor-cards, repair-items,
quickwrench (reefer mode), parts-manager (TK/Carrier).
SHARED: dashboard, scheduler, intel, financials, work-orders, quotes, invoices,
invoicing, fleet-units, fleet-accounts, settings, login, signup; their APIs.
NOT-REEFER: dot/aerial/equipment inspections, units/inspections, follow-ups,
reports/audit, foreman, cargo-watch, resources, import, fleet-units/categories,
QuickWrench Truck/Electrical/Trailer/ABS; APIs truck-diagnostic, trailer-reference,
trailer-abs-diagnostic, quickwrench/vin, the inspection APIs, reports, cargo-watch,
import.

### 1.3 Equipment types and categories

EQUIPMENT_TYPES (labor cards), the per-shop hd_equipment_categories (9 seeded defaults),
the QuickWrench tab array, work-order inspection buttons, the truck/trailer PM cards, the
By Equipment rollup. Treatment of each is under "What was built".

### 1.4 - 1.7

See "The gates", "Billing", and "Worries" above; Financials and Intel Hub need no
equipment assumption except By Equipment (handled).

---------------------------------------------------------------------------------------

## Gate matrix - reefer_standalone, in full

Columns: gate, the gate terms read from source, allowed (active), allowed (trialing),
expected. `hd` = checkHDAccess, `starter` = checkHDStarterAccess, `reeferHD` =
checkHDReeferAccess, `rs:<m>` = reeferStandaloneCan(module), `noReefer` =
isReeferStandaloneUser refusal, `noLiveSub` = canStartReeferCheckout, `(signed in)` = no
tier gate on the handler (for /reefer pages the reefer layout and middleware decide).

```
=== 1. reefer_standalone: every gate, allowed vs expected ===
gate                                                 route gate terms                         allowed trial  expected 
DELETE /api/hd/expenses                              (signed in)                               yes    yes   yes    MATCH
DELETE /api/hd/invoices/[id]                         hd | rs:reefer_invoices                   yes    yes   yes    MATCH
DELETE /api/hd/labor-cards/[id]                      hd | rs:reefer_labor_cards                yes    yes   yes    MATCH
DELETE /api/hd/quotes/[id]                           hd | rs:reefer_quotes                     yes    yes   yes    MATCH
DELETE /api/hd/work-orders/[id]/photos               (signed in)                               yes    yes   yes    MATCH
GET /api/hd/aerial-inspections/[id]/pdf              (signed in)                               yes    yes   yes    MATCH
GET /api/hd/alarm-codes                              reeferHD | rs:reefer_alarm_codes          yes    yes   yes    MATCH
GET /api/hd/bundle-price                             (signed in)                               yes    yes   yes    MATCH
GET /api/hd/cargo-watch/events                       hd                                        no     no    no     MATCH
GET /api/hd/cargo-watch/session                      hd                                        no     no    no     MATCH
GET /api/hd/dot-inspections/[id]/pdf                 (signed in)                               yes    yes   yes    MATCH
GET /api/hd/equipment-categories                     (signed in)                               yes    yes   yes    MATCH
GET /api/hd/expenses                                 starter | rs:reefer_financials            yes    yes   yes    MATCH
GET /api/hd/export                                   (signed in)                               yes    yes   yes    MATCH
GET /api/hd/financials/equipment                     starter | rs:reefer_financials            yes    yes   yes    MATCH
GET /api/hd/financials/summary                       hd | rs:reefer_financials                 yes    yes   yes    MATCH
GET /api/hd/fleet-accounts                           starter | rs:reefer_customers             yes    yes   yes    MATCH
GET /api/hd/fleet-units                              (signed in)                               yes    yes   yes    MATCH
GET /api/hd/invoices                                 hd | rs:reefer_invoices                   yes    yes   yes    MATCH
GET /api/hd/invoices/[id]                            hd | rs:reefer_invoices                   yes    yes   yes    MATCH
GET /api/hd/invoices/[id]/pdf                        hd | rs:reefer_invoices                   yes    yes   yes    MATCH
GET /api/hd/labor-cards                              hd | rs:reefer_labor_cards                yes    yes   yes    MATCH
GET /api/hd/late-fee-settings                        hd | rs:reefer_settings                   yes    yes   yes    MATCH
GET /api/hd/parts                                    hd | rs:reefer_parts_reference            yes    yes   yes    MATCH
GET /api/hd/parts-reference                          hd | rs:reefer_parts_reference            yes    yes   yes    MATCH
GET /api/hd/pm-checklist/[id]/pdf                    (signed in)                               yes    yes   yes    MATCH
GET /api/hd/quickbooks-export                        hd | rs:reefer_financials                 yes    yes   yes    MATCH
GET /api/hd/quickwrench/vin/[vin]                    hd                                        no     no    no     MATCH
GET /api/hd/quotes                                   hd | rs:reefer_quotes                     yes    yes   yes    MATCH
GET /api/hd/quotes/[id]                              hd | rs:reefer_quotes                     yes    yes   yes    MATCH
GET /api/hd/quotes/public/[token]                    (signed in)                               yes    yes   yes    MATCH
GET /api/hd/repair-items                             hd | rs:reefer_labor_cards | ld:quickwrench  yes    yes   yes    MATCH
GET /api/hd/reports/audit-packet                     starter                                   no     no    no     MATCH
GET /api/hd/reports/audit-schedule                   starter                                   no     no    no     MATCH
GET /api/hd/reports/labels                           starter                                   no     no    no     MATCH
GET /api/hd/settings                                 (signed in)                               yes    yes   yes    MATCH
GET /api/hd/trailer-reference                        hd                                        no     no    no     MATCH
GET /api/hd/unit-profile                             (signed in)                               yes    yes   yes    MATCH
GET /api/hd/work-orders                              starter | rs:reefer_work_orders           yes    yes   yes    MATCH
GET /api/hd/work-orders/[id]/convert                 hd | rs:reefer_work_orders                yes    yes   yes    MATCH
GET /api/hd/work-orders/[id]/line-items              (signed in)                               yes    yes   yes    MATCH
GET /api/hd/work-orders/calendar                     starter | rs:reefer_scheduler             yes    yes   yes    MATCH
PAGE /hd/aerial-inspections/[id]                     (signed in)                               no     no    no     MATCH
PAGE /hd/aerial-inspections/new                      starter                                   no     no    no     MATCH
PAGE /hd/cargo-watch                                 (signed in)                               no     no    no     MATCH
PAGE /hd/dashboard                                   (signed in)                               no     no    no     MATCH
PAGE /hd/dot-inspections                             starter                                   no     no    no     MATCH
PAGE /hd/dot-inspections/[id]                        starter                                   no     no    no     MATCH
PAGE /hd/dot-inspections/new                         starter                                   no     no    no     MATCH
PAGE /hd/epa-log                                     (signed in)                               no     no    no     MATCH
PAGE /hd/equipment-inspections                       starter                                   no     no    no     MATCH
PAGE /hd/equipment-inspections/[id]                  (signed in)                               no     no    no     MATCH
PAGE /hd/equipment-inspections/new                   starter                                   no     no    no     MATCH
PAGE /hd/financials                                  starter | rs:reefer_financials            no     no    no     MATCH
PAGE /hd/fleet-accounts                              starter | rs:reefer_customers             no     no    no     MATCH
PAGE /hd/fleet-accounts/[id]                         starter | rs:reefer_customers             no     no    no     MATCH
PAGE /hd/fleet-units                                 (signed in)                               no     no    no     MATCH
PAGE /hd/fleet-units/[id]/inspections                starter                                   no     no    no     MATCH
PAGE /hd/fleet-units/categories                      (signed in)                               no     no    no     MATCH
PAGE /hd/foreman                                     foreman                                   no     no    no     MATCH
PAGE /hd/import                                      starter                                   no     no    no     MATCH
PAGE /hd/inspections/follow-ups                      hd                                        no     no    no     MATCH
PAGE /hd/intel                                       (signed in)                               no     no    no     MATCH
PAGE /hd/invoices                                    hd | rs:reefer_invoices                   no     no    no     MATCH
PAGE /hd/invoices/[id]                               hd | rs:reefer_invoices                   no     no    no     MATCH
PAGE /hd/invoices/[id]/edit                          hd | rs:reefer_invoices                   no     no    no     MATCH
PAGE /hd/invoices/new                                (signed in)                               no     no    no     MATCH
PAGE /hd/invoices/pay/[token]                        (signed in)                               yes    yes   yes    MATCH
PAGE /hd/invoicing                                   (signed in)                               no     no    no     MATCH
PAGE /hd/labor-cards                                 (signed in)                               no     no    no     MATCH
PAGE /hd/login                                       (signed in)                               yes    yes   yes    MATCH
PAGE /hd/parts                                       (signed in)                               no     no    no     MATCH
PAGE /hd/pm-checklist                                (signed in)                               no     no    no     MATCH
PAGE /hd/pm-checklist/[id]                           hd | rs:reefer_pm                         no     no    no     MATCH
PAGE /hd/pm-schedules                                (signed in)                               no     no    no     MATCH
PAGE /hd/quickwrench                                 (signed in)                               no     no    no     MATCH
PAGE /hd/quickwrench/guided                          hd | rs:reefer_diagnostics                no     no    no     MATCH
PAGE /hd/quote/[token]                               (signed in)                               yes    yes   yes    MATCH
PAGE /hd/quotes                                      hd | rs:reefer_quotes                     no     no    no     MATCH
PAGE /hd/quotes/[id]                                 hd | rs:reefer_quotes                     no     no    no     MATCH
PAGE /hd/quotes/[id]/edit                            hd | rs:reefer_quotes                     no     no    no     MATCH
PAGE /hd/quotes/new                                  (signed in)                               no     no    no     MATCH
PAGE /hd/reefer                                      reeferHD | rs:reefer_alarm_codes          no     no    no     MATCH
PAGE /hd/reports/audit                               starter                                   no     no    no     MATCH
PAGE /hd/resources                                   starter                                   no     no    no     MATCH
PAGE /hd/scheduler                                   starter | rs:reefer_scheduler             no     no    no     MATCH
PAGE /hd/settings                                    (signed in)                               no     no    no     MATCH
PAGE /hd/signup                                      (signed in)                               yes    yes   yes    MATCH
PAGE /hd/subscribe                                   (signed in)                               no     no    no     MATCH
PAGE /hd/units/inspections                           (signed in)                               no     no    no     MATCH
PAGE /hd/upgrade                                     (signed in)                               no     no    no     MATCH
PAGE /hd/work-orders                                 starter | rs:reefer_work_orders           no     no    no     MATCH
PAGE /hd/work-orders/[id]                            starter | rs:reefer_work_orders           no     no    no     MATCH
PAGE /hd/work-orders/[id]/edit                       starter | rs:reefer_work_orders           no     no    no     MATCH
PAGE /reefer/dashboard                               (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/epa-log                                 (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/financials                              (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/fleet-accounts                          (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/fleet-accounts/[id]                     (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/fleet-units                             (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/intel                                   (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/invoices                                (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/invoices/[id]                           (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/invoices/[id]/edit                      (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/invoices/new                            (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/invoicing                               (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/labor-cards                             (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/login                                   (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/parts                                   (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/pm-checklist                            (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/pm-checklist/[id]                       (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/pm-schedules                            (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/quickwrench                             (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/quickwrench/guided                      (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/quotes                                  (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/quotes/[id]                             (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/quotes/[id]/edit                        (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/quotes/new                              (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/reefer                                  (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/scheduler                               (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/settings                                (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/signup                                  (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/work-orders                             (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/work-orders/[id]                        (signed in)                               yes    yes   yes    MATCH
PAGE /reefer/work-orders/[id]/edit                   (signed in)                               yes    yes   yes    MATCH
PATCH /api/hd/equipment-categories                   noReefer                                  no     no    no     MATCH
PATCH /api/hd/labor-cards/[id]                       hd | rs:reefer_labor_cards                yes    yes   yes    MATCH
PATCH /api/hd/reports/labels                         starter                                   no     no    no     MATCH
PATCH /api/hd/work-orders/[id]                       hd | rs:reefer_work_orders                yes    yes   yes    MATCH
PATCH /api/hd/work-orders/[id]/status                hd | rs:reefer_work_orders                yes    yes   yes    MATCH
POST /api/hd/aerial-inspections                      noReefer                                  no     no    no     MATCH
POST /api/hd/checkout                                (signed in)                               yes    yes   yes    MATCH
POST /api/hd/dot-inspections                         starter                                   no     no    no     MATCH
POST /api/hd/equipment-categories                    noReefer                                  no     no    no     MATCH
POST /api/hd/equipment-inspections                   starter                                   no     no    no     MATCH
POST /api/hd/expenses                                starter | rs:reefer_financials            yes    yes   yes    MATCH
POST /api/hd/feature-waitlist                        (signed in)                               yes    yes   yes    MATCH
POST /api/hd/fleet-units/category                    (signed in)                               yes    yes   yes    MATCH
POST /api/hd/import                                  noReefer                                  no     no    no     MATCH
POST /api/hd/import/analyze                          noReefer                                  no     no    no     MATCH
POST /api/hd/import/fullbay                          noReefer                                  no     no    no     MATCH
POST /api/hd/import/invoices                         noReefer                                  no     no    no     MATCH
POST /api/hd/import/units                            noReefer                                  no     no    no     MATCH
POST /api/hd/invoices                                hd | rs:reefer_invoices                   yes    yes   yes    MATCH
POST /api/hd/invoices/[id]/send                      (signed in)                               yes    yes   yes    MATCH
POST /api/hd/invoices/[id]/token                     (signed in)                               yes    yes   yes    MATCH
POST /api/hd/labor-cards                             hd | rs:reefer_labor_cards                yes    yes   yes    MATCH
POST /api/hd/labor-suggestions                       hd | rs:reefer_quotes                     yes    yes   yes    MATCH
POST /api/hd/late-fee-settings                       hd | rs:reefer_settings                   yes    yes   yes    MATCH
POST /api/hd/parts-manager                           hd | rs:reefer_diagnostics                yes    yes   yes    MATCH
POST /api/hd/parts/seed                              hd | rs:reefer_parts_reference            yes    yes   yes    MATCH
POST /api/hd/pm-checklist                            hd | rs:reefer_pm                         yes    yes   yes    MATCH
POST /api/hd/pm-checklist/[id]/email                 hd | rs:reefer_pm                         yes    yes   yes    MATCH
POST /api/hd/quickwrench                             hd | rs:reefer_diagnostics                yes    yes   yes    MATCH
POST /api/hd/quotes                                  hd | rs:reefer_quotes                     yes    yes   yes    MATCH
POST /api/hd/quotes/[id]/send                        hd | rs:reefer_quotes                     yes    yes   yes    MATCH
POST /api/hd/quotes/[id]/work-order                  hd | rs:reefer_quotes                     yes    yes   yes    MATCH
POST /api/hd/quotes/public/[token]/respond           (signed in)                               yes    yes   yes    MATCH
POST /api/hd/repair-items                            hd | rs:reefer_labor_cards | ld:quickwrench  yes    yes   yes    MATCH
POST /api/hd/repair-items/[id]/used                  hd | rs:reefer_labor_cards | ld:quickwrench  yes    yes   yes    MATCH
POST /api/hd/settings                                (signed in)                               yes    yes   yes    MATCH
POST /api/hd/trailer-abs-diagnostic                  hd                                        no     no    no     MATCH
POST /api/hd/truck-diagnostic                        hd                                        no     no    no     MATCH
POST /api/hd/unit-profile                            (signed in)                               yes    yes   yes    MATCH
POST /api/hd/work-orders                             starter | rs:reefer_work_orders           yes    yes   yes    MATCH
POST /api/hd/work-orders/[id]/photos                 (signed in)                               yes    yes   yes    MATCH
POST /api/reefer/checkout                            noLiveSub                                 no     no    no     MATCH
PUT /api/hd/invoices/[id]                            hd | rs:reefer_invoices                   yes    yes   yes    MATCH
PUT /api/hd/quotes/[id]                              hd | rs:reefer_quotes                     yes    yes   yes    MATCH
PUT /api/hd/work-orders/[id]/discount                hd | rs:reefer_work_orders                yes    yes   yes    MATCH
PUT /api/hd/work-orders/[id]/line-items              (signed in)                               yes    yes   yes    MATCH
In-route mode checks (read from source):
```
