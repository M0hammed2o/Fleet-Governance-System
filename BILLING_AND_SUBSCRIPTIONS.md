# BILLING_AND_SUBSCRIPTIONS.md

Phase 10 — subscriptions, billing and invoicing. See PRODUCT_REQUIREMENTS.md "P10 — Subscriptions,
billing and invoicing" for the requirement-by-requirement acceptance criteria and DECISIONS.md D-035/D-036
for the specific design decisions this phase made and why.

## Commercial model

One shared multi-tenant SaaS platform. Each customer tenant is billed a **configurable monthly base
platform fee** plus a **configurable fee per active vehicle**. Current defaults (set in
`PlatformBillingSettings`, changeable without a code deployment): **R1,999/tenant/month base fee**,
**R299/active vehicle/month**. Currency ZAR. Prices exclude VAT unless the platform company's own VAT
registration is configured (see "VAT configuration" below). Hardware, tracker hardware, and
tracking-company subscriptions are explicitly excluded from this platform's billing. Initial onboarding
and the first training session are free; additional training is invoiced separately (currently a manual,
off-platform process — not automated in this phase). There is no automatic free trial.

**These values are never hard-coded constants scattered through the application.** They live in two
places:

- `PlatformBillingSettings.defaultBaseFeeMinorUnits` / `defaultPerVehicleFeeMinorUnits` — the platform-wide
  default, editable by a Platform Administrator (`platformBilling:CONFIGURE`).
- `PlatformPricingVersion` — an **append-only** history of platform-default price changes over time (a
  change is always a new row with its own `effectiveFrom`, never an edit to an old one).
- `TenantPricingAgreement` — an **append-only** history of a specific tenant's own negotiated price, when
  one exists. Resolution order (`getEffectivePricingForTenant()`): the tenant's own agreement with the
  latest `effectiveFrom <= now` wins; if none exists, the platform default in effect at that same moment
  applies.

Because both tables are append-only, **an issued invoice's price is never retroactively affected by a
later negotiation or a platform-wide price change** — every invoice stores its own supplier/customer/price
snapshot at issue time (`Invoice.supplierSnapshot` / `customerSnapshot`, plus the line items themselves).

## Money handling

Every monetary field in every Phase 10 model is an **integer count of minor currency units** (ZAR cents),
never a JavaScript/Postgres float. R1,999.00 is stored and computed as `199900`. VAT rates are integer
basis points (`1500` = 15.00%). All arithmetic (`src/lib/billing/money.ts`) is integer multiplication and
addition, with a single, explicit round-half-up division only for the final VAT-amount calculation. See
`tests/billing-money.test.ts` for the exact worked example this was verified against.

## Active-vehicle calculation

A vehicle counts as **billable** for a monthly snapshot if, at snapshot-generation time:

```
archivedAt IS NULL AND operationalStatus != 'DECOMMISSIONED'
```

A vehicle temporarily in `WORKSHOP_LOCKOUT` or `SECURITY_LOCKOUT` is **still billable** — it remains a
fleet asset the tenant is actively managing through the platform. Only a permanently retired
(`DECOMMISSIONED`) or archived vehicle is excluded. This rule lives in exactly one place
(`countActiveVehiclesForTenant()`, `src/lib/repositories/billable-vehicle-repository.ts`).

**Worked example (verified in `tests/billable-vehicle-repository.test.ts` and
`tests/billing-money.test.ts`):** 15 active vehicles, platform default pricing → base fee R1,999.00 +
vehicle charge (15 × R299.00 = R4,485.00) = **subtotal before VAT R6,484.00**. VAT total depends on whether
VAT is configured (see below).

## Billing period and snapshot

A `BillingPeriod` is one UTC calendar month per tenant (`billing_periods_tenantId_periodStart_key` is a
hard uniqueness constraint — the recurring job, a manual "generate now" action, or a genuine race between
the two can never create two periods for the same tenant+month). A `BillableVehicleSnapshot` is generated
once per period, recording the **exact vehicle IDs and count** used, and the **exact price applied** — both
hard-constraint-backed idempotent (`billable_vehicle_snapshots_billingPeriodId_key`). Generating a snapshot
twice for the same tenant+period, including under real concurrency, always returns the identical row.

## Invoice lifecycle

1. **Generation** (`generateInvoiceForBillingPeriod()`): requires an existing snapshot for the period;
   idempotent per period (`invoices_billingPeriodId_key`). Allocates a sequential invoice number
   (`<prefix>-<zero-padded sequence>`) via a single atomic Postgres `UPDATE ... RETURNING` on
   `PlatformBillingSettings.nextInvoiceSequence` — collision-free under concurrency by construction, not by
   convention. Snapshots the platform's own and the tenant's billing-profile details into
   `supplierSnapshot`/`customerSnapshot` (immutable from that point on). Status starts `ISSUED`.
2. **PDF rendering and storage**: rendered via `pdfkit` (pure-JS, no headless browser) and stored through
   the *existing* `MediaAsset`/object-storage/signed-URL architecture (`MediaAssetOwnerType.INVOICE`,
   category `GENERATED_REPORT`) — never a public/permanent URL, always a short-lived signed download URL
   minted after an `invoice:VIEW` permission check. A PDF-rendering failure does not corrupt or roll back
   the financial record: the `Invoice` row is created first, in its own transaction, and the PDF is
   attached afterward (best-effort, with its own audit trail on failure — `invoice.pdfGenerationFailed`).
3. **Overdue**: the recurring job marks any `ISSUED` invoice past its `dueDate` as `OVERDUE` and moves the
   tenant's subscription to `PAST_DUE` if it was `ACTIVE`.
4. **Paid**: only ever set by a genuinely-verified payment-provider webhook or an explicit, audited manual
   payment record — see "Payment lifecycle" below. There is no generic "update invoice status" endpoint.
5. **Void / reissue**: a controlled correction process, never a silent in-place edit. `voidInvoice()`
   requires a reason, refuses on an already-`PAID` or already-`VOID` invoice (use a `CreditAdjustment`
   instead for a paid invoice's correction). `reissueInvoice()` requires the original to already be `VOID`,
   creates a brand-new invoice with a fresh sequential number linked back via `reissueOfInvoiceId`, and
   copies the original's line items. Both are fully audited.

### VAT configuration

**A document is only ever labelled a "TAX INVOICE" with a VAT line when the platform's own VAT
registration number *and* a VAT rate are both configured** (`PlatformBillingSettings.vatEnabled` +
`vatRegistrationNumber` + `vatRateBasisPoints`, all set). Enabling `vatEnabled` without a rate configured is
rejected outright (`VatConfigurationError`). If VAT details are absent, every invoice is a plain
"INVOICE" with an explicit "VAT was not charged on this invoice" notice — never silently presented as a
tax invoice. Visually verified in a real browser for both cases (see WORKLOG.md).

## Payment lifecycle

`Payment` records are only ever created by two paths:

- **`processPaymentProviderEvent()`** — the payment-provider webhook endpoint (`/api/billing/webhook`).
  Order of checks: signature/authenticity first (never even parses the payload's business meaning before
  this passes) → duplicate-event check (`payment_provider_events_provider_externalEventId_key`, a hard DB
  constraint, not a best-effort lookup) → resolve the invoice → amount **and** currency must match the
  invoice exactly, or the event is rejected and audited → only a genuinely `SUCCESSFUL` provider status
  ever marks the invoice `PAID`; `PENDING`/`FAILED` are recorded and never do.
- **`recordManualPayment()`** — an authorised platform finance user's record of a payment received outside
  the provider (e.g. an EFT). Always requires a proof/reference string, is permission-gated
  (`payment:CREATE`), clearly labelled `method: MANUAL`, and mandatorily audited. **Never stores a card
  number, CVV, or online-banking credential** — the `Payment` schema has no such field at all (see
  `tests/billing-tenant-isolation.test.ts`).

Nothing in this codebase ever trusts a browser-supplied "payment succeeded" claim.

A successful payment (either path) triggers, best-effort and without reversing the payment on failure:
subscription auto-restoration if no other invoice is outstanding, and the invoice-email workflow below.

## Payment-provider adapter (P10F)

`src/lib/billing/payment-provider.ts` — the same interface-plus-mock pattern already used throughout this
codebase (`FacialVerificationProvider`, `TelematicsProvider`, `ObjectStorageProvider`,
`RetentionNotificationProvider`):

- **`PaymentProvider`** interface: `createCheckoutSession`, `getPaymentStatus`,
  `validateWebhookAuthenticity`, `parseWebhookEvent`, `refund` (optional — returns `null` when unsupported,
  explicitly deferred).
- **`NoOpPaymentProvider`** — reports "no production provider configured" honestly on every call, never
  fabricates a successful payment. This is what runs by default.
- **`MockPaymentProvider`** — deterministic, in-memory, dev/test only. Never contacts any real external
  service. `PAYMENT_PROVIDER=mock` opts into it.

**No production payment gateway is selected or configured.** PayFast, Peach Payments, Yoco, and Stitch were
all considered as likely South African candidates but no vendor decision or paid account has been made —
adding one later means implementing this same `PaymentProvider` interface, nothing in `invoice-repository.ts`
or `payment-repository.ts` needs to change.

## Billing-email adapter (P10H)

`src/lib/billing/billing-email-provider.ts` — same pattern:

- **`NoOpBillingEmailProvider`** — reports non-delivery honestly, never a real send.
- **`MockBillingEmailProvider`** — logs the send (recipient, subject, invoice number, PDF byte count —
  never the PDF content) to the server console for dev-visibility. `BILLING_EMAIL_PROVIDER=mock` opts in.

**No production transactional-email vendor is configured.** `sendInvoiceEmailForPayment()` is idempotent
per `(invoiceId, relatedPaymentId)` via a hand-authored partial unique index
(`billing_email_deliveries_one_per_invoice_payment_event`) — a duplicate webhook or duplicate manual
approval for the same payment event can never queue the invoice email twice. A `RESEND` is always a
deliberate new row, recording who requested it. A failed send is recorded (`status: FAILED`) and never
reverses the payment that triggered it — it becomes a visible, retryable delivery failure, not a silent
gap.

## Subscription status, access control and suspension (P10K)

`SubscriptionStatus`: `PENDING` → `ACTIVE` (on first invoice) → `PAST_DUE` (an invoice went overdue) →
`SUSPENDED` (grace period elapsed) → back to `ACTIVE` on resolution, or `CANCELLED`.

**Continuity-mode decision (D-036):** suspension for non-payment **never blocks gate operations, evidence
capture, exception handling, reconciliation, or any Phase 1-9 safety-critical workflow.** The *only* access
boundary a `SUSPENDED` subscription enforces is refusing to **create a new Movement**
(`createMovement()` throws `TenantAccessSuspendedError`) — every movement already in flight can still be
completed at the gate. This was a deliberate, narrow choice: building a comprehensive "block everything
except billing and support" access layer across the entire existing permission system would be high-risk
and could silently create a genuine safety gap for a customer that stops paying. The customer's own
Accountant/Company Administrator and Platform Administrator always retain access to billing/payment screens
to resolve the situation (they only ever needed the existing `tenantBilling`/`invoice`/`payment`/
`tenantSubscription` permissions, none of which suspension touches).

The grace period (`isEligibleForAutomatedSuspension()`, a pure function) is configurable per tenant
(`TenantBillingProfile.gracePeriodDays`, falling back to `PlatformBillingSettings.defaultGracePeriodDays`
— 14 days by default). Both automated (actor `null`) and explicit platform-admin suspensions/restorations
are equally, fully audited.

## Recurring billing job (P10L)

`runRecurringBillingCycle()` (`src/lib/repositories/recurring-billing-repository.ts`), wrapped in the
existing `lib/jobs/` architecture (`runJob()` — hard per-job-name concurrency guarantee via a partial
unique index, `JobRun` audit record) as job name `billing.runRecurringCycle`
(`POST /api/jobs/billing/run-recurring-cycle`, `npm run job -- billing.runRecurringCycle`).

Each run: snapshots every `ACTIVE`-status tenant (excluding the platform tenant itself), generates one
invoice per tenant per period (idempotent — see above), marks overdue invoices, and applies the automated-
suspension policy. **Repeated execution for the same date/period never duplicates an invoice, a charge, or
a suspension action** — proven directly in `tests/recurring-billing-repository.test.ts` (a triple-run
idempotency case) and by the DB-level uniqueness constraints the whole design rests on, not just
application-level checks.

**No production scheduler is configured to call this job on a timer** — same disclosed gap as every other
Phase 8E-004 job (TODO.md "Blocked"). The endpoint, service-token auth boundary, CLI, concurrency
protection, and audit trail all exist and are tested; nothing invokes it periodically in this environment.

## Permissions (P10M)

Seven new resources, following the existing least-privilege convention (`src/lib/auth/permissions.ts`):
`tenantBilling` (VIEW/EDIT), `pricingAgreement` (VIEW/EDIT, platform-only in the seed), `invoice`
(VIEW/CREATE/EDIT), `payment` (VIEW/CREATE), `billingEmail` (VIEW/CREATE), `tenantSubscription`
(VIEW/CONFIGURE), `platformBilling` (VIEW/CONFIGURE). Grant summary (`prisma/seed.ts`):

| Role | Grants |
|---|---|
| Company Administrator | `tenantBilling:VIEW`, `invoice:VIEW`, `tenantSubscription:VIEW` (oversight only) |
| Accountant / Finance and Compliance Officer | `tenantBilling:VIEW/EDIT`, `invoice:VIEW`, `payment:VIEW/CREATE`, `billingEmail:VIEW/CREATE`, `tenantSubscription:VIEW` (the operational owner) |
| Internal Investigator / Auditor | `tenantBilling:VIEW`, `invoice:VIEW`, `payment:VIEW`, `tenantSubscription:VIEW` (full read-only) |
| Executive Read-Only Viewer | `tenantBilling:VIEW`, `invoice:VIEW`, `tenantSubscription:VIEW` |
| Gate Security Officer, Dispatch and Logistics Officer, Security Supervisor / Approving Manager, Fleet and GPS Manager, External Reviewer | **none** — deliberately, per the explicit "should not receive unnecessary billing permissions" instruction |
| Platform Administrator | every Phase 10 resource, all actions — a first-class platform-admin function (mirrors `platformTenant`, D-005) |
| Platform Support Analyst | **none** — billing operations are not a support-access-session concern |

Audited actions include (non-exhaustive, see `recordAudit()` call sites across `src/lib/repositories/
{platform-billing,tenant-billing,subscription,billable-vehicle,invoice,payment,billing-email}-repository.ts`):
pricing changes, billing-profile changes, subscription status changes (including automated), invoice
generation/void/reissue, invoice PDF downloads, payment attempts, successful/failed/rejected payment
events, manual payment approval, billing-email sends/resends, webhook rejection (invalid signature, amount
mismatch, currency mismatch, unresolved reference).

## Security and tenant isolation (P10N)

- **Cross-tenant access**: every tenant-facing route hardcodes `session.tenantId`, never a client-supplied
  tenant id. Every platform-side route that *does* accept an explicit tenant id is gated by a
  platform-only permission (`platformBilling`, or a repository-internal `CONFIGURE`-level check no
  customer role holds). Proven both at the unit level (`tests/invoice-repository.test.ts`,
  `tests/payment-repository.test.ts`, `tests/billing-tenant-isolation.test.ts`) and over real HTTP in
  `e2e/billing-workflow.spec.ts` (a second, freshly-created tenant genuinely receives a 404 for another
  tenant's invoice).
- **Invoice PDF access**: always a short-lived signed URL via the existing `mintSignedUrlForMediaAsset()`
  boundary, gated by `invoice:VIEW`, never a public/permanent link.
- **Webhook authenticity**: `validateWebhookAuthenticity()` runs before any payload content is trusted;
  an invalid signature is rejected and audited, never silently ignored.
- **Duplicate webhooks**: idempotent by a hard DB constraint, not a best-effort check — proven with real
  concurrent/duplicate delivery in tests.
- **Client-supplied payment success**: there is no code path anywhere that lets a client mark an invoice
  paid directly — only a server-verified webhook or an explicit manual-payment record ever does.
- **Invoice-number uniqueness under concurrency**: a single atomic Postgres `UPDATE ... RETURNING`, proven
  with 20 genuinely concurrent allocations producing 20 unique numbers.
- **Secrets**: no production payment or email provider credential exists anywhere in this codebase (none
  configured). The mock provider's fixed dev-only webhook-signing string is not a rotatable secret since no
  real provider is wired up.
- **Logs/audit content**: the `Payment` schema has no field capable of storing a card number, CVV, or
  banking credential. `MockBillingEmailProvider`'s console log includes recipient/subject/invoice
  number/byte-count only, never the rendered PDF content.

## What's real vs mock vs still blocked

| Layer | Status |
|---|---|
| Billing data model, pricing versioning, invoice/payment/email domain logic, permissions, access control, recurring job | **Real, working, tested** — no vendor dependency |
| Invoice PDF generation and storage | **Real** — `pdfkit` + the existing object-storage architecture, not a placeholder |
| `PaymentProvider` interface + `NoOpPaymentProvider` | **Real** interface and honest no-op |
| `MockPaymentProvider` | **Dev/test only** — deterministic, never contacts a real service |
| `BillingEmailProvider` interface + `NoOpBillingEmailProvider` | **Real** interface and honest no-op |
| `MockBillingEmailProvider` | **Dev/test only** — logs to console, never sends a real email |
| A real payment gateway (PayFast/Peach/Yoco/Stitch/other) | **Blocked** — no vendor decision, no paid account (TODO.md) |
| A real transactional-email vendor | **Blocked** — no vendor decision, no paid account (TODO.md) |
| Production scheduler for the recurring billing job | **Blocked** — same hosting/scheduler decision every other Phase 8E-004 job already depends on |
| Additional training invoicing | **Not automated** — remains a manual, off-platform process |

## Decisions still required from the business

1. Which production payment gateway to use (and its account/credentials) — PayFast, Peach Payments, Yoco,
   and Stitch are all plausible South African options; none has been evaluated for exact webhook
   shape/fee/settlement terms.
2. Which transactional-email vendor to use for invoice delivery.
3. The platform company's real legal name, registration number, VAT registration status/number, and
   banking details (`PlatformBillingSettings` currently holds fictional dev/demo values, never real
   business information).
4. Whether/when to register for VAT, and the applicable rate, if the business isn't already VAT-registered.
5. Confirmation of the exact grace-period policy (currently 14 days, configurable) and whether automated
   suspension should be enabled in production from day one or only after a manual-review period.
6. A production hosting/scheduler decision (already blocking several other Phase 8E-004 jobs) — needed
   before the recurring billing job can actually run unattended.

## How to add a real payment gateway later

1. Implement `PaymentProvider` (`src/lib/billing/payment-provider.ts`) against the real vendor's SDK/API —
   `createCheckoutSession`, `getPaymentStatus`, `validateWebhookAuthenticity`, `parseWebhookEvent`, and
   (if supported) `refund`.
2. Point `getDefaultPaymentProvider()` at the new implementation, gated by an environment variable (the
   same `PAYMENT_PROVIDER` switch already used for `mock`).
3. Nothing in `invoice-repository.ts`, `payment-repository.ts`, `billing-email-repository.ts`, or any route
   needs to change — they only ever depend on the `PaymentProvider` interface.
4. Add the real credential(s) to environment variables outside the repo (never committed) and update
   `.env.example` with the variable *names* only.
