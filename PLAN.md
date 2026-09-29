# Prevent Negative Credit Balances

## Problem

Production allowed the GitHub-linked account `rr.ashurmatov.21@gmail.com` to reach an Xport Credits balance of **-20**.

The account had 110 credits before its September 29 exports. Four sequential jobs consumed 3, 18, 17, and 92 credits, for 130 credits total. The final replies export started with 72 credits but was allowed to consume 92.

This happened because job creation only checks that the user has at least one credit. The background runner later charges the final cost incrementally without reserving credits or checking that each debit can be covered. Polar accepts usage events even when they exceed the customer's balance; Polar explicitly leaves spending enforcement to the application.

The current read-from-Polar, then-send-a-usage-event flow cannot provide a strict no-negative guarantee. The balance read and usage write are separate operations, Polar's balance may be eventually consistent, concurrent requests can observe the same balance, and a crash between Polar ingestion and the local job update can cause duplicate charging.

## Required Invariants

1. A customer's spendable credit balance can never be negative.
2. Every grant or debit is recorded exactly once.
3. Job progress, stored results, and the debit that pays for them commit atomically.
4. Concurrent jobs cannot spend the same credit.
5. Runner retries, stale-runner recovery, webhook retries, and process crashes cannot duplicate grants or debits.
6. Polar downtime may delay reporting but must not weaken local access control or lose usage records.
7. A job stopped for insufficient credits keeps all previously paid results exportable and stores no unpaid results.

## Architecture

Make PostgreSQL the authoritative source of truth for credit authorization and balances. Keep Polar as the source of purchases and as the external usage-reporting system, synchronized through idempotent webhooks and delivery tracking on ledger rows.

### User balance

Add one column to the existing `user` table:

- `credit_balance integer NOT NULL DEFAULT 0`
- a database check constraint enforcing `credit_balance >= 0`

Use the existing user row as the balance and locking boundary. No separate credit-account or reservation table is needed. The database constraint prevents any transaction from committing a negative balance.

### Credit ledger and Polar delivery

Add one `xport_credit_transactions` table. Its immutable accounting fields are:

- `operation_key text PRIMARY KEY`, also serving as the idempotency key
- user ID referencing `user.id`
- signed amount: positive for grants/refunds, negative for usage
- transaction type: signup grant, purchase, manual grant, usage, refund, or migration opening balance
- reference ID only where an actual query needs it; transaction type already identifies the operation, so no reference-type column
- creation timestamp and optional metadata
- nullable `polar_payload`, fixed at insertion when reporting is required

Track delivery on that same row with mutable fields:

- `polar_delivered_at`
- `polar_attempts`, defaulting to zero
- `polar_next_attempt_at`
- `polar_last_error`

A null payload means no reporting is required. A non-null payload with no delivery timestamp means pending. Add a partial index on `polar_next_attempt_at` for pending rows; no separate state enum or outbox table is needed.

The user row provides the spendable balance. Ledger accounting fields remain immutable and allow audit and reconciliation; delivery retries update only delivery fields. Corrections use new ledger entries.

Use namespaced operation keys such as `job:<job-id>:page:<n>` or `purchase:<order-id>`; no separate transaction UUID or idempotency column is needed. Insert the reporting payload alongside the accounting fields in the same transaction as the balance change. A small scheduled task sends pending ledger rows with the operation key as the stable Polar `externalId` and retries with backoff. Verify provider key constraints and deduplication behavior before relying on retries after an unknown network outcome.

PostgreSQL commits are the authorization boundary. Polar delivery is asynchronous reporting and must not be in the critical transaction path. Keep ledger rows after delivery; they are accounting history, not disposable queue entries.

Schema scope: one balance column and check constraint on `user`, plus one new table with an operation-key primary key, user foreign key, and delivery/query indexes. Reuse existing fetch-job and tweet columns and constraints. Split delivery into a separate table only if multiple events or destinations per transaction become necessary.

## Atomic Credit Operations

Extend the existing server-side billing module with shared transactional grant/debit functions accepting the caller's transaction, `userId`, operation key, and amount. Authenticate at the route boundary; workers use the job's `ownerUserId`. Remove synthetic billing `Request` objects and forwarded cookies/authorization headers from background runners. Page settlement commits results and billing together; no service classes or additional abstraction layers are needed.

### Debit

Within one database transaction:

1. Lock the existing `user` row with `SELECT ... FOR UPDATE`.
2. Look up the operation key. If it already exists, verify its user, amount, and operation match, then return the original settlement without changing the balance.
3. Reject the operation if the available balance is less than the requested debit.
4. Insert the ledger transaction with its Polar payload and initial delivery fields.
5. Decrement `user.credit_balance`.
6. Commit.

The row lock serializes spending for a user across concurrent requests and all Railway instances. The operation-key primary key and non-negative balance constraint protect retries and programming mistakes.

### Grant and refund

Use the same transaction boundary, but increment the balance. Key grants by the underlying business operation, such as an order, benefit grant, or manual operation, so multiple webhook deliveries for the same purchase cannot grant credits twice.

Do not hold a database transaction or row lock open while calling an external API. Fixed-cost requests debit after a successful fetch, before returning content; they need no reservation, capture, release, or expiry lifecycle.

## Resumable Fetch Jobs

Replace the current separate page-write, Polar-charge, and `chargedCredits` updates with one page settlement transaction.

For each fetched page:

1. Lock the job row and confirm the current `runner_id` and fetched cursor still match its committed state. Respect a pending stop request.
2. Lock the owner's user row. Use this job-then-user lock order consistently.
3. Deduplicate the page against stored tweets and itself, preserving order. Calculate the affordable prefix using the locked balance, stored count, and already charged credits. Include unused capacity from previously paid credits.
4. Insert only that prefix using existing uniqueness constraints, then calculate the required credit delta from the resulting unique stored count using the shared credit calculation.
5. Debit any positive delta and record one ledger transaction, including its Polar payload, for this page settlement.
6. Update page progress, cursor, and `charged_credits` under the same runner ownership condition. If any new results were unaffordable, mark the job stopped with `INSUFFICIENT_CREDITS` and clear `runner_id` in this transaction.
7. Commit all changes together.

Use a stable operation key such as:

```text
job:<job-id>:page:<committed-page-number>
```

The page number comes from the locked job's committed progress. A page with no additional charge needs no ledger entry. Preserve the existing minimum-one-credit pricing, including its empty-result behavior; if that minimum cannot be covered, stop without storing unpaid results.

Settle each page once, including an affordable partial page. Do not split it into per-credit transactions or persist the unaffordable suffix. Previously committed results remain exportable.

Stale-runner recovery resumes from committed job progress. Locking and validating the job prevents an old runner from settling after ownership changes; atomically advancing progress prevents charging an already committed page again.

## Direct API Routes

All chargeable paths must use the same transactional billing functions.

- Keep existing direct routes; migrating them into resumable jobs is outside this fix.
- Preflight locally, fetch upstream, then atomically debit the exact cost before returning content. Upstream failures create no debit. If settlement fails, return an error without the fetched content.
- Concurrent spending can exhaust the balance during the upstream call, wasting that fetch. Accept this tradeoff instead of adding reservations.
- Charge-producing operations should use `POST`, not `GET`, because billing is a side effect and must support explicit idempotency semantics.
- Update browser and CLI callers together. Reuse a client operation key on retries, scope it to the authenticated user, and bind it to the normalized request so it cannot authorize another export.
- A route must fail closed if local settlement fails. Reporting failure to Polar should not fail the user request after a successful local commit; the delivery task will retry the pending ledger row.

## Grants and Purchases

Move every source of credits onto the local ledger:

- Create the signup grant locally with a stable key such as `signup-credit:v1:<user-id>`.
- Choose one verified Polar purchase or credit-benefit grant event as the source of purchased credits; do not grant from both for the same purchase.
- Map Polar products to exact local credit amounts in one server-side source of truth.
- Key purchase grants by the immutable Polar order or benefit-grant ID.
- Update the manual grant script to call the same ledger operation rather than sending only a negative Polar usage event.

Include a Polar payload on local signup and manual-grant entries where reporting is needed. Leave the payload null on imported balances and purchased credits already applied by Polar, so delivery cannot grant them again.

Webhook handlers must acknowledge an already-processed event as success. Failed processing should return an error so Polar retries it.

## Balance Reads

The application UI, CLI account endpoint, preflight checks, and job creation must read the PostgreSQL balance. Polar's customer state may be shown only as reconciliation or reporting data, never as the authorization value.

Job creation may still reject users with zero credits for fast feedback, but that check is only advisory. The atomic debit during settlement is the enforcement boundary.

## Migration and Rollout

Prepare and test one release containing the Drizzle migration, transactional billing, ledger-based Polar delivery, webhook grants, and updated browser/CLI callers. Remove the old Polar balance authorization and synchronous ingestion paths in that release; do not maintain parallel billing implementations.

Perform one billing maintenance-window cutover:

1. Block new chargeable requests and drain or stop active jobs. Pause manual grants and coordinate signup/purchase webhook processing with the snapshot boundary; preserve events for replay.
2. Apply the migration adding `user.credit_balance`, its non-negative constraint, and the single ledger table with delivery fields.
3. Snapshot each customer's Polar balance and create one idempotent opening-balance transaction per user. Import `max(0, Polar balance)` and record the original balance in migration metadata for audit.
4. Switch all balance reads, spending, signup, purchase, and manual grants to the new implementation. Replay only grants not already represented in the snapshot, using their stable operation keys.
5. Run reconciliation and smoke checks, enable Polar delivery, then resume chargeable requests and monitor delivery failures.

The cutover must account for users without a Polar customer, duplicate/deleted Polar customers, and in-flight checkouts. Map customers to users explicitly and use one opening-balance key per user, such as `polar-opening-balance:v1:<user-id>`. Establish which purchase/signup grants are already included in the snapshot before replaying webhook events, so the import and webhooks cannot count them twice. Reconcile any clamped negative Polar balances explicitly; importing zero locally does not repair the external balance.

## Reconciliation and Operations

Provide runnable reconciliation SQL and a Polar delivery-failure log. Check:

- `user.credit_balance` against the sum of its ledger entries
- pending ledger delivery age and retry count

Use the same operation keys to trace ledger entries and Polar events when investigating external reporting discrepancies. Never silently overwrite the local balance from Polar.

Reuse the existing manual-grant script for audited adjustments through the shared ledger operation. Defer periodic reconciliation automation, dedicated metrics/alerts, and a separate administrative interface until operational needs justify them.

## Verification

At minimum, automated tests must prove:

1. Two concurrent debits against one remaining credit result in exactly one success.
2. A 92-credit export beginning with 72 credits stops at zero and stores only paid results.
3. Two concurrent jobs cannot spend the same final credits.
4. A crash after the local commit but before Polar delivery is recovered from the pending ledger row without another local debit or duplicate Polar usage.
5. A stale runner reclaim cannot charge an already settled page again.
6. Replaying a signup, purchase, or manual-grant event creates one grant.
7. Direct-route upstream failures create no debit; failed settlement returns no chargeable content; retries cannot duplicate a debit or reuse it for different input.
8. The database rejects every attempted negative user credit balance.
9. Affordable-prefix settlement handles duplicate tweets and previously paid capacity; partial and stopped jobs remain exportable with counts matching paid results.
10. A Polar outage does not permit overspending and pending ledger reports are delivered after recovery.
11. Opening-balance import and webhook replay cannot double-count the same grant.
12. Null-payload entries are never sent to Polar; delivery retries change no accounting fields or balances.

Include transaction-level integration tests against PostgreSQL; mocks alone cannot verify row locking, unique constraints, rollback behavior, or concurrent spending.

## Rejected Shortcut

Do not treat rechecking Polar before every page as the final fix. It narrows the current gap but cannot guarantee correctness because reading the balance and ingesting usage are not atomic, Polar accepts overages, balance propagation may lag, and concurrent requests may read the same available balance. A per-user in-memory mutex also fails across replicas and process restarts.

Only a transactional local authorization boundary with database-enforced invariants can reliably guarantee that balances never become negative.

## Implementation notes

- Implemented with `user.credit_balance` and one ledger table in migration `0004_adorable_toxin.sql`.
- Shared ledger functions take a database transaction and user ID; HTTP authentication remains at route boundaries.
- Direct responses are retained in ledger metadata for exact retry replay. Direct routes require POST and an operation key; browser/CLI article callers are updated.
- Purchased credits use only verified `order.paid` events. The server-side product map reuses the existing product IDs and current 125/1250-credit packs.
- Nitro schedules ledger delivery every minute. Delivery claims expire after a crash and never modify accounting fields.
- See README for local PostgreSQL/HTTP tests, migration snapshot review, cutover commands, and reconciliation SQL. Production cutover is separate from local implementation/testing.
