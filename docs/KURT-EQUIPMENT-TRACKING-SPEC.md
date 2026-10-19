# HD Equipment Categories and Per-Equipment Financials - Build Spec

Author: Brock Fleeman / NWI. Drafted 2026-10-18.
Driven by Kurt Knarr (C&K Utility Equipment Service), first HD Elite subscriber.
Target: phase 1 usable Monday 2026-10-19.

Plain ASCII only. Migrations are hand-applied by Brock in the Supabase SQL
editor. Claude Code does not run destructive SQL.

---

## 1. What Kurt asked for

Two things, and they are not the same job:

1. Separate each piece of equipment rather than lumping it together. A truck
   gets its own folder. In Financials, show which pieces of equipment get
   worked on most and how much money each category makes.
2. Insurance audit reporting. Kurt says Fullbay does this.

Both are phase 1. Build them together.

Item 1 is a rollup of data already in the database.

Item 2 was previously held back pending answers from Kurt. That was the wrong
call. Insurance audits generally ask for the same shape: a schedule by
equipment class, the unit count in each class, and activity or receipts per
class for the policy period. That is buildable now off the same rollup. It may
not match his carrier's form exactly, and a report he adjusts beats a report
that does not exist while waiting on a phone call.

Four questions still want answering, and they refine the export rather than
block it. Ask them when showing him the build. The first one is new and it
matters more than the rest:

- **Which audit is he facing?** A workers' compensation payroll audit, a
  garagekeepers physical damage audit, and a carrier safety review are three
  different things and NWI can only serve one and a half of them. See
  section 1.1.
- What exactly does his carrier ask for at audit time?
- What does he hand them today, and how long does it take him?
- What does his policy call the equipment classes? Use his insurer's words,
  not ours - relabel the categories to match once known.

### 1.1 What NWI can and cannot serve

Research on what insurers actually review at a heavy-duty shop audit breaks
into four areas. NWI's position on each:

**Payroll and employee classification** - OUT OF SCOPE. NWI holds no payroll
data. Guessing at workers' compensation class codes is a liability, not a
feature. Do not build toward this and do not imply the Suite covers it.

**Care, custody and control / garagekeepers** - STRONG FIT, and the most
valuable thing here. Auditors want itemized service orders with customer
signatures, labor rates, parts installed, and explicit authorization before
teardown. The existing quote -> customer approval -> work order -> invoice
chain already produces all of it: the approval page's `approved_at`,
`approval_method` and `customer_po_number` are the authorization record. What
is missing is a way to pull it out. See section 5.3.

They also want peak value exposure - the highest aggregate value of customer
units in the shop's possession at once. NWI does not hold unit values, but it
does know which units were open on a work order on which dates, so peak
concurrent units in possession is already derivable. Values would need a
nullable field on the unit and Kurt entering them; offer it, do not assume it.

**Specialty equipment and technical compliance** - STRONG FIT, phase 2.
Aerial devices need annual and periodic inspections, dielectric testing on
insulated booms, and structural recertification at ten years then every five.
That is recurring due-date tracking per unit, which is worth money to Kurt
every month rather than once a year. Technician ANSI/OSHA certifications with
expiry dates belong here too. See section 8.

**Loss history and claims data** - OUT OF SCOPE. Loss runs come from his
carrier, not his shop software.

A note on sourcing: the ANSI A92 and structural recertification material is
real industry practice. The payroll Category 1 / Category 2 framing with
rating caps traces to a LiveJournal post and a Quora answer, and it varies by
state and carrier. Do not tell Kurt his insurer requires something on that
basis.

## 2. Hard requirement: categories are per business, not hardcoded

Kurt services utility and aerial equipment. Brock services reefers. A
landscaping subscriber services mowers. Hardcoding Kurt's classes repeats the
mistake Brock already called out once on markup: "you just set the percentage
at 20% and it should be set by every shop using the program."

So the category list is per business, with sensible defaults a shop can rename,
reorder, deactivate or add to.

Default seed list (every business gets these, all editable):

    Reefer Unit
    Truck
    Trailer
    Boom
    Aerial / Bucket
    Digger Derrick
    APU
    Genset
    Other

Boom, Aerial and Truck are the three Kurt named himself. Crane and Chipper he
will probably add. Let him. Do not ship a list that only fits him, and do not
ship one that only fits reefers.

## 3. Prerequisite: unit data has to be clean first

Two blockers, both found already:

**unit_id on work orders.** Migration 158 added `unit_id` and
`fleet_account_id` to `hd_work_orders`. Whether any code path actually writes
`unit_id` is unverified. If it is null on most rows, there is nothing to group
on and no report is possible until it is backfilled. This is the single thing
Monday depends on. Recon prompt in section 7.

**Duplicate units.** Kurt's C&K data has a duplicate `hd_units` row - "taylor
oil company", unit 103, International, s1800, same serial entered twice.
A duplicate unit splits that unit's history across two records, so the
per-unit numbers will be wrong and the unit will appear twice in the report.
Merge before reporting, do not delete: pick the surviving row, repoint work
orders at it, mark the other inactive. Brock runs the SQL.

Add a unique constraint afterward so it cannot recur:
`unique (business_id, serial_number) where serial_number is not null`.

## 4. Tables

### 4.1 hd_equipment_categories

```
id           uuid primary key default gen_random_uuid()
business_id  uuid not null references <businesses table>(id) on delete cascade
name         text not null
sort_order   integer not null default 0
is_active    boolean not null default true
created_at   timestamptz not null default now()

unique (business_id, name)
index on (business_id, is_active, sort_order)
```

Seeded per business from the section 2 defaults on first access, not by a
one-time data migration - new businesses need them too.

### 4.2 hd_units - add

```
category_id  uuid references hd_equipment_categories(id) on delete set null
```

Nullable. An uncategorized unit still works everywhere; it just reports under
"Uncategorized" until someone assigns it.

### 4.3 No other schema changes

Hours and dollars are already in `hd_work_order_line_items` and
`hd_invoices` / invoice line items. Do not denormalize totals onto `hd_units` -
a cached total goes stale and then disagrees with the invoices, which is the
same class of bug as extras, tax, markup, payment terms and unit year all
were.

## 5. The report

Route: inside Financials, a new "By Equipment" view. Two tables on one page,
with a date-range filter defaulting to the current year.

**Per category**, one row each:

    category | units serviced | jobs | labor hours | labor revenue
             | parts revenue | other (fees) | total invoiced | collected

**Per unit**, one row each, sortable, filterable by category and by fleet
account:

    unit | category | fleet account | jobs | labor hours
         | total invoiced | collected | last service date

"Which pieces of equipment get worked on most" is the jobs column sorted
descending. "How much money made per category" is total invoiced on the
category table. Both of Kurt's questions answered by the default sort.

### 5.1 Rules that are not optional

**Money comes from invoices, not work orders.** A work order is intent; an
invoice is money. Count a job in "jobs" when it has an invoice.

**Read recorded values, never recompute.** Sum the line totals as they were
stored on the invoice. Do not recompute from the shop's current labor rate,
markup or tax settings. A document's recorded terms beat current settings -
this rule has been violated and fixed five times already in this codebase.

**Invoiced and collected are different columns.** Invoiced is the sum of
invoice totals. Collected is what is actually paid. Showing one number labeled
"revenue" will get asked about within a day.

**Hours come from labor lines.** Sum the hours field on labor line items. If
hours are not stored as a number anywhere - only as a dollar amount - say so
rather than dividing dollars by the current rate. Dividing by the current rate
produces a number that silently changes when the rate changes, and it is wrong
for every historical job. That is a build blocker worth reporting, not working
around.

**Watch the column trap.** On `hd_work_order_line_items`, `unit_cost` is cost
and `unit_price` is sell. On `hd_quotes.line_items` it is the opposite -
`unit_cost` is the sell price and `unit_cost_base` is cost. Revenue uses sell.
Getting this backwards is what produced the doubled markup.

**Scope to the business.** Every query filters by business_id through RLS.
Kurt must never see Brock's numbers and vice versa.

### 5.2 Audit export

Same rollup, different wrapper. A date range labeled "policy period" rather
than a calendar year, and an output a carrier will accept.

One page per export, headed with the shop's legal name, address, the policy
period dates, and the date generated. Then the category table:

    equipment class | units in class | units serviced | jobs
                    | labor hours | total invoiced

Then an appendix listing every unit in the period: class, unit identifier,
make, model, year, serial or VIN, jobs, hours, invoiced.

Two outputs, same data: a PDF to hand over, and a CSV because an auditor will
ask for the numbers in a spreadsheet.

Rules that carry over from 5.1: recorded values only, never recomputed;
invoiced and collected stay separate columns; nothing is rounded on the way
in. One addition - the footer states the generated date and the source
("Generated from work orders and invoices recorded in NWI Suite"), because an
auditor will ask where the numbers came from.

Where the labels will change once Kurt answers: "equipment class" should
become whatever his policy calls it, and the category names should match his
insurer's wording rather than ours. Build it with the labels configurable so
that is a settings change, not a rebuild.

### 5.3 Audit packet - the documentation export

This is the piece an auditor most likely actually asks for, and the data is
already there. Nothing new gets collected; it gets assembled.

For a date range, produce one packet containing, per work order:

    work order number, unit (identifier, class, make, model, year, serial/VIN)
    customer and fleet account
    date opened, date closed, date invoiced
    the authorization record: approved_at, approval_method,
        customer_po_number, and who approved
    the approved quote as presented, including its recorded labor rate
    parts installed, with quantity and the price as recorded
    labor lines with hours and the recorded rate
    the tech who performed the work
    invoice number and total

Output as a single PDF with one work order per page plus a cover summary, and
a CSV of the same rows for an auditor who wants to total it himself.

Two derived figures on the cover, because they answer custody questions
directly:

- Peak concurrent units in possession during the period, with the date it
  occurred. Derived from work order open and close dates, no new data needed.
- Count of work orders with no recorded authorization. This number should be
  zero. If it is not, that is worth Kurt knowing before an auditor finds it.

Hard rule, same as everywhere else: every value is the value recorded on the
document. An audit packet that recomputes anything from current settings is
worse than useless.

## 6. Bulk categorize

Kurt already has units. A report with everything under "Uncategorized" is
useless to him Monday.

On the units list: a category column with an inline dropdown, plus checkbox
multi-select and "set category for selected". No separate wizard, no CSV
import. He has tens of units, not thousands, and he will do it in one sitting
while on the phone.

## 7. Build order

Step 0 is recon and it gates everything. Run this first, by itself:

```
Recon only, no code changes, under 250 words.

1. On hd_work_orders: how many rows total, and how many have unit_id populated
   versus null? Same for fleet_account_id.
2. When a work order is created or saved, does any code path write unit_id?
   Show the file and line, or say it does not.
3. Do hd_invoices carry unit_id, or only a link back to the work order?
4. Where do labor hours live on a work order, and are they stored per line
   with hours as a number, or only as a dollar amount?
5. Does hd_units have any column describing equipment type or category?
```

Then, depending on what comes back:

1. If `unit_id` is not being written - fix that write path first. Nothing else
   matters until a work order remembers which unit it was for.
2. Backfill `unit_id` on Kurt's existing work orders where it can be inferred.
   Report what cannot be inferred rather than guessing.
3. Merge the duplicate taylor oil company unit. Brock runs the SQL.
4. Migration: `hd_equipment_categories`, `hd_units.category_id`, the serial
   unique constraint, RLS. Brock applies it.
5. Default category seeding per business.
6. Bulk categorize UI on the units list.
7. The two report tables in Financials.
8. The audit export - section 5.2.
9. The audit packet - section 5.3. This is the highest-value item in the
   build and it collects no new data, so it can ship alongside or just after
   the report tables.
10. Smoke flows: a unit with several invoiced jobs rolls up correctly; an
   uncategorized unit appears under Uncategorized; a work order with no
   invoice does not count as a job; invoiced and collected differ when an
   invoice is unpaid; two businesses cannot see each other's rows.

## 10. Phase 2 - compliance and recertification tracking

Not in the Monday build, but this is the piece with ongoing value rather than
once-a-year value, and it is worth specifying properly after phase 1 lands.

Aerial devices and insulated booms carry inspection obligations on a clock:
annual and periodic inspections, dielectric testing on insulated units, and
structural recertification commonly at ten years then every five after. A shop
servicing them has to prove it tracks these. Nobody in Kurt's world has it in
software.

Shape of it:

- A `hd_unit_compliance_items` table: unit_id, item type (annual inspection,
  periodic, dielectric test, structural recertification, other), interval,
  last performed date, next due date, performed by, certificate document.
- Due-soon and overdue views, per unit and across the shop.
- Attach the certificate or test report to the record. Note the open issue:
  Supabase Storage is not currently backed up. Fix that before telling a
  subscriber their compliance certificates are safe here.
- Technician certifications with expiry: ANSI/OSHA qualifications per tech,
  flagged before they lapse.
- Link a compliance item to the work order that satisfied it, so the audit
  packet in section 5.3 can show the proof alongside the job.

Confirm the actual intervals with Kurt rather than taking them from a web
summary. He does this work; the numbers should come from him, same as the
reefer labor hours.

## 11. Later

Not in either phase:

- Payroll by class. NWI has no payroll data. Out of scope, permanently, until
  there is a reason that does not exist today.
- Loss runs and claims history. Those come from his carrier.
- Subcontractor certificates of insurance. Document storage at best.
- Batch or scheduled audit exports. Kurt runs it when he needs it.
- Equipment values or replacement cost. Garagekeepers audits ask for peak
  aggregate value of customer units in possession. NWI can derive peak
  concurrent unit count without values; the dollar figure needs Kurt entering
  values on units. Offer it as a nullable field, never invent a number.

One thing to hold to when talking to Kurt: Brock will not ask him for
Fullbay's feature list. Ask what his insurance company asks him for, and which
kind of audit he is facing. That is his own business information and a fair
question.
