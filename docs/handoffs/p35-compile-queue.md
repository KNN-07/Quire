# P35 operator compile queue

October 28, 2026. FINAL scoped operator queue reader and consumer.

## Accepted result

`verification-order-fixed.log` records one passing native browser scenario,
16 assertions, 47.76 seconds, and explicit `P35_STATIC_EXIT=0` and
`P35_TEST_EXIT=0`. Monitor `mon_Q1X9MHFMN5C5ZP6Y`, session `bash_398`,
completed with exit 0. The existing overview regression had already passed
in the preceding receipt and was not replayed after the test-only correction.

Parent opened all four 1440/390 light/dark captures in
`docs/evidence/p35-compile-queue/5f238288-2744-457c-ba53-8e2a1f76b96a/`.
Queue rows and Refresh/Add worker actions are readable without overlap.
Mobile uses the existing responsive table. These are deliberately scrolled
queue captures, not whole-overview visual approval.

The root `/tmp/quire-ui-integrations-H80AyI` is independently absent, and
owned web/API ports 43523 and 42889 refuse connections. The running/queued
states are seeded persisted metadata for reader verification, not evidence
of new worker execution or health. Native compiler execution remains covered
by its separate accepted receipts.

## Implementation and original validation sequence

The supplied overview's compile queue and Add worker action are now connected.
`GET /api/admin/compile-queue` requires an authenticated operator and returns
only persisted queued/running job metadata: project/branch, selected engine,
worker assignment and recorded timestamps. It is private/no-store, ordered by
queued time and ID, and paginated. Terminal jobs are excluded. It does not
return source, logs, artifacts, credentials or new cancellation authority.

The overview mounts a typed queue resource with loading/error/empty states,
explicit refresh and pagination. Add worker navigates to the existing worker
administration route; it does not pretend a worker was provisioned. Queue state
is explicitly distinguished from worker-health measurement.

Changed scope: `routes-operations.ts`, operations overview registration,
`admin/CompileQueue.tsx`, its mount in `admin/index.tsx`, and scoped tests.
An initial patch's final import hunk failed; earlier file actions applied.
Parent reread only the failed administration index and applied its exact import
and mount successfully.

The new native browser test seeds valid persisted queued/running/terminal
metadata and exercises the real reader, 401/403 denials, no-store, pagination,
invalid cursor, mounted rows, a persisted state transition followed by Refresh,
and actual worker-route navigation. This is reader/consumer proof, not a claim
that seeded running records represent newly executed compiler processes.
Previously accepted actual compilation evidence remains separate.

Contemporaneous touched-source hashes precede strict TypeScript, typed
deny-warning lint and the scoped browser plus existing overview regression in
`docs/evidence/p35-compile-queue/verification.log`.
Monitor `mon_6C9XBY9998B15JQ1`, session `bash_395`, was the initial attempt.
LSP is clean; its failures and corrections are retained below. The accepted
result above supersedes those pending states. Full D18 acceptance is not claimed.

## Retained validation corrections

`verification.log` stopped in TypeScript (exit 2) because the new test used raw
UUID strings where the endpoint returns branded IDs, and indexed an array
without narrowing. The test now uses `IdSchema` and a checked first cursor.
No production type or assertion was weakened.

`verification-types-fixed.log` passed strict types/lint and the existing
overview regression, then failed the new browser fixture's database setup:
`UNIQUE constraint failed: compile_jobs.queue_order`. The actual compiler
migration requires distinct queue positions; the fixture had omitted them.
The fixture now assigns each inserted row the next persisted queue position.
The failed attempt disposed its runtime and root through the existing stack.

Only the failed queue browser selection and changed test's static checks are
rerunning as `mon_Q1X9MHFMN5C5ZP6Y` / `bash_398`, retaining
`verification-order-fixed.log`. The passing overview regression is not repeated.
That targeted rerun is the accepted result above.
