# Compiler deferred quiescence seam: FINAL

October 27, 2026. Parent-owned compiler seam; installed storage-host wiring
remains the driver owner's separate acceptance.

`quiesceCompilerJobs(service, options?)` now accepts
`{dispatch?: "after-exclusive" | "deferred"}`. The default retains the previous
post-exclusive background dispatch. Deferred mode performs the same real
transactional job cancellation, fencing-token advancement, remote-lease
removal, worker-offline update and event recording, but schedules no dispatch.
It does not weaken backup assertSettled or rewrite unrelated operations.

The new inert-service regression proved the old behavior scheduled one task
where deferred maintenance required zero (`mon_RD2WW68BWG56FDRF`, 342.46 ms).
It uses actual compiler schema/storage, queued jobs and a real worker lease,
without registering compiler routes, reapers or workers. The task spy is
call-through and checks synchronous scheduling, not timing luck. It verifies
later explicit dispatch delivers the retained cancellation events.

After correction, `mon_JAP91A9WTM5Q3XM8` completed exit 0:
4 tests passed, 24 assertions, 36.59 seconds on Bun 1.4.4. The affected set
includes the new deferred test, ordinary post-exclusive quiescence, detached
real compilation, and composed backup with an actual admitted worker artifact
upload and stale remote callbacks. Type-aware lint and root TypeScript exited
0. The nullable test cleanup variable was captured in a nonnullable local for
the exclusive callback; no assertion or production behavior was weakened.

Exact output and hashes are retained in
`docs/evidence/p9-supervisor-execution/compiler-quiescence.txt` and
`compiler-quiescence.sha256`. Existing awaited fixture cleanup ran; this receipt
does not claim a separately recorded filesystem inventory for those fixtures.

The driver can now call deferred mode inside its actual stopped-storage backup
exclusive section, with an inert CompilerService and real event port, then
leave event delivery to normal activation. That integration must still prove
its own stopped cohort and archive behavior.
