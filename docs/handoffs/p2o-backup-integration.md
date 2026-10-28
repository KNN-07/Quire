# Backup admission integration

Owner: `st_01a17c42`. Date: October 27, 2026.

Implementation and focused native, distributed, browser, strict type, and
type-aware lint verification are complete. `composition.ts` and `scale.ts` are
RELEASED to the parent and downstream integrators; this lane will not edit them
without coordination. Whole-product acceptance remains parent-owned: separate
account/assistant UI suites reported native Bun 1.3.14 descriptor failures on
the current code. These failures have not been suppressed or attributed to an
unproved cause. This handoff does not claim those broader suites are green.

## Public contract and operation lifetime

`@quire/contracts` exports `MutationAdmission` with three generic methods:

```ts
writer<T>(work: () => Promise<T>): Promise<T>;
background<T>(work: () => Promise<T>): Promise<T>;
exclusive<T>(work: () => Promise<T>): Promise<T>;
```

`Runtime.admission` and `ModuleContext.admission` expose that contract.
`writer` admits a complete source operation, including its failure cleanup.
Nested calls join the live operation; an expired continuation is rejected.
Tracked nested operations drain before their owner releases admission.
`background` deliberately starts independent work outside the triggering
request's scope and waits for maintenance to reopen. It is for scheduled work,
not a way to evade a stale operation ticket. `exclusive` closes new admission,
drains existing operations, executes backup, and releases on success or failure.

`LocalMutationAdmission` adds local lifetime tracking and shutdown drain.
Runtime refuses the O041 module with custom adapters lacking admission:
`BACKUP_QUIESCENCE_REQUIRED`. Legacy runtimes without O041 can still use their
existing adapters, but their fallback cannot claim exclusive backup authority.

HTTP handlers are whole admitted operations except backup creation, which owns
exclusive admission, and the long-lived SSE response. SSE SQL is storage-admitted.
Event listeners execute in the EventPort construction context rather than an
expired request context. SQLite preserves FIFO at call time before asynchronous
lock acquisition; transaction semantics and original migration bytes are intact.

## Native authority

`packages/runtime/src/native-admission.ts` exports `NativeMutationAdmission`
and `nativeAdmissionDescriptor`.

All native roles using one data directory share two kernel `flock` files:
`.admission-gate.lock` closes new admission and `.admission-writers.lock` drains
active writers. Authority is an open file description, not an in-memory flag or
timed lease. Git children inherit the writer descriptor as fd 3 through actual
child exit, even if the parent closes its copy.

The flock helper uses native `Bun.spawn` without pipes. Both native and singleton
repository Git helpers also use native `Bun.spawn`, preserve binary stdin, consume
stdout/stderr, and await actual child exit in cleanup. No Node subprocess shim,
EBADF suppression, retry, or ignored file-close error was added.

## Distributed authority

`services/operations/storage/postgres/admission.ts` exports
`PostgresMutationAdmission`, `admissionTicketSchema`, and `AdmissionTicket`.
`createPostgresStorage` returns `admission` alongside the storage ports.

One reserved PostgreSQL session owns each operation's advisory lock and SQL.
The two shared/exclusive lock keys close admission before draining writers.
Tickets include the backend PID and a unique application-name nonce and are
checked against actual PostgreSQL session/lock state. An expired or disconnected
session cannot resume SQL or report a successful exclusive callback.

Repository RPCs transmit `x-quire-admission`. The singleton repository validates
the originating session and borrows its authority without reacquiring the global
lock. Backup additionally closes and drains repository admission through actual
Git-child exit; losing an API connection alone cannot make a surviving Git child
safe to ignore. Authenticated `/v1/backup-begin` and `/v1/backup-end` require a live
exclusive ticket. Expired owners are released only after their privileged RPCs
finish. No Redis lock or timed writer-lease takeover is the backup authority.

PostgreSQL shutdown first drains operations and queued SQL. It observes the
actual reserved-session release Promise despite the baseline runtime's `void`
declaration. The one-second pool close option bounds socket teardown only after
work has drained; native Bun 1.3.14 ignores a zero timeout.

## Composition and durable archives

`apps/server/src/composition.ts` registers O041 backups, O042 operations, O060
environments, and O080 workers exactly once. O080 includes its O081 migration.
The existing core download route remains the download authority.

The backup host uses the producer's atomic `loadBackupSigner`. Production and
scale require an independently provisioned Ed25519 private key through
`QUIRE_BACKUP_SIGNING_KEY_FILE` or the injected host option.

Scale also requires an absolute `QUIRE_BACKUP_ROOT` or `backups.backupRoot`;
missing or relative roots fail with `BACKUP_ROOT_REQUIRED`. Every API must mount
the SAME durable shared filesystem at that root. Equal strings pointing to
private API filesystems do not satisfy this requirement. Native defaults to
`dataDir/backups`. The effective absolute root is exposed by policy and included
in archived configuration. Signing variables are excluded; the effective S3
region default is materialized.

Default `openFresh` creates an isolated local SQLite/blob/Git target, even when
the source is scale, with module migrations but without startup registrations.
It never reuses the live PostgreSQL, S3, or repository ports.

Exclusive backup invokes the actual compiler `quiesceCompiler` hook while global
admission is closed. Shutdown and failed-startup cleanup await the actual
`stopEnvironmentBuilds` before compiler, review, and storage close. Dedicated
worker controllers remain dedicated-role owned, not unmanaged API substitutes.

Parent/producer hooks have landed: compiler whole-job/background work and remote
job fencing; realtime refresh and history capture background work; SSH whole
session lifetime; adapter operation lifetime; supervised environment execution;
worker reconciliation and exit cleanup. These paths are owned by their lanes.
Composition delegates WebSocket messages directly to the core handler, whose
writer admission is inside its error-protocol boundary. An outer admission
wrapper would let maintenance rejection escape before that boundary.

## Verification receipts

All following runs used actual standalone native Bun 1.3.14. Counts describe
each recorded run, not a deduplicated aggregate:

- `bash_43`: 20 tests, 50 assertions. SQLite FIFO/rollback/drain, original
  migration hashes, event ordering, private objects, background and shutdown.
- `bash_45`: actual composed compiler backup, 1 test and 9 assertions. Held
  artifact upload drains; queued/running jobs are fenced; stale callbacks fail.
- `bash_60`: distributed admission plus existing PostgreSQL contracts, 12 tests
  and 51 assertions.
- `bash_69`: native Git descriptor inheritance, binary input, hidden ancestry,
  and SQL boundary behavior, 9 tests and 26 assertions on current Git helpers.
- `bash_70`: scoped strict TypeScript and type-aware deny-warning lint exit 0
  on the current native Git implementation.
- `bash_71`: two real API processes, PostgreSQL/Redis/MinIO, singleton Git
  repository, shared archive root, and existing repository contracts: 10 tests,
  46 assertions on current distributed Git helpers.
- `bash_72`: actual assembled application and Chromium at desktop 1440 and
  mobile 390 widths, binary upload and visible WebSocket symbol edit, 2 tests,
  10 assertions. Both screenshots were visually inspected; no recovery overlay,
  page errors, or unsaved document state.
- `bash_74`: four deterministic descriptor waves, each with 32 real completed
  Git commands, 32 held writer descriptors, forced GC, fstat, and actual kernel
  exclusive probes: 1 test, 5 assertions.
- `mon_BWWTE53B10NFWZS6`: final actual application shutdown and network
  WebSocket maintenance tests, 2 tests and 5 assertions, followed by exposed
  descriptor probes on both runtimes, scoped strict TypeScript and type-aware
  deny-warning lint. Entire command exited 0 with
  `ADMISSION_PROTOCOL_TYPES_LINT_PASSED`. The socket received
  `BACKUP_MAINTENANCE` through the real protocol and remained open.

Distributed tests include a stopped API whose PostgreSQL backend is terminated
while an actual Git update-ref child is held; repository drain waits for that
child and the resumed stale API cannot mutate. A pending journal correctly
rejects backup until explicit fenced recovery. Other cases cover callback
failure, exclusive-session loss, and successful fresh admission afterward.

The cross-API HTTP test creates a signed archive on API A, stops A and removes
A's private data directory, then verifies and lists the archive on API B from
the shared root. Both O042 operation statuses are checked as succeeded.

Test failures encountered during construction were corrected rather than
weakened: fixture contracts, native binary buffer representation, integration
deadlines, session-release handling, and expected pending-journal rejection.
Tests use events/barriers, not fixed sleeps to manufacture ordering.

## Open runtime diagnostic

Separate actual account/assistant UI suites still reported EBADF at native
admission `gate.close()` and Git `child.exited` on current Bun 1.3.14 code.
The focused application/browser run above passed, so it does not establish
that these broader failures are resolved. The parent is coordinating affected
suite evidence and the project runtime decision.

`stdio-ownership-probe.ts` and `borrowed-descriptor-probe.ts` are isolated
diagnostics, not production fallbacks. The exposed-fd reuse/GC diagnostic passed
on both 1.3.14 and 1.4.4; this is negative evidence, not a reproduced root cause.
All six borrowed-descriptor controls also passed: plain FileHandle, flock
borrowing stdin, and Git borrowing fd 3, each on 1.3.14 and 1.4.4. Each recycled
the exact owned descriptor, forced GC, checked fstat, and closed it successfully.
The initial final lint found two unawaited diagnostic stdin-end promises; both
were corrected to await the actual result. Production logic was unaffected.

Official standalone Bun 1.4.4 is available only for controlled comparison at
`/tmp/quire-bun-comparison-eNdWJg/bun-linux-x64/bun`. Its release archive SHA256,
verified against the GitHub asset digest, is
`bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c`.
Binary SHA256 is
`10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235`.
No global binary, PATH, dependency pin, or deployment runtime was changed.
The parent owns any project-scoped runtime upgrade decision.

## Resources and downstream ownership

All owned PostgreSQL/Redis base fixtures, per-test databases, MinIO containers
and volumes, API/repository/Git children, listeners, and normal temporary roots
were removed. Final base-fixture removal was `bash_73`, exit 0. The interrupted
descriptor diagnostic's exact temporary root was removed separately.
The verified comparison-runtime directory is intentionally retained for the
parent's affected-suite comparison and needs cleanup after that work.

No admission implementation, focused verification, or handoff item is deferred.
The parent directed the assistant owner to compare its exact affected suite on
the isolated runtime, and the account owner to compare only if its fixed-close
baseline still fails. The comparison binary must remain until both finish.
Those results, any project-scoped runtime pin change, whole-product acceptance,
and final binary cleanup belong to the parent. Passing raw probes are not
grounds to approve an upgrade. No commit or push was made.
