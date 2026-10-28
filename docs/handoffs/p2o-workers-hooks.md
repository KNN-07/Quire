# Worker integration history and current verification

Current status: the parent confirms all compiler claim/fence/timeout and
managed-mode/PDF-diff hooks have landed, with the focused parent gate
`bash_124` passing. Those hooks are no longer missing. The older requests below
are retained as history, not requests to duplicate the integration.

Shared compiler/admission/environment inputs are now parent-confirmed stable.
Whole reconcile/tick and actual exit cleanup use `context.admission.background`;
stopping a role awaits only OS exit inside the tick, not fresh admitted cleanup.
The real SQL/outbox maintenance regression passes, followed by strict owned
TypeScript and deny-warning type-aware lint (`bash_1`, exit 0).

The focused Docker gate passes (`bash_2`: 1 pass, 13 assertions, 82.36 seconds,
exit 0). It independently probes the final immutable image, compiles and
downloads a genuine PDF, drains an active lease to zero and observes exact exit.
Its role/root/listeners were independently checked absent/closed.
The single final complete suite plus strict/lint gate passed as `bash_4`:
20 tests, 94 assertions, 498.86 seconds, exit 0. All final exact resources
were independently verified closed/removed. The final handoff is now
`docs/handoffs/p2o-workers.md`.

Historical native results before those final corrections:
The terminal frozen native run was 14 pass / 3 fail / 65 expectations /
475.93 seconds. Its operation-reader test omitted the now-separate O tasks
module; that fixture assembly is corrected. Its takeover waiter could consume
the old job's failure event through the other API; waiters now select exact job
IDs while subscribing before enqueue. Its concurrent-create ArrayBuffer error
did not reproduce in a subsequent actual-process focused run, which passed
with exit 0. No complete native acceptance is claimed from those partial gates.

Docker policy is now implemented in owned controller/config scope rather than
permanently rejected. `profiles.ts` uses the verified environment resolver,
`081-o-worker-profiles` explicitly adds backend/ID metadata in both dialects,
backend/selection changes drain incompatible roles within maximum slots, and
owner-only per-role manifest files are forwarded through
`QUIRE_WORKER_ENVIRONMENTS_FILE`. Exact role exit removes its manifest directory.
The real Docker worker/source-barrier/drain/PDF test passes. Five mode/trust tests
also pass. The owned Docker fixture uses a genuine current operator
principal/session under the final environment Actor contract.

The controller is 203 pure lines, in the warning band. The next additive change
should extract the durable planning step rather than keep growing this file.

## Historical routing and hook requests

The workers child cannot deliver `thread_send` to the parent: each attempt
returns `invalid_arguments`, guard `unknown_cause`, with “The delivery this send
continues is not one the sender received.” This file records the concrete request.

The child does not edit compiler or root files. Parent-owned integration needed:

1. In `CompilerLeases.lease`, under `quire:compiler`, after worker upsert and before
   selecting candidates, call
   `admitWorkerClaim(tx: Transaction, workerId: Id): Promise<boolean>`
   from `services/operations/workers/admission.ts`; return null when false.
2. In `CompilerLeases.fence`, after validating the existing lease, call
   `assertManagedLease(tx: Transaction, workerId: Id): Promise<void>`.
   This fences heartbeats/artifact completion by workers whose controller lost
   authority, while allowing already claimed jobs during a normal drain.
3. Cap remote lease limits with
   `workerWallSeconds(tx: SqlExecutor, configured: number): Promise<number>`.
4. Register exported `migrations`/`register` from
   `services/operations/workers/index.ts`, lane O, order 80.
5. Start dedicated `scripts/ops/workers.ts` controller role and do not start
   API-local compiler work when using the managed pool. Controller CLI shares
   durable SQL/blob/repository adapter configuration with API roles.

Exports will tolerate absence of the additive worker migration for accepted
compiler-only fixtures. Once managed control is enabled, unmanaged roles cannot
claim jobs. No original migration bytes change.

This is an interim request, not the final worker handoff.

The negative test is now executable and has failed on the real accepted
compiler: `bun test tests/operations/workers/authority.test.ts` exited 1 with
one pass and one failure. With `o_worker_policy.managed=1,maximum=0`, an
authenticated unmanaged worker still received an actual lease instead of null.
The controller exclusion/takeover case passed. Owned strict TypeScript and
type-aware lint subsequently passed. A complete real-process suite is running;
the final worker handoff is deliberately not written while results are pending.

No parent-owned file was edited to work around the missing hook. The exact
exports now exist with the signatures above.

After the goal continuation supplied a new delivery context, parent messaging
recovered. `thread_send` accepted the hook request as message sequence 64,
delivery `607004bc-f346-4296-b0b4-58baed33a0b9`. The parent has the concrete
request. Actual real-worker kill/replacement has since passed; compilation
and normal drain/exit also reached a genuine PDF before the disabled-claim
negative failed on the absent hook.

The parent has now installed and the child has inspected all three compiler
hooks in `services/compiler/leases.ts`: admission after upsert under the
compiler lock, authority assertion inside fence, and wall-time cap before the
issued lease. The pre-hook complete suite terminated at 9 pass / 2 fail /
55 expectations / 544.05 seconds; only disabled-claim assertions failed.
One full post-hook suite is active (`bash_21`); no duplicate full suite runs.

The parent separately reported a cold-start test deadline failure. Final fixture
inputs now use a 300-second setup budget around the unchanged real 180-second
native probe, and 900-second budgets for multi-process scenarios. Job waits
remain exact subscriptions, bounded at 420 seconds to cover a replacement's
probe plus compilation. Native Bun 1.3.14 exposes `AsyncDisposableStack`;
fixture construction defers every acquired root/runtime/listener immediately,
moves the stack only after successful setup, and awaits disposal on failure.
No negative assertion, probe, or timer-based sleep was weakened or introduced.
LSP diagnostics on final fixture inputs are clean.

Still parent-owned on the last read: root worker module/order-80 registration
and managed-mode suppression of the API-local compiler pump. The current root
composition also omitted `BackupHost.signingKey`, causing an out-of-scope
typecheck error at `apps/server/src/composition.ts:46`. A subsequent parent send
again failed with the messaging guard, so the stable fixture update is retained
here as well.

The additional parent-requested export now exists in `admission.ts` and the
module barrel:
`managedWorkerPool(db: SqlExecutor): Promise<boolean>`.
It reuses the existing dialect-specific schema discovery verbatim, returns
false when the additive table is absent, and otherwise reads the durable
policy's `managed` flag. `admission.test.ts` exercises actual SQLite stores
with absent schema, unmanaged policy and managed policy. This is the narrow
mode-selection hook for compiler `start`, `pump`, `runJob` and PDF diff; the
parent owns those compiler edits.

The controller also now preserves its startup async context using
`AsyncLocalStorage.snapshot()`. A real-runtime regression proved that request
event callbacks otherwise inherited `ADMISSION_EXPIRED` and stopped controller
renewal/replacement. The regression failed before the fix and all four admission
tests now pass; final owned strict types/type-aware lint pass. Full evidence is
in `docs/evidence/p2o-workers/controller-context.md`. One fresh full suite is
running with all 18 owned inputs frozen at fingerprint
`47596101453ff3e2acea93d3a6540e8348791956e59a9acb9028e971cf8a9661`.
The previous full process is terminal and its owned roots are gone.
Parent notification of this fix succeeded as message sequence 70, delivery
`16ffc7fa-65bb-4e1a-b41b-236992e03dbf`.
