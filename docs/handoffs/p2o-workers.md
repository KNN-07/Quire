# Worker lifecycle operations handoff

October 27, 2026. Owned worker lifecycle scope is implemented and verified.
The final single full worker suite passes 20 tests and 94 assertions, followed
by strict owned TypeScript and type-aware deny-warning lint, all exit 0.
Real native and Docker workers produced genuine authenticated HTTP PDF
downloads. Final exact-resource cleanup was independently checked.

## Scope and integration

Owned implementation:

- `services/operations/workers/{migrations,state,admission,auth,operations,routes,profiles,process,controller,index}.ts`
- `scripts/ops/workers.ts`
- `tests/operations/workers/`
- `docs/runbooks/workers.md`
- `docs/evidence/p2o-workers/`

The parent owns root module composition and compiler lifecycle changes.
Those hooks are landed and parent-confirmed stable, not outstanding requests.
This lane did not edit accepted compiler, runtime, environment or root files.
`p2o-workers-hooks.md` retains historical routing and intermediate failures;
this document is the final worker handoff.

`services/operations/workers/index.ts` exports:

```ts
migrations
register
WorkerController
poolId
managedWorkerPool(db)
admitWorkerClaim(tx, workerId)
assertManagedLease(tx, workerId)
workerWallSeconds(db, configured)
type ControllerConfig
```

Register the worker module in lane O, order 80. Migrations `080-o-workers` and
additive `081-o-worker-profiles` have explicit SQLite STRICT and PostgreSQL
variants. The latter adds per-process backend and selected environment IDs
without changing the original migration SQL.

The compiler calls claim admission under its compiler transaction lock after
worker upsert and before queue selection. Lease fencing validates current
controller ownership, and lease wall limits use the policy cap. Managed mode
also disables the API-local compiler start/pump/run path and routes PDF
differences through actual remote jobs. Compiler-only stores without the
additive worker schema preserve legacy behavior.

## Durable behavior

The policy stores minimum, maximum, requested capacity, sandbox, wall timeout,
version and managed mode. Policy writes use compare-and-swap and immediately
opt into managed admission, including zero capacity before controller startup.
Bounds are `0 <= min <= max <= 32`; timeout is positive and at most 600 seconds.

One SQL controller authority renews every two seconds and expires after ten.
Concurrent ownership is rejected. Expired/predecessor workers are fenced from
new claims and lease renewal/completion; a successor never adopts or signals
another owner's PIDs or pretends to have observed their exits.

The current authority launches actual UUID-qualified systemd user services.
Desired compatible capacity is bounded by maximum and driven by minimum,
requested capacity and queued/running jobs. Draining owned processes continue
to consume launch slots until exact exit. Each role has 2 GiB memory, no swap,
64 tasks, one CPU quota, no new privileges, control-group termination and a
24-hour maximum lifetime. The accepted per-job confinement remains in force.

Normal drain atomically stops future claims, preserves the active lease, and
keeps its operation pending until actual process exit. Minimum capacity can
then launch a different worker. Zero drains instead of silently falling back
to a local compiler or legacy worker. Live deletion fails; deletion is only
allowed after observed exit and lease removal. Unexpected process death fences
outstanding work as `WORKER_PROCESS_EXITED` and replaces capacity for subsequent
jobs without inventing a successful result.

Whole serialized reconciliation and exit cleanup enter
`context.admission.background`. Stopping inside an admitted tick waits only
for OS exit, not the separate fresh cleanup callback that may wait behind
maintenance. Shutdown awaits those callbacks before closing adapters.
The deterministic real SQL/outbox regression covers maintenance waiting for
the whole tick, not merely its individual transactions.

## Operator routes

The module registers `workersList`, `workerPolicyGet`, `workersCreate`,
`workerPolicy`, `workerDrain` and `workerDelete`. The shared O tasks module
provides the operation reader; no duplicate operation route was added.

| Route | Behavior |
| --- | --- |
| `GET /api/admin/workers` | Actual heartbeat/lease/process state; lifecycle versions in `x-worker-versions` |
| `GET /api/admin/workers/policy` | Durable policy and real configured pool |
| `PATCH /api/admin/workers/policy` | Versioned bounds, timeout and backend; incompatible roles drain |
| `POST /api/admin/workers` | Idempotent durable capacity request; success requires actual probed worker registration |
| `POST /api/admin/workers/:id/drain` | Versioned, idempotent stop-claims request; terminal operation follows exact exit |
| `DELETE /api/admin/workers/:id` | Versioned retirement of an exited, unleased role |

Every route requires a current active operator. Mutations enforce same-origin
CSRF and authentication within fifteen minutes. Account/session/operator
authorization is rechecked under account/compiler locks before any receipt
replay, so demotion or revocation cannot reuse an old successful receipt.
Receipts, audit entries and operations are durable transactional data.
Identical concurrent capacity requests share one result; conflicting payloads
fail. Lowering maximum terminates superseded capacity operations rather than
leaving them queued indefinitely.

## Native and Docker configuration

Run the API with complete migrations first, then start the dedicated role:

```sh
QUIRE_DATA_DIR=/absolute/owned/quire-data \
QUIRE_COORDINATOR_URL=http://127.0.0.1:3001 \
bun scripts/ops/workers.ts
```

Scale configuration uses the existing PostgreSQL/Redis/S3/repository adapters
and the same instance secret as the APIs. This role does not start a local
compile engine. The compiler bearer is derived in memory and is not printed
or placed in command-line arguments. The runbook documents prerequisites,
drain-before-shutdown and resource ownership.

Native policy retains the accepted independently probed bwrap environment.
Docker policy selects available nonretired manifests through the environment
lane's final verified resolver; an available-looking row without its executed
probe receipt is rejected. This controller does not build or pull images.

`QUIRE_WORKER_ENVIRONMENT_IDS` optionally restricts selection. Otherwise the
current backend's available verified environments are selected. Docker roles
receive actual `Environment[]` JSON in a 0600 file below a private 0700
directory:

```text
<dataDir>/work/worker-pools/<owner>/<worker-id>/environments.json
```

The launcher forwards `QUIRE_WORKER_ENVIRONMENTS_FILE`. The accepted worker
independently executes the final `probeImage`/profile probes, checks manifest
execution identity and uses the environment lane's actual `runProfile`.
Backend/selected-ID changes drain incompatible roles before replacement.
Exact exit removes its manifest directory; controller close removes its pool
workspace. Zero capacity needs no available toolchain.

The verified live Docker image is:

```text
sha256:1ffb2fe8f831d4296f2de1c993a491444a9f6706e5498151ff41783468448258
```

## Terminal verification

Native Bun 1.3.14. Final sequential gate `bash_4`, exit 0:

```sh
bun test tests/operations/workers &&
./node_modules/.bin/tsc --noEmit -p tests/operations/workers/tsconfig.json &&
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  services/operations/workers scripts/ops/workers.ts tests/operations/workers
```

```text
20 pass, 0 fail, 94 expectations
Ran 20 tests across 8 files. [498.86s]
```

The earlier focused Docker gate also passed independently: one test,
13 assertions, 82.36 seconds, exit 0. The deterministic admission regression
and strict/lint gate passed before that live run. No sleeps, retries, skipped
tests, type suppressions or lint suppressions were added to obtain green.

The full suite exercises actual native SQL with two API runtimes, real
systemd workers, actual native confinement and actual Docker execution. It
covers maximum/idle zero, drain while source is held, deletion refusal,
SIGKILL/replacement, takeover fencing through the other API, legacy denial,
wall cap, durable policy/receipts, authorization races and negative inputs.
The expected old-worker HTTP failure during takeover and expected SIGKILL
are explicit test scenarios, not unreported failures.

All 21 owned source/test/config inputs match before and after the run:

```text
68d570de542d272cbecee371695f54f959466192fd81b27567188fd2d9b6ecb4
```

This is owned lifecycle acceptance, not a claim that unrelated repository-wide
UI/AI/deployment work or a separate PostgreSQL worker-process suite ran here.
The PostgreSQL migration variants and inherited scale role adapter wiring are
present; final live lifecycle evidence here uses native SQLite and local
Docker.

## Artifacts and cleanup

`docs/evidence/p2o-workers/final-results.md` records commands, results,
coverage, hashes and exact cleanup receipts. Retained genuine PDF downloads:

| Artifact | SHA-256 |
| --- | --- |
| `final.pdf` | `702ff89f5d4c61d481ae3cf8af13b0b1b10883b32b39eb2ad199bbaa261ed3d4` |
| `docker-final.pdf` | `ef81eba93a96880702064dbcb6c584e5ea7ba874eae5e50bd3e1939cabdd8e37` |

Both passed authenticated download/digest checks and independent `pdfinfo`
and `pdftotext`: 90,004 bytes, one letter-sized page, PDF 1.7, actual seeded
title/authors/method. `docker-manifest.json` retains the actual selected image
and toolchain identity.

The seven final `roles-*.json` receipts listed in `final-results.md` contain
all 11 actual units, seven temporary roots, 14 loopback listeners and observed
exits. Independent post-suite checks found every exact unit not found/inactive,
MainPID 0, every recorded root absent and every listener refusing connections.
The shared immutable producer image remains present. No unrelated resources
were removed, and no git commit or deployment was made.

Review boundary: the controller is 203 nonblank/non-comment lines, in the
200-250 warning band. Extract durable planning before adding more controller
logic. All other owned TypeScript files are below 200 lines; none exceeds 250.
