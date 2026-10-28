# P7 prepared runtime/application lifecycle: FINAL

October 27, 2026. Owner: `st_01a17e5b`.

**PASS for the process-local prepared lifecycle and tested default
compatibility. Configured installation/supervisor acceptance is not claimed.**
The final finished-input run passed **13 tests, 81 expectations, zero failures**
on project-local **Bun 1.4.4 (38afee6c8)**. Owned strict TypeScript and type-aware
deny-warning lint exited 0. Exact source fingerprints, command history, initial
diagnostics and final process/container/root cleanup are retained under
`docs/evidence/p7-prepared-runtime/`.

## Exact exports

The existing runtime barrel re-exports these through `context.ts`:

```ts
type PreparedState = "prepared" | "activating" | "active" | "disposing"
  | "disposed" | "failed";
type RuntimeReadiness = {
  readonly database: "sqlite" | "postgres";
  readonly migrations: readonly { readonly id: string; readonly digest: string }[];
};
type PreparedAdapterBinding = {
  readonly db: SqlExecutor;
  readonly activate: () => Promise<RuntimeAdapters>;
  readonly dispose: () => Promise<void>;
};
type PreparedRuntime = {
  readonly state: PreparedState;
  readonly check: () => Promise<RuntimeReadiness>;
  readonly activate: () => Promise<Runtime>;
  readonly dispose: () => Promise<void>;
};

createRuntime(config: RuntimeConfig, options?: RuntimeOptions): Promise<Runtime>;
createRuntime(config: RuntimeConfig,
  options: RuntimeOptions & { readonly startup: "prepared" }): Promise<PreparedRuntime>;
prepareRuntime(config: RuntimeConfig, options?: RuntimeOptions): Promise<PreparedRuntime>;

class PreparedLifecycle<T> {
  constructor(start: () => Promise<T>, release: () => Promise<void>);
  readonly state: PreparedState;
  activate(): Promise<T>;
  dispose(): Promise<void>;
}
```

`RuntimeOptions.prepareAdapters(config, clock)` is an additive optional factory
returning `Promise<PreparedAdapterBinding>`. `ServiceModule.dispose(context)`
is an additive optional, awaited disposal hook. Every entered module, including
one whose registration failed, receives disposal in reverse registration order
before the adapter binding closes.

`apps/server/src/composition.ts` exports `ApplicationOptions`, adding
`startup?: "prepared"` and `prepareAdapters`. `createApplication` retains its
existing runtime/adapters/websocket/fetch/handle/start/close shape and adds
`state`, `check()`, `activate()` and `dispose()`. In prepared mode `start()` and
`activate()` are aliases; `close()` and `dispose()` are aliases.

## Construction and the all-module barrier

Prepared native construction reads the already-existing secret and directory
layout, opens the existing SQLite database **read-only**, and compares the
complete selected migration inventory and original dialect digests. It never
calls `prepareData`, secret provisioning, migrations or module registration.
Missing/changed/unexpected migrations fail; there is no repair path.
The SQLite device/inode is retained and checked at activation. A replaced
database fails `RUNTIME_BINDING_CHANGED`.

The concrete barrier is the **entire ordered registration pass**. This was
chosen instead of only postponing the final dispatch or splitting two obvious
producers. Actual registration also runs:

* Core base source recovery and Git journal recovery.
* Review restore/decision recovery and missing-history capture.
* Compiler environment probing/upsert and reaper construction.
* Local-mail provider seeding and shared provider assembly.
* Remote Git/reference/Dropbox recovery and AI recovery/expiration.

Deferring that pass makes every registration-time dispatch, local write,
subprocess and outbound recovery unavailable during preparation, without
rewriting frozen account/core modules. No writable Runtime, ModuleContext,
registry, adapter aggregate, repository or SQL handle is returned by a prepared
runtime. Prepared application getters throw `APPLICATION_NOT_ACTIVE`.
HTTP/fetch/handle, SSE, Git and internal worker routes return 503 before routing;
WebSocket upgrades are blocked before upgrade and direct handler calls reject.
There is no public readiness header or public health bypass.

Activation opens writable adapters for the same binding, rechecks migration
digests **without migrating**, registers modules once, dispatches durable events,
configures the existing backup/health hooks, and starts the explicitly owned
compiler/support/aggregate schedulers. Each application factory remains fresh.
The independent backup signer, shared scale root requirement, actual admission
exclusive/quiescence hook, adapter inquiry outbox, digest scheduling and required
WebSocket `message` handler remain in place.

Default uncontrolled `createRuntime` still provisions/migrates/registers/
dispatches eagerly. Default `createApplication` still constructs eagerly and
starts its explicit worker/support/aggregate schedulers only when asked.
The compiler reaper's historical default registration timing is preserved;
prepared mode places that registration inside activation. Explicit module
replacement still suppresses automatic adapters unless explicitly requested;
`adapters: false` still disables them. Caller-assembled aggregates keep their
existing caller ownership.

## State, failure and cleanup

Concurrent runtime activations share one promise. Repeated successful
activation returns the same Runtime; failed activation retains the same failure
and never retries on that object. The activated Runtime's `close()` delegates
to its prepared lifecycle rather than leaving a falsely active closed object.

Disposal immediately changes state to `disposing`, so application ingress and
getters close before draining. It waits for an already-entered activation.
If disposal wins during activation, activation rejects `RUNTIME_DISPOSED`,
then the acquired resources drain once. Disposal before activation does not
register modules or start producers. Repeated disposal shares its promise.
Cleanup failure is retained as `failed`; the object still cannot reopen.
Start and cleanup failures are both retained in an AggregateError.

An application owner is registered before its feature modules. That owner
ensures registration and initial-dispatch failures drain support, aggregate
adapters, environment work, compiler and review/realtime before storage.
Custom module disposal precedes that owner in reverse registration order.
The existing aggregate drains its provider/digest/sender work.
Compiler reaper/pump detached promises now receive immediate rejection
observers; failures are retained and reported after all owned work drains.
The compiler does not stop cleanup at the first failed cancellation write.

The generic `PreparedLifecycle<T>` is available to other role owners, but is
process-local ownership machinery, not an installation launch permit.

## Real verification

The finished-input command was:

```sh
./node_modules/.bin/bun ./node_modules/typescript/bin/tsc --noEmit \
  -p tests/integration/prepared-runtime/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  packages/runtime/src/context.ts packages/runtime/src/lifecycle.ts \
  packages/runtime/src/prepared.ts apps/server/src/composition.ts \
  services/compiler/index.ts services/compiler/service.ts \
  tests/integration/prepared-runtime
./node_modules/.bin/bun test tests/integration/prepared-runtime
```

The final run was **13 pass / 0 fail / 81 expectations / 9.26 seconds**, exit 0.
An earlier run also passed all 13 tests; a parallel strict check found a
self-referential inference requiring an explicit lifecycle return type.
After that type-only correction, the complete command above ran once for the
finished source. Earlier strict/lint diagnostics and their fixes are retained,
not presented as clean runs. The final 12 owned source/test SHA-256 values were
identical before/after execution.

The tests use a real full seeded native application, SQL/Git/blob/key byte
fingerprints, durable outbox records and an independently launched Bun API
process. Before activation that process reports no writable runtime, reaper,
scheduler subscriptions, event delivery or surviving child. Its real HTTP
socket denies health, ordinary routes, SSE, Git, worker requests and WebSocket
upgrade. The external TLS SMTP fixture sees no commands. Activation makes real
health/login and durable event delivery work, creates the local-mail provider,
and starts exactly three aggregate subscriptions. A controlled tick sends real
TLS SMTP; disposal drains and persists delivery before process exit.

Further tests cover registration-time dispatch, dispose before activation,
concurrent activation/disposal, missing/changed migration rejection, native
database identity replacement, missing prepared-storage capability, default
eager/module-replacement/adapter-disable compatibility, partial scheduler
failure, and cleanup error retention. A registration failure owns an actual
shell child and compiler reaper: disposal waits for child exit and writes its
cleanup receipt through real SQL before storage closes. A real failed compiler
SQL operation is observed and reported without an unhandled rejection.

The scale case reuses the existing uniquely owned PostgreSQL/Redis/MinIO/
authenticated remote-repository fixture. Preparation opens actual PostgreSQL
storage through an explicit inert factory and compares all application rows
before/after. Activation invokes the real `createScaleAdapters`, connects its
Redis event transport, serves health and reads the actual S3 blob and remote
repository identity. It is not SQLite presented as PostgreSQL and not a
configured installation rollback proof.

Native storage tests select the Docker compiler configuration to avoid running
an unrelated toolchain-confinement acceptance suite. They prove compiler
registration/reaper/worker lifecycle barriers, not successful TeX execution.
IPC and explicit readiness/exit/event promises establish ordering; no sleeps,
polling delays or timing-luck assertions were added.

## Host seams and acceptance limits

`check()` is deliberately a database/migration-ledger readiness query. Because
registration/recovery is deferred, it does **not** prove that registration will
succeed. It also does not attest executable identity, static assets, full
repository/blob health, role inventory, generation or installation permission.
The host must not turn this result alone into a configured installation
`PreparedInstallation` acceptance receipt.

Custom/scale prepared construction must supply the required inert
`prepareAdapters` contract. A normal `createAdapters` callback is never assumed
inert; the existing scale factory connects Redis and installs reconciliation
timers. Missing capability rejects `PREPARED_ADAPTERS_REQUIRED`. This lane did
not edit unowned `apps/server/src/scale.ts`; the test demonstrates its concrete
activation behind an inert PostgreSQL reader. The parent/host must supply the
production prepared scale factory, invocation-bound private readiness/activation
channel and all-role launch/transport wrappers. These are explicit integration
requirements, not fake callback capabilities or configured acceptance.

Only `systemd-local-v1` remains the architectural supported-driver target.
No systemd supervisor/unit work, controller commit, SSH/repository/worker
entrypoint changes or activation-permit checks were implemented here.
Compose/Helm have no inferred acceptance; the host's missing orchestration/
restore capabilities remain required explicit failures. No installation files,
original migration bytes, existing producer evidence or frozen benefits source
were changed.

## Cleanup and changed paths

Final API child PID `1209835` exited 0 with empty output. All native test roots
were removed and their absence asserted. The reused scale fixture removed only
its exact PostgreSQL/Redis/MinIO resources, verified container/volume/listener
absence, closed repository/SQL handles and removed its root. Attached container
CLI exit 137 is intentional removal, not helper/crash evidence. Exact names for
both runs are retained in the evidence files.

Changed production paths are only:

* `packages/runtime/src/{context,lifecycle,prepared}.ts`
* `apps/server/src/composition.ts`
* `services/compiler/{index,service}.ts`

New tests and strict config are under `tests/integration/prepared-runtime/`.
No commits, global upgrades, production installation, user-data mutation,
unrelated cleanup, user-systemd repair or FastShort PID/port interaction
occurred. Concurrent editor/account/benefits UI work was left untouched.
