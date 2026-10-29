# P63 independent verification

FINAL - October 28, 2026. **PASS, bounded to editor event sharing and environment
admission-error acceptance.** Both producer reports are FINAL and their claims
are supported by source inspection, raw passing receipts, unchanged current
fingerprints, actual native collaboration evidence and exact owned cleanup.
This is not global product acceptance; that gate belongs to the parent.

## Prioritized findings

- **P0/P1: none found within the audited boundary.** Authenticated event sharing
  uses a server-derived session boundary rather than actor identity alone.
  Expected admission denials do not publish environments or hide unknown errors.
- **P2: none found within the audited boundary.** The required unchanged native
  same-context late-diagnostic test passes on the final sharing implementation;
  a separate-context workaround is neither used nor accepted.
- **Evidence qualification, nonblocking:** the focused event log has aggregate
  process exit 1 because its subsequent lint found a type-only import. The test
  command itself explicitly exits 0 with 17 passing tests. The corrected final
  scoped type/lint command exits 0. Historical header-object/actor-only native
  receipts and earlier admission fixture failures are not merged into the final
  passing results.

The independently retained inspection is
`docs/evidence/p63-verification/inspection.md`. It contains current fingerprints,
raw exact-root/unit/port inspection output and independently parsed observations.

## Producer report acceptance

| Producer report | Bounded verdict | Decisive evidence |
| --- | --- | --- |
| `docs/handoffs/p63-editor-events.md` | PASS | `docs/evidence/p63-editor-events/session-native-final.log`, `native-observer.json`, `session-focused.log`, `session-static-final.log` |
| `docs/handoffs/p63-admission-errors.md` | PASS | `docs/evidence/p63-admission-errors/final-focused-tests.log`, `final-scoped-static.log`, `owned-inspection.log` |

At independent inspection, 22:56:11Z, the report hashes were respectively
`22ea5a3a1edb8c7907e076c77c54654f6667b4967868dbfb145f4ef67ee5d818`
and `95fbd3847be97a006a90d68e305eeda1085f9c0bd878bd527c87ed2ca414d6d7`.
Repository Bun was 1.4.4 with executable SHA-256
`10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235`.
All printed current event/frontend/reproducer and admission/broker/fixture
fingerprints match the producer's final settled receipts.

## Event authorization, lifetime and replay

Read `apps/web/src/features/editor/shared/events.ts` and all four adapters:
`assistant/events.ts`, `pdf/events.ts`, `review/events.ts` and
`transport/connection.ts` under the editor feature.

The registry is weakly keyed by the injected client. Shared subscribers resolve
`/api/me` and compare the claimed actor with the actual principal, then key the
scope by actor, server-derived session CSRF and exact project token. Anonymous
sharing requires a real unauthenticated result and remains token-partitioned.
Missing access metadata creates a dedicated, unshareable reader. Each replay
reopen checks the actor and session boundary again. There is no event-history
cache that can hand private replay to a replacement session.

The trusted boundary is supported by
`services/accounts/identity/authentication.ts:25-40` and
`services/accounts/identity/credentials.ts:92-97`: authentication derives CSRF
from the session-cookie token with HMAC, verifies its stored hash and returns
the principal's CSRF through `/api/me`. Server-side authorization remains in
`services/core/review/events.ts`, including current-session checks, live
revocation, project access and session-bearing operation readers.
`services/adapters/ai/store.ts:50-59` rejects private Ask access from a different
session even for the same actor.

Each subscriber has a serial callback queue; the network reader does not await
that queue. A slow callback can finish its normal API request without blocking
other consumers. Rewind uses the minimum requested cursor and existing queued
cursor boundaries suppress duplicate delivery. Callback failure removes only
its subscriber. Independent cancellation keeps remaining subscribers alive;
the last subscriber removes the registry entry and awaits reader cancellation.
Consumer-owned retry/reconnect behavior remains in the adapters.

Read the actual tests in `tests/ui-editor/events/`. The final focused raw receipt,
`docs/evidence/p63-editor-events/session-focused.log`, records 17 pass, zero fail,
120 expectations and `P63_SESSION_FOCUSED_EXIT=0`, including:

- Real identity/review/AI services, six provider requests across three distinct
  sessions for the same actor, no private-history crossover, two revocations,
  anonymous no-token HTTP 401 and inaccessible prior private runs.
- Real different-actor notification isolation and two real anonymous Viewer
  project tokens, with separate authorized histories.
- Independent lifetime, metadata-free PDF isolation, callback failure, EOF,
  pre-abort, cursor isolation and validated SSE framing.
- A held same-origin API response during rewind: the fast/late subscribers
  continue, and the released old subscriber receives exactly `[1,2,3]`.

The tests use explicit queue/event signals rather than fixed sleeps.

## Required unchanged native same-context acceptance

`docs/evidence/p63-editor-events/session-native-final.log` records the exact run:

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
bun test --preload ./tests/ui-editor/events/native-observer.ts tests/ui-editor/diagnostic-ai/boundaries.test.ts -t 'genuine late diagnostic'
```

It ran on Bun 1.4.4 from 22:41:37Z to 22:42:35Z, with one pass, zero fail,
`P63_SESSION_NATIVE_EXIT=0` and terminal `exit_code: 0`.
All eight literal pre/post fingerprint pairs match. The current five frontend
files, observer, test and fixture still match those bytes.
`boundaries.test.ts` and `fixture.ts` also match the pre-edit hashes in
`docs/evidence/p63-editor-events/baseline.md`; independent `git diff --numstat`
returns no entries for those two files.

The unchanged test creates its collaborator through `context.newPage()`.
It holds the actual provider response, mounts the second editor, saves newer
source there, releases the late result, asserts discarded proposals and intact
newer source, and checks that stale Send causes no second provider request.
The observer records key accesses and traffic; it does not replace application
responses, callbacks, cursors or the provider gate.

The complete `docs/evidence/p63-editor-events/native-observer.json` was read in
chunks and parsed independently. It records one context, two pages, all four
consumer stack paths using the same client/authority within each page, and:

```json
{"reason":"page-2-before-close","open":{"1":1,"2":1},"serverOpen":2,"pending":[]}
```

All five actual server stream lifetimes close by teardown. Independently
filtering the second-tab `/api/me`, document, suggestions and compile-preview
traffic yields 37 completed HTTP 200 requests without failures, in 9-291 ms.
Earlier mounting checkpoints do contain transient pending requests; acceptance
is recovery at the settled checkpoint, not a claim of no pending work during
navigation. `session-request-recovery.json` agrees.

Opened and inspected the actual retained screenshot:
`docs/evidence/p27-diagnostic-ai/8e1ee03e-5b8b-4943-99c1-b0b46934b052/late-proposal-discarded.png`.
It visibly shows the discarded-proposal notice, selected diagnostic, no proposed
changes panel and "Shared source saved". The adjacent `stale.json` retains the
newer collaborator source suffix and `providerRequests: 1`.
`docs/evidence/p63-editor-events/session-native-browser.json` records empty
browser and console error arrays.

## Admission mapping and no-publication acceptance

Read `services/operations/environments/create.ts`, `probe.ts` and `registry.ts`,
the actual `ControlError` class in `services/operations/installation/model.ts`,
broker denial sites and both focused tests.

`create.ts:29-42` catches only the `probeImage` rejection, requires the actual
`ControlError` class and maps exactly two codes. Every other error is rethrown
unchanged. Publication follows the successful probe; the catch does not enclose
`saveEnvironment`, broaden execution authority or introduce fallback execution.

`docs/evidence/p63-admission-errors/final-focused-tests.log:17-24` contains eight
actual authenticated HTTP responses, two attempts for each identical request
body/idempotency key:

| Actual broker condition | API result on both attempts |
| --- | --- |
| Unbuilt exact image / missing reviewed execution profile | 409 `ENVIRONMENT_EXECUTION_PROFILE_REQUIRED` |
| Exact image reviewed for another role | 403 `ENVIRONMENT_EXECUTION_POLICY_DENIED` |
| Reviewed profile with incompatible work kind | 403 `ENVIRONMENT_EXECUTION_POLICY_DENIED` |
| Unmapped `CONTROL_EXECUTION_SOURCE_INVALID` | 500 `INTERNAL_ERROR` |

The messages correctly distinguish profile availability from physical image
absence and policy compatibility from a role-only failure.
The unknown-failure response IDs
`ad3197c0-daa1-40c8-b712-1c1f9caedeff` and
`e576aadf-bece-4b94-a8e3-4c9d051a5eb6` match retained real role-journal
`ControlError: CONTROL_EXECUTION_SOURCE_INVALID` entries in
`docs/evidence/p63-admission-errors/owned-inspection.log:113-120`.
Thus the 500 is evidence of preserved unknown failure, not just an uncorrelated
generic error.

The real application runs inside kernel-attested fixture roles with an ephemeral
HTTP listener. No asserted route, identity, broker or sandbox is mocked.
`tests/operations/environments/admission-errors.test.ts` compares actual SQL
snapshots after every response: environments, environment receipts, create
idempotency results and environment-created audit entries all remain unchanged.
The actual broker launch ledger is empty. The raw receipt records
`publicationUnchanged: true`, `launches: 0`, two passing tests, 32 expectations,
zero fail and `P63_FINAL_TEST_EXIT=0`. The existing broker-denial test is unchanged.

## Exact checks reused and cleanup

No test rerun was needed: the final commands and current bytes are consistent.
No broad suite or installed signing/build chain was repeated.

| Raw receipt | Exact command/result |
| --- | --- |
| `docs/evidence/p63-editor-events/session-focused.log` | `bun test tests/ui-editor/events tests/ui-editor/pdf/events.test.ts`; 17 pass, zero fail, focused exit 0 |
| `docs/evidence/p63-editor-events/session-static-final.log` | `bun node_modules/typescript/bin/tsc -p tests/ui-editor/events/tsconfig.json --noEmit`; final types exit 0 |
| Same event static receipt | `bun x oxlint --type-aware --deny-warnings apps/web/src/features/editor/shared/events.ts apps/web/src/features/editor/assistant/events.ts apps/web/src/features/editor/pdf/events.ts apps/web/src/features/editor/review/events.ts apps/web/src/features/editor/transport/connection.ts tests/ui-editor/events`; final lint exit 0 |
| `docs/evidence/p63-admission-errors/final-focused-tests.log` | `./node_modules/.bin/bun test tests/operations/environments/admission-errors.test.ts tests/operations/installation/environment-admission-denials.test.ts`; two pass, final test exit 0 |
| `docs/evidence/p63-admission-errors/final-scoped-static.log` | `./node_modules/.bin/bun node_modules/typescript/bin/tsc --noEmit -p docs/evidence/p63-admission-errors/tsconfig.json`; types exit 0 |
| Same admission static receipt | `./node_modules/.bin/bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings --tsconfig docs/evidence/p63-admission-errors/tsconfig.json services/operations/environments/create.ts tests/operations/environments/admission-errors.test.ts tests/operations/environments/admission-role.ts tests/operations/installation/environment-admission-denials.test.ts`; lint/final static exits 0 |

Independent read-only inspection at 22:56:56Z confirms all five admission attempt
roots and the final native/private-AI/authorization roots absent; all 20 exact
admission-owned units are not-found/inactive, MainPID 0, empty ControlGroup; the
six exact inspected admission/native/private-AI ports have no listeners.
The producer's `session-native-cleanup.json`, `session-fixture-cleanup.log` and
`settled-files.log` agree for event fixtures. Admission `P9_CLEANED` receipts
record empty owned container/image inventories and `owned-inspection.log`
records `P63_CLEANUP_EXIT=0`. No additional cleanup operation was performed.

## Residual scope

The inherited signed build/adopt/revoke/PDF success remains the bounded P37
result, not a newly replayed P63 success claim.
Read `docs/handoffs/p37-admission-recovery.md` and its raw
`docs/evidence/p37-admission-recovery/installed-parent.xml` and passing log exit:
one test, 80 assertions, zero failures, `P37_INSTALLED_TEST_EXIT=0`.
The handoff hash remains
`51aa3437cb26d7c8959e2c55c5199c0e01911610c56135bf4fb5153edf0b9bf4`.
This audit does not recertify that historical run against the entire current
tree, arbitrary deployments, mobile layouts or the parent's P61 integration.

The admission producer's test-file LSP request timed out; its completed strict
TypeScript and deny-warning lint are the accepted static evidence. Historical
failed fixture/lint/native attempts remain historical. No acceptance item is
deferred within these two bounded claims.

Only this report and `docs/evidence/p63-verification/inspection.md` were written
by the verifier. No source/test changes, commit, service mutation or port 5173
operation occurred.
