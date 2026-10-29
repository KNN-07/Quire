# P68 persisted AI run steps: backend

FINAL, October 28, 2026. The backend persists actual AI execution steps and
returns them in create/get/replayed receipts. The final focused run passes
63 tests across 12 files with 242 assertions. Scoped TypeScript and type-aware
deny-warning lint both exit 0 using repository Bun 1.4.4. The broader AI run
has two existing citation-consent read failures described below; it is not
reported as green.

## Exact frontend contract

`packages/contracts/src/work.ts` exports `AiRunStepSchema` and `AiRunStep`.
`AiRun.steps` is a readonly array, at most five entries, defaulting to `[]`
for old DTOs. The appended database migration defaults existing runs to `[]`;
no history is backfilled or inferred from their terminal status.

```ts
type AiRunStep = {
  readonly kind: "context" | "retrieval" | "provider" | "validation" | "publication";
  readonly status: "running" | "succeeded" | "failed" | "canceled";
  readonly startedAt: Instant;
  readonly finishedAt: Instant | null;
};
```

`Instant` is the existing contract's UTC timestamp string. The recorder uses
the runtime clock at the actual boundary; it does not derive times from run
creation, stage position, an artificial duration or a progress percentage.
Running recorded steps have `finishedAt: null`. Completed/failed/canceled
recorded steps receive the observed finish timestamp. Equal start and finish
timestamps are possible.

Entries appear in execution order, only once their stage is reached:

| Kind | Actual work represented |
| --- | --- |
| `context` | Explicit source/image/diagnostic context collection. Start and finish are captured around `collectContext` before reservation, then the completed entry is inserted with the new receipt. Failed pre-admission requests have no run receipt. |
| `retrieval` | Actual configured citation-provider retrieval for `citation-reviewer`, including the per-provider consent/authority fence. It is absent for ordinary requests and for failures before retrieval starts. One entry covers all explicitly selected retrieval providers. |
| `provider` | The existing inference call, including HTTP transport and the provider adapter's envelope/JSON/schema validation. It begins in the same transaction as dispatched usage and run `running`. A malformed provider JSON result therefore fails this step. |
| `validation` | Server read-only checks, proposed-edit validation, claim-range validation and citation provenance validation after the adapter returns a parsed answer. |
| `publication` | Publishing the validated answer/proposals/findings/provenance and successful receipt. Its success is committed atomically with the result. This does **not** accept or apply proposed source edits. Existing reviewed decisions remain separate. |

A typical ordinary completed run has four entries, not five. A failed
provider request has completed context plus failed provider, with no
invented validation/publication entries. A queued failure before any
outbound work can have only completed context.

`POST /api/projects/:p/ai/runs` returns the new queued receipt with completed
context. `GET /api/ai/runs/:id` returns the authorized current receipt.
Every persisted progress transition advances the same run `version` and
records an existing `operation.changed` event in its transaction. GET's
existing ETag uses `resourceVersionTag(version)`; the gated test observes
versions `0 -> 1 -> 4` and ETag `"v4"` for a normal request. These numbers
are evidence, not client constants.

An operation event still contains only the existing
`{ resourceId: runId, status: runStatus }` payload. During progress several
distinct events legitimately have `status: "running"` (or `"queued"` while
retrieving). A mounted client must refresh the run on each authorized
operation notification, not deduplicate notifications solely by run status.
Use the existing event sequence and current GET version. Do not create
pending stage placeholders or compute a completion percentage from array
length. Short validation/publication stages may already be completed by the
time the client refreshes; their persisted history remains readable.

## Persistence, cancellation and privacy

The appended `069-x-ai-run-steps` SQLite/PostgreSQL migration pair adds
`ai_run_metadata.steps_json TEXT NOT NULL DEFAULT '[]'`. Earlier migration
text is preserved byte for byte: reconstructing the file without only this
new object yields the captured pre-edit SHA-256
`a57bd38bbb6f605521e31488e3afb91c59d003cd4c4aa736eb1fa040e286f8a2`.
SQLite is exercised by the native runtime fixtures. The PostgreSQL DDL pair
is present; no PostgreSQL server was run for this task.

Progress transactions read the latest metadata under the existing account
lock. Terminal failure, explicit cancellation, private-session clearing,
shared-conversation clearing/expiry, shutdown abort and expired-lease startup
recovery finalize any actually running recorded step. Clearing/expiry also
atomically cancels affected active receipts, refunds only reserved usage,
and records the existing operation notification. A late provider answer
cannot publish into a terminal run. Dispatched usage remains charged.
Recovery does not retry an uncertain paid request.

New step metadata contains only four bounded typed fields: stage kind,
status and timestamps. It contains no prompt, selection, source path/text,
provider response, reasoning or tool-action content. Existing session and
project/conversation authorization is unchanged: private Ask metadata is
not readable by another session of the same account; explicitly shared
conversations and Agent runs retain their existing visibility rules.
Private Ask step history survives restart even though its conversational
content remains session-local. Replay returns the stored history and does
not execute again or append duplicate steps. Authorization, policy/config
rechecks, source review, journal and compile-before-commit logic are retained.

## Verification and evidence

All literal commands, UTC boundaries and raw exits are retained under
`docs/evidence/p68-ai-steps-backend/`:

- `baseline.txt` and `final-hashes.txt`: pre/post owned source fingerprints,
  reconstructed pre-edit HTTP assertion fingerprint, migration preservation
  and clean whitespace check.
- `focused.log`: final single clean focused command, 63 pass / 0 fail,
  exit 0, October 28 23:16:29Z through 23:17:24Z.
- `static.log`: scoped AI TypeScript project and type-aware lint on every
  owned source/test file, both exit 0, 23:16:29Z through 23:16:45Z.
- `ai-regressions.log`: complete broader command, 95 pass / 2 fail, exit 1,
  23:12:29Z through 23:15:02Z. This also exercises the unchanged reviewed
  source/undo/compile-before-commit behavior.
- `initial-failures.txt` and `static-retry.log`: retained failed attempts and
  their corrections, without test skips or rule suppression.

The 11 new tests gate the owned HTTP provider **before** create/dispatch,
wait for its actual request-entry signal with a bounded abort signal, GET a
persisted provider-running receipt while its response is held, then release
the response and read the completed history. They also cover actual Crossref
retrieval, malformed results, unverified provenance, HTTP failure,
cancellation/session clear/shared clear/expiry/interruption/shutdown,
unchanged source, replay without a second dispatch, restart persistence,
different-session denial and authorized live SSE notifications. The tests
advance only the injected clock for timestamp/lease/expiry behavior; there
are no sleeps or polling waits.

The two broader failures are:

1. `tests/adapters/ai/persistence.test.ts`: “refunds retrieval setup failure
   before the model is dispatched”.
2. `tests/adapters/ai/operator-policy/policy.test.ts`: “operator citation
   denial prevents retrieval and charging; allowance still requires user
   search and terms consent”.

Both reach `fixture.run -> AiService.get -> AiStore.recheck`, where an
already-failed citation run is denied with `AI_RETRIEVAL_CONSENT` because its
retrieval consent is absent. That read-time reauthorization path was present
in the source inspected before these edits and is not changed by this work.
No before-change execution was performed, so the evidence establishes the
unchanged source path and current failures rather than claiming a separately
executed baseline. Their tests and consent enforcement were left intact.

Cleanup is exact and fixture-owned: async disposal stops each owned random
port provider/API server, closes AI/reference/shared/runtime services and
removes each `mkdtemp` data root using the existing harness's
`rm(path, { recursive: true, force: true })`. The new test `afterAll` checks
all 11 owned roots no longer exist; `P68_CLEANUP` in `focused.log` records
their exact paths. No manual broad cleanup command was run. Port 5173 was
not contacted and no git commit was created.
