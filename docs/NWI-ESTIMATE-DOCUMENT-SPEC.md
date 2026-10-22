# NWI Estimate and Invoice Document Spec

Author: Brock Fleeman / NWI. Drafted 2026-10-21.
Goal: the printed quote, estimate and invoice NWI produces should be better
than the one a prospect already sends by hand.

The reference is a real estimate from Lexington's Mobile Mechanic LLC, supplied
by a live NWI trial subscriber as the document he currently uses. It is a good
document. Match it block for block, then beat it on the three things in
section 5.

Applies to LD first, because that is where the trial subscriber is. The same
blocks apply to HD; build the components once.

---

## 1. Why the reference document works

It is not a price list. It is a trust document. Three things do that work:

1. Every line carries a description underneath it explaining what the work
   involves. "Labor: Clock Spring Replacement" followed by a sentence about
   disarming the SRS system, removing the steering wheel, transferring the
   sensor and reassembling the column. That is how a mobile tech justifies
   $165 for ninety minutes to a customer who thinks it is a quick job.
2. A Scope of Work section spells out the procedure in numbered steps.
3. Warranty terms and a customer-supplied-parts policy are printed on the
   document, not implied.

NWI's current output is a table of part numbers and prices. The amounts are
right and the document says nothing.

## 2. Page structure, in order

Every block below prints in this order. A block with no content is omitted
entirely, never printed as an empty heading.

### 2.1 Business header

    business name (large)
    tagline                      <- new setting, optional, free text
    street address, city, state, zip
    phone | email | service area <- service area is a new optional setting
    logo, right-aligned          <- existing white-label logo upload

The reference carries "DEPENDABLE AUTO REPAIR - WE COME TO YOU" under the
name. That is a tagline field NWI does not have, and it costs one settings row.

A shop's address must be complete on a customer-facing document. A city and
state alone is not a remit-to address and accounts payable cannot mail a check
to it.

### 2.2 Document identity

    ESTIMATE  /  QUOTE  /  INVOICE   (the word, large)
    number
    date
    valid until        <- quotes and estimates only, default 30 days, editable
    status             <- invoices only

### 2.3 Customer block and service block, side by side

    CUSTOMER                      SERVICE
    name                          service type (on-site mobile, shop, etc.)
    address                       location of work, when not the address
    phone                         scheduled date
    email                         tech

### 2.4 Vehicle or unit block

LD:

    year make model trim/drivetrain
    VIN
    mileage                 <- see the meter reading work
    system affected         <- new free-text field, e.g. "SRS Airbag / Column"
    primary issue           <- new free-text field
    part status             <- shop-supplied | customer-supplied

HD:

    unit number, maker, model, year
    serial, BM number, VIN
    hours                   <- see the meter reading work
    fleet account
    setpoint

"System affected" and "Primary issue" are what let a customer see the job was
understood before any price appears. Both are optional and both print.

### 2.5 Itemized lines

The table, and then the thing that is missing today:

    DESCRIPTION           QTY / HRS      RATE        AMOUNT
    line description
      detail paragraph, indented, smaller type, optional

Rules:

- Every line gets an optional `detail` field, free text, multi-line. It prints
  indented under the line description in smaller type. This is the single
  highest-value change in this spec.
- A zero-dollar line prints cleanly. The reference shows a diagnostic scan as
  "included" at $0.00 and a customer-supplied part at $0.00. Both communicate
  value. Neither may render as a blank row or a dash.
- A line may be marked `included`, which prints the word "included" in the
  rate column rather than $0.00.
- A part line may be marked customer-supplied. It prints at $0.00 and triggers
  the customer-supplied-parts clause in section 2.8.
- Fees - dispatch, travel, road call, diagnostic - are lines like any other and
  carry their own detail text.

### 2.6 Totals

    labor subtotal
    parts subtotal
    fees
    tax on parts (rate%)
    tax on labor (rate%)
    TOTAL

Every rate shown is the rate the DOCUMENT recorded, never the shop's current
setting. This rule has been violated five times in this codebase and once on a
live customer invoice. See section 6.

### 2.7 Scope of work

A numbered list, free text, one step per line, printed in order. Optional, and
omitted entirely when empty.

This is where a shop explains the job. It is also the block that makes the
document worth more than its price, and the one a competitor's hand-built
Word file has and NWI does not.

Pre-fill it where the data allows: a job picked from the labor library can
carry a default scope that the tech then edits. A tech who starts from
something edits it. A tech who starts from an empty box skips it.

### 2.8 Terms

Shop-level text, set once in settings, printed on every document:

    warranty terms               e.g. 90 days / 4,000 miles on workmanship
    customer-supplied parts clause
    payment terms                e.g. Due on receipt
    how to pay                   <- remit address and/or pay link

The customer-supplied-parts clause is not boilerplate. A mobile tech
installing a customer's own part needs it in writing that the part is not
warranted and that a re-diagnosis is billable. The reference document spells
this out and NWI has nowhere to put it.

"How to pay" is currently missing entirely. An invoice that says Due on
Receipt and gives the customer no remit address and no link is an invoice that
sits.

### 2.9 Authorization

    signature line
    printed name
    date

Prints on quotes and estimates always. On an approved quote, print the
recorded approval instead of an empty line:

    Approved by <name> on <date> at <time>, via customer link,
    PO <number>

This is the block that closes the audit gap: nothing in the database currently
records WHO approved. Capture a name on the approval page, and both the
customer-facing document and Kurt's insurance audit packet get what they need
from the same field.

### 2.10 Footer

    EPA Section 608 line, where the shop has it      <- existing
    trademark disclaimer                              <- existing
    page x of y

Fix the two template bugs while in here: the business name currently prints
twice in the header, and the footer reads "No affiliation or endorsement is
implied. implied".

## 3. New settings this requires

    tagline
    service area
    full street address, city, state, zip   (make these required)
    warranty terms text
    customer-supplied parts clause text
    payment instructions / remit address
    default quote validity in days          (default 30)

All per shop, all editable, none hardcoded.

## 4. New fields this requires

On the line item: `detail` text, `is_included` boolean, `customer_supplied`
boolean.

On the document: `scope_of_work` text, `valid_until` date, `system_affected`
text, `primary_issue` text, `approved_by_name` text.

Nothing here is required. Every one of them is omitted from the print when
empty, so an existing quote prints exactly as it does today.

## 5. Where NWI beats the reference

Matching the reference is the floor. These three are the ceiling, and they are
things a hand-built Word file cannot do:

1. **It is generated, not retyped.** The reference document was assembled by
   hand for one job. NWI produces the same document from the work order in one
   click, and the next one takes no longer than the first.
2. **The approval is real.** A paper signature line is a signature line. NWI
   records who approved, when, by what method, and with what PO number, and
   prints it on the document. That is better evidence, and it is what an
   insurance auditor asks for.
3. **The job carries its history.** Photos before, during and after. The unit's
   previous work orders. The meter reading at service. The part numbers with
   their aftermarket crosses. None of that fits in a Word template.

Say the second and third out loud when showing this to a prospect. They are
the reasons to switch, and the first is the reason to stay.

## 6. Rules that do not bend

- Recorded values beat current settings. Every rate, markup, tax and term on a
  printed document is what that document stored, never what settings say now.
  An invoice printing a $135 rate beside a total built from $145 already
  reached a real customer once.
- A block with no content is omitted, never printed empty.
- Nothing is hardcoded that a shop should set.
- Existing documents must print unchanged. Every field in section 4 is
  optional and additive.

## 7. Build order

1. The line `detail` field and its printing. Highest value, smallest change.
2. Zero-dollar, included and customer-supplied line handling.
3. The terms block and its settings, including payment instructions.
4. Scope of work.
5. The header fields - tagline, service area, full address - and the two
   template bugs.
6. Valid until, system affected, primary issue.
7. The approval name, on the approval page and on the printed document.

Items 1 through 3 alone close most of the gap with the reference.
