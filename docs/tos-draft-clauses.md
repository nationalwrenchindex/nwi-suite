# Terms of Service — draft clauses

**Status: DRAFT for attorney review. Not legal advice.** Written by inspecting what the
platform actually does, so the factual claims match the software. The legal
*effectiveness* of the liability cap, the indemnity and the arbitration question are
exactly the parts that need a lawyer, and they are flagged inline.

**Defined terms used below**, matching the existing page: *Service* = National Wrench
Index Suite. *Subscriber* = the business holding the account. *Subscriber Customer* = the
Subscriber's own customer, whose details the Subscriber enters and who receives documents
and messages.

---

## What is already on the page, and what has to change

The live `/terms` page has: 1 Acceptance, 2 Description, 3 Billing, 4 User Obligations,
5 Termination, 6 IP, 7 Limitation of Liability, 8 SMS Messaging Consent, 9 Governing Law
(North Carolina), 10 Contact.

**One existing clause is actively against your interest.** Section 8 currently asserts, as
a statement of fact made by you:

> "Customers of Subscribers who complete a booking through a Subscriber's public booking
> page consent to receive SMS notifications related to their appointment at the time of
> booking."

That is you warranting that consent exists. It should be the Subscriber warranting it.
**Clause 2 below is drafted to replace section 8, not to sit beside it** — leaving both
would have you asserting consent in one paragraph and disclaiming it in the next, and a
plaintiff would quote the first.

---

## 1. Acceptable Use

> **1.1 One account per business.** A subscription authorises one business entity. Each
> individual who uses the Service must have their own named login. You may not share login
> credentials between people, and you may not create a single login used by multiple
> technicians, staff or locations in order to avoid additional subscriptions.
>
> **1.2 No resale or sublicensing.** You may not resell, sublicense, rent, lease,
> white-label, rebrand or otherwise make the Service available to any third party, whether
> for a fee or free of charge, except under a separate written reseller or partner
> agreement signed by us. Using the Service to deliver shop-management software to another
> business as your own product is prohibited.
>
> **1.3 No scraping or bulk extraction.** You may not use any automated means — crawler,
> scraper, bot, script or headless browser — to access, index or extract data from the
> Service, other than through an interface we document and provide for that purpose. You
> may not attempt to extract reference content (including diagnostic data, procedures,
> parts cross-references, alarm codes and maintenance intervals) in bulk for use outside
> the Service. Exporting *your own* business records is expressly permitted and is covered
> by clause 7.
>
> **1.4 No unsolicited messaging.** You may not use the Service to send unsolicited
> commercial messages, bulk marketing, or any message to a recipient who has not given you
> the consent described in clause 2.
>
> **1.5 General.** You may not reverse engineer, decompile or disassemble the Service;
> interfere with its operation or security; access another Subscriber's data; or use the
> Service for any unlawful purpose.
>
> **1.6 Enforcement.** We may suspend access immediately under clause 6 for any breach of
> this clause. Breaches of 1.2, 1.3 or 1.4 are material breaches.

**Notes.** 1.2 is deliberately broader than the current wording ("not resell, sublicense,
or otherwise provide access ... without written authorization") because that text arguably
does not reach white-labeling. 1.3's carve-out for the Subscriber's own export matters:
without it, 1.3 and 7 contradict each other.

**FLAGGED:** whether you want a *partner* exception named here depends on whether the
reseller layer in Fleet Pro is sold under separate paper. If it is, say so; if not, 1.2 as
written prohibits something you may already be doing.

---

## 2. SMS and Email — Subscriber Responsibility

*Replaces existing section 8.* This is the clause with the most exposure, because the
messages leave on **your** Twilio 10DLC registration and **your** Resend sending domain.

> **2.1 How messages are sent.** The Service sends SMS and email to Subscriber Customers
> using messaging infrastructure registered to and operated by us, including our 10DLC
> campaign registration and our verified sending domain. Messages are sent at your
> direction and on your behalf. You are the sender of record for the purposes of this
> clause.
>
> **2.2 Your consent warranty.** You represent and warrant, on a continuing basis, that for
> every telephone number and email address you enter into or cause the Service to message:
>
> (a) you have obtained and currently hold all consents required by applicable law for the
> messages that will be sent, including prior express consent (and, where the message is or
> may be construed as advertising or telemarketing, prior express **written** consent) under
> the Telephone Consumer Protection Act, 47 U.S.C. § 227 and its implementing regulations;
>
> (b) the recipient has not revoked that consent by any reasonable means, and you will
> honour and promptly record any revocation;
>
> (c) the number is not on any internal or statutory do-not-call list applicable to you; and
>
> (d) the contact details are accurate and belong to the person you intend to reach.
>
> **2.3 Your compliance obligations.** You are solely responsible for your compliance with
> the TCPA, the CAN-SPAM Act, state telemarketing and consumer-protection statutes, and
> applicable wireless carrier and industry requirements including CTIA messaging principles
> and 10DLC campaign rules. You will not use the Service to send content prohibited by
> those rules, including content relating to cannabis, firearms, gambling, high-risk
> financial services, or any unlawful subject matter.
>
> **2.4 Opt-out handling.** The Service appends opt-out instructions to SMS messages and
> processes STOP, UNSUBSCRIBE and equivalent replies. You will not attempt to defeat,
> remove or work around opt-out handling, and you will not message a recipient who has
> opted out through any channel.
>
> **2.5 Immediate suspension.** Because abuse of messaging harms every other Subscriber, we
> may suspend or terminate your messaging ability, your account, or both, **immediately and
> without prior notice**, where we reasonably believe you have breached this clause or
> where a carrier, messaging aggregator, email provider or regulator notifies us of a
> complaint, block, filtering event or investigation relating to your messages. Suspension
> under this clause does not entitle you to a refund.
>
> **2.6 Indemnity.** You will defend, indemnify and hold us harmless against any claim,
> proceeding, fine, penalty, settlement, loss, damage, cost or expense (including
> reasonable legal fees) arising from or relating to: messages sent at your direction; your
> breach of this clause; or any assertion that a message sent on your behalf lacked
> required consent. This includes claims brought by a Subscriber Customer, a carrier, a
> regulator, or a state attorney general.
>
> **2.7 Cooperation.** You will provide, within five business days of our written request,
> your records evidencing consent for any recipient we identify. Failure to do so is a
> material breach and grounds for immediate suspension.

**Notes.** 2.1 states plainly that the infrastructure is yours (the company's) — hiding
that would be worse, because the carrier record shows it. 2.6 is deliberately uncapped
relative to clause 5; see the carve-out in 5.3. 2.7 exists because in a TCPA claim the
consent record is the whole case, and if the Subscriber holds it and will not produce it,
you are defending blind.

**FLAGGED — get these reviewed, they are the sharpest items in the document:**

- **TCPA statutory damages are $500–$1,500 per message** and class actions are routine. An
  indemnity is only worth the Subscriber's ability to pay it. Ask your attorney and your
  broker whether you need (a) tech E&O / cyber coverage that contemplates TCPA, and
  (b) a requirement that Subscribers above some size carry their own.
- **Indemnity enforceability and scope** — whether you control the defence, whether consent
  to settle is required, and whether "defend" obligations are enforceable as written are
  jurisdiction-sensitive. I have not tried to resolve that.
- **Whether you are a "sender" under the TCPA** is a legal question I am not qualified to
  answer, and 2.1 does not purport to answer it — it allocates responsibility *between the
  parties*, which is a different thing from how a regulator will characterise you.
- **CAN-SPAM liability cannot be fully shifted by contract** in all circumstances. The
  clause allocates responsibility but may not insulate you from a direct claim.
- An **arbitration clause with a class-action waiver** is the single biggest structural
  protection against TCPA class exposure. Whether to include one is a real business
  decision with real downsides. **I have not drafted one — that is your attorney's call.**

---

## 3. No Warranty on Tax Calculation

> **3.1 What the Service does.** The Service includes a tax calculator that applies rates
> and settings **you** configure — including separate rates for parts and labour, whether
> each is taxable, and the treatment of shop supplies, travel and mileage — to the
> documents you create. It performs arithmetic on your inputs.
>
> **3.2 What the Service does not do.** We do not determine what is taxable in your
> jurisdiction, do not maintain or update rates on your behalf, and do not file, remit or
> report tax. Nothing in the Service is tax, accounting or legal advice.
>
> **3.3 Your responsibility.** You are solely responsible for the tax configuration you
> enter, for whether it is correct for each jurisdiction in which you do business, and for
> the tax shown on every document you issue. Treatment of labour, parts, shop supplies,
> travel time and mileage varies by state and sometimes by locality, and may change. **You
> should verify your configuration with your own accountant or tax adviser before issuing
> documents to customers, and review it when rates or rules change.**
>
> **3.4 No warranty.** We make no representation or warranty that any figure produced by
> the Service is correct for tax purposes, or that your configuration complies with any
> law. We are not liable for under-collected or over-collected tax, interest, penalties, or
> the cost of amending returns or reissuing documents.

**Notes.** 3.1 names the specific buckets the software actually has, so the clause matches
the product rather than describing a generic calculator. That specificity helps you: it
shows the subscriber was told exactly which decisions were theirs.

**FLAGGED:** if you ever ship a rates lookup, auto-updating rates, or a filing
integration, **3.2 stops being true** and this clause must change before that ships. Worth
a comment in the code where such a feature would land.

---

## 4. No Warranty on Repair, Diagnostic and Inspection Content

> **4.1 Reference only.** The Service includes reference material including diagnostic
> guidance, fault and alarm code information, repair procedures, parts cross-references,
> preventive-maintenance intervals and inspection criteria. All of it is provided as a
> convenience and as **reference material only**.
>
> **4.2 Not a substitute.** This material is not a substitute for, and does not override:
> manufacturer service information, service bulletins or specifications; applicable federal,
> state or local regulation; your employer's or customer's own procedures; or the
> professional judgment of a qualified technician or inspector. Where our content and a
> manufacturer's documentation differ, **the manufacturer's documentation governs.**
>
> **4.3 Inspections and out-of-service determinations.** Inspection checklists and criteria
> in the Service are aids to recording an inspection, not a determination of compliance.
> **Whether a vehicle, trailer or unit is placed out of service remains solely the
> determination of the qualified inspector or technician performing the inspection**, who
> is responsible for that decision and for its accuracy. The Service records what the
> inspector enters; it does not make the call.
>
> **4.4 Trademarks and independence.** Manufacturer names, model designations and trademarks
> appear for identification and compatibility reference only. We are not affiliated with,
> endorsed by, sponsored by or authorised by any vehicle, engine, refrigeration unit or
> component manufacturer. All trademarks are the property of their respective owners.
>
> **4.5 No warranty.** We make no representation or warranty as to the accuracy,
> completeness, currency or fitness for any purpose of this reference material, and
> disclaim all liability arising from reliance on it, including property damage, equipment
> damage, regulatory citation, personal injury or death, to the maximum extent permitted by
> law.

**Notes.** 4.4 matches the spirit of the trademark lines already printed on HD documents
(`Thermo King® is a registered trademark of Thermo King Corporation`, and the parallel
Carrier line). The safety framing in 4.5 is deliberate: a wrong PM interval or a missed
out-of-service defect can cause a crash, and a clause that only talks about money would
look like it had not considered that.

**FLAGGED:**

- **Personal injury and death disclaimers are limited or void in many states.** 4.5 says
  "to the maximum extent permitted by law" for that reason, but whether it survives is a
  question for your attorney — particularly for the inspection and PM content, which is the
  genuinely safety-critical part of the product.
- You asked me to leave the existing `BrandFooter` trademark line alone earlier, and I have.
  4.4 does not change it.

---

## 5. Limitation of Liability

*Extends existing section 7, which already has an AS-IS disclaimer and a fees-paid cap. Do
not stack two caps — replace, do not append.*

> **5.1 Exclusion of indirect damages.** To the maximum extent permitted by law, we will not
> be liable for any indirect, incidental, special, consequential, exemplary or punitive
> damages, or for loss of profits, revenue, business, goodwill, anticipated savings or data,
> however caused and under any theory of liability, even if advised of the possibility.
>
> **5.2 Specific exclusions.** Without limiting 5.1, we are not liable for: revenue you did
> not collect; an invoice, quote or work order that was mis-priced, mis-taxed, duplicated or
> not sent; a preventive-maintenance interval that was missed, miscalculated or not
> notified; a document a customer did not receive or did not pay; data you entered
> incorrectly; or any decision you or your technician made in reliance on the Service.
>
> **5.3 Cap.** Our total aggregate liability arising out of or relating to the Service and
> these Terms will not exceed the total fees you actually paid us in the **twelve months
> immediately preceding the event giving rise to the claim**. Where no fees have been paid,
> our total liability is one hundred US dollars ($100).
>
> **5.4 Carve-outs.** Nothing in this clause limits liability for: our fraud or wilful
> misconduct; death or personal injury caused by our negligence; **your indemnity
> obligations under clause 2.6**; your obligation to pay fees due; or any liability that
> cannot be limited or excluded under applicable law.
>
> **5.5 Basis of the bargain.** You acknowledge that the fees reflect this allocation of
> risk and that we would not provide the Service on these terms without it.

**Notes.** 5.2 names the failure modes this product can actually have, which is more
defensible than a generic list — and it names the mis-billed invoice and the missed PM you
specifically asked for. 5.3 uses a *trailing twelve months* cap rather than "all fees ever
paid": say which you want, because on a long-lived subscription they diverge a lot. 5.4 is
the clause that stops clause 2.6 being swallowed by the cap, which would make the indemnity
worthless.

**FLAGGED:**

- **North Carolina's Unfair and Deceptive Trade Practices Act (N.C.G.S. Ch. 75) provides
  treble damages**, and I do not know how a court would treat a contractual cap against a
  Chapter 75 claim. Flagging because your governing law is NC — this is a specific
  interaction worth asking about.
- Whether 5.5 ("basis of the bargain") materially helps enforceability is a lawyer question.
- 5.3's $100 floor is a convention, not a researched figure. Your call.

---

## 6. Suspension and Termination

> **6.1 Termination by you.** You may cancel at any time through your account settings or by
> written notice. Cancellation takes effect at the end of the then-current billing period.
> See clause 8 on proration.
>
> **6.2 Termination or suspension by us, with notice.** We may suspend or terminate your
> account on reasonable notice for: non-payment; breach of these Terms; or discontinuation
> of the Service or your plan.
>
> **6.3 Immediate suspension.** We may suspend immediately and without prior notice where we
> reasonably believe: clause 1.2, 1.3 or 1.4 has been breached; clause 2 has been breached,
> or a carrier, provider or regulator has raised a messaging complaint or block (clause 2.5);
> your use threatens the security, integrity or availability of the Service or another
> Subscriber's data; or applicable law requires it. We will tell you the reason as soon as
> reasonably practicable.
>
> **6.4 Effect.** On termination your right to access the Service ends. Clauses 2.6, 4, 5, 7
> and 9 survive.
>
> **6.5 Data export window.** For **thirty (30) days** after termination we will keep your
> business records available for export in a machine-readable format, and will not delete
> them during that window except where law requires. You are responsible for exporting
> within it. After the window we may permanently delete your data. **During a suspension
> (as opposed to a termination) we will provide a reasonable means to export your data on
> request, even where other access is suspended.**
>
> **6.6 No refund on termination for cause.** Termination or suspension under 6.2 for breach,
> or under 6.3, does not entitle you to any refund.

**Notes.** 6.5's second sentence matters and is easy to omit: a subscriber suspended for a
messaging complaint still owns their customer list, and withholding it to force payment
reads badly and may be unlawful. The thirty days is a placeholder — your call, but it
should be a stated number, since you asked for a "stated window".

**FLAGGED:** if you ever suspend for non-payment while holding the only copy of a
subscriber's records, check with your attorney whether any NC statute or your payment
processor's rules constrain that.

---

## 7. Data Ownership and Our Role

> **7.1 Your data is yours.** You retain all right, title and interest in the data you and
> your personnel enter into the Service, including Subscriber Customer records, vehicle and
> unit records, work orders, quotes, invoices, inspections and photographs ("**Your Data**").
> We claim no ownership of it.
>
> **7.2 Our licence.** You grant us a limited, non-exclusive licence to host, store, copy,
> transmit, display and process Your Data **solely** to: provide and support the Service;
> send the documents and messages you direct us to send; maintain security, backups and
> disaster recovery; and comply with law.
>
> **7.3 What we will not do.** We will not sell, rent or licence Your Data. We will not use
> Subscriber Customer contact details to market our own products to those people. We will
> not contact your customers on our own behalf. We will not use Your Data to build a
> competing shop in your market.
>
> **7.4 Aggregated and de-identified data.** We may create aggregated, de-identified
> statistics that cannot reasonably be used to identify you, your business or any
> Subscriber Customer, and use them **solely internally** to operate, secure and improve
> the Service. **We will not publish, share or sell them.**
>
> **7.5 Export.** You may export Your Data at any time during your subscription, and during
> the window in clause 6.5.
>
> **7.6 Our role.** As between us, you are the controller of personal data in Your Data and
> we act as a processor or service provider on your instructions. You are responsible for
> having a lawful basis to collect and share it with us.

**Notes.** 7.3 is the clause a subscriber will actually care about and it is worth keeping
in plain words.

**7.4 was narrowed to internal use only on 2026-10-06, and the reason matters.** The live
`/privacy` page says flatly: "We do not share your data with any other third parties. We do
not sell, rent, or trade personal information to data brokers, advertisers, or any other
entities." It lists exactly four processors (Stripe, Twilio, Supabase, Anthropic) and never
mentions aggregated or de-identified data at all.

The original 7.4 permitted *use* without saying anything about disclosure, which was not a
direct contradiction but became one the moment an aggregate was published — a benchmark, a
marketing figure, "shops using NWI bill 12% more". Narrowing the clause rather than
loosening the privacy policy was the smaller change and keeps the plain promise intact.

**If you later want to publish benchmarks, this is the clause to change — and `/privacy`
needs a matching paragraph in the same release, not afterwards.**

**FLAGGED:**

- **7.6 may not be sufficient on its own.** If any subscriber has customers in California,
  Virginia, Colorado, Connecticut, Utah, Texas or similar, you may need a **Data Processing
  Addendum** with the specific statutory terms (purpose limitation, subprocessor flow-down,
  deletion and assistance obligations). A single sentence in a ToS is usually not enough.
  **I have not drafted a DPA.**
- 7.4 and your Privacy Policy must agree. I have not reconciled them — the Privacy Policy
  at `/privacy` should be read against this clause before either ships.
- Whether to promise anything about **breach notification timing** is a decision I have
  deliberately not made for you.

---

## 8. Billing

*Extends existing section 3.*

> **8.1 Subscription.** The Service is sold as a recurring subscription billed in advance,
> monthly or annually as selected. Fees and included features are those shown at purchase.
>
> **8.2 No free trial.** We do not offer free trials. Access begins on payment.
>
> **8.3 Authorisation.** You authorise us and our payment processor to charge your payment
> method on each renewal until you cancel. You are responsible for keeping it current;
> failure of payment may result in suspension under clause 6.2.
>
> **8.4 Renewal.** Subscriptions renew automatically for successive periods of the same
> length unless cancelled before the end of the current period.
>
> **8.5 Cancellation.** Cancellation stops future renewals. It takes effect at the end of
> the current paid period, and you keep access until then.
>
> **8.6 No proration.** **Fees are not prorated or refunded**, in whole or in part, for
> partial periods, unused time, downgrades, or periods following cancellation or
> termination, except where we state otherwise in writing or where a refund is required by
> law.
>
> **8.7 Changes to fees.** We may change fees for future periods on at least thirty (30)
> days' notice before the change takes effect. Continuing to use the Service after that
> date constitutes acceptance; if you do not accept, cancel before it takes effect.
>
> **8.8 Taxes.** Fees exclude any sales, use or similar taxes on the subscription itself,
> which are your responsibility where applicable. This is separate from clause 3, which
> concerns tax on **your** documents to **your** customers.

**Notes.** 8.8 keeps two different taxes from being confused — the tax on the subscription
and the tax the subscriber charges their customer. They are unrelated and the distinction
is easy to lose.

**FLAGGED:**

- **Verify 8.2 against the live Stripe configuration.** If any price has a trial period
  configured, 8.2 is false the day it ships. I have not checked Stripe and cannot from here.
- **8.6 is the clause most likely to cause a chargeback dispute.** Your payment processor's
  rules may effectively override it, and some jurisdictions restrict no-refund terms for
  consumers. Most subscribers are businesses, which helps, but not all will be.
- Auto-renewal disclosure laws (several states, notably California) have **specific
  formatting and pre-renewal notice requirements**. 8.4 states the fact; it does not
  attempt to satisfy those statutes. Worth asking about if you sell outside NC.

---

## 9. Governing Law

*Existing section 9 already does this.*

> **9.1 Governing law.** These Terms and any dispute arising out of or relating to them or
> the Service are governed by the laws of the State of North Carolina, without regard to its
> conflict-of-laws rules.
>
> **9.2 Venue.** The state and federal courts located in North Carolina have exclusive
> jurisdiction, and each party consents to venue there and waives any objection based on
> inconvenient forum.
>
> **9.3 No application of the UN Convention on Contracts for the International Sale of
> Goods.**

**FLAGGED:** section 9 as written is already adequate. The open question is **whether to
add arbitration and a class-action waiver** — see the flag under clause 2. That decision
belongs to your attorney, and it is the one with the largest effect on your TCPA exposure.

---

## 10. Changes to These Terms, and Recorded Acceptance

> **10.1 Versioning.** These Terms carry a version identifier and an effective date, both
> shown at the top of the published Terms. We maintain the superseded versions and will make
> a prior version available on request.
>
> **10.2 Notice of changes.** We may change these Terms. For any change that materially
> reduces your rights or materially increases your obligations, we will give at least
> **thirty (30) days'** notice before the new version takes effect, by email to your account
> address and by notice within the Service. Non-material changes — corrections, clarifications
> and changes required by law — may take effect on posting.
>
> **10.3 Acceptance.** Continued use of the Service after the effective date of a new version
> constitutes acceptance of that version. Where we require it, we may ask you to accept a new
> version before continuing to use the Service.
>
> **10.4 Record of acceptance.** We record, for each account, which version of these Terms
> was accepted, by which user, and the date and time of acceptance. That record is evidence of
> the agreement between us.
>
> **10.5 If you do not accept.** You may cancel under clause 8.5 before the new version takes
> effect. Cancelling for this reason does not entitle you to a refund of fees already paid.

**Notes.** 10.2 splits material from non-material changes deliberately — a flat 30 days for
every typo correction is a promise that gets quietly broken, and a broken notice promise is
worse than a shorter one.

### FLAGGED — 10.4 describes something that does not exist yet

**There is no Terms acceptance record anywhere in the system.** I searched `src/` and all
migrations for `terms_accepted`, `tos_accepted`, `accepted_terms` and `terms_version`: no
column, no table, no code. Clause 10.4 would be a false statement of fact on the day it
published, and it is the one clause whose entire purpose is to be provable.

Before 10.4 can ship, it needs, at minimum:

- a `terms_version` constant in the codebase, and the version displayed on `/terms`
- a table — something like `terms_acceptances (user_id, version, accepted_at, ip, user_agent)`
  — with no update or delete path, so the record is append-only
- signup capturing acceptance of the current version, and a gate that asks existing users to
  accept when the version changes
- a way for you to answer "who accepted what, and when" without a manual query

That is a migration plus a signup change plus an interstitial. **I have not built any of it**
— you asked for drafting. Say the word and it is a contained piece of work.

One sequencing point: a record that only starts at launch cannot evidence agreement by
**existing** subscribers to the **current** terms. If that matters, the acceptance gate has
to run for current users too, not only new signups.

---

## Summary of everything flagged

| # | Flag | Who decides |
|---|---|---|
| 1 | Does a reseller/partner exception belong in 1.2? Fleet Pro may already need one | You |
| 2 | TCPA indemnity worth only what a subscriber can pay — insurance question | Attorney + broker |
| 2 | Indemnity scope, defence control, consent to settle | Attorney |
| 2 | Whether you are a "sender" under the TCPA | Attorney |
| 2 | CAN-SPAM liability may not be fully shiftable | Attorney |
| 2/9 | **Arbitration + class-action waiver — biggest lever on TCPA exposure** | Attorney |
| 3 | Clause 3.2 becomes false if you ever ship rate lookup or filing | You, later |
| 4 | Injury/death disclaimers limited or void in many states | Attorney |
| 5 | NC Chapter 75 treble damages vs a contractual cap | Attorney |
| 5 | Trailing-12-months cap vs all-fees-ever — they diverge a lot | You |
| 6 | 30-day export window is a placeholder | You |
| 6 | Constraints on withholding data during non-payment suspension | Attorney |
| 7 | **A DPA is probably needed and I have not drafted one** | Attorney |
| 7 | Clause 7.4 vs the existing Privacy Policy — not reconciled | You + attorney |
| 7 | Breach-notification timing promise — deliberately not drafted | You |
| 8 | **Verify "no free trials" against live Stripe prices** | You |
| 8 | No-proration vs processor rules and consumer protections | Attorney |
| 8 | State auto-renewal disclosure statutes | Attorney |
| 10 | **10.4 describes a record that does not exist — needs schema before it can ship** | You |
| — | Existing section 8 asserts customer consent on your behalf — replace it | You |
