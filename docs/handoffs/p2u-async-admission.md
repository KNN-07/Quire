# Compiler and collaboration callback admission - VERIFIED

Parent follow-up, October 27, 2026. The changed native compiler/collaboration
paths pass. This is not whole-backup, whole-editor or distributed admission
acceptance; those owners retain their independent integration gates.

Detached compiler pump/job/PDF-diff/reaper work uses fresh
`admission.background` scopes. Actual local execution is a whole admitted
writer through artifact publication and cleanup. Realtime mutation messages
are whole writers; delayed refresh and history capture are fresh background
operations, not continuations of an expired HTTP request.

The exported `quiesceCompiler(context)` must run inside exclusive admission.
It atomically cancels queued/running jobs with `BACKUP_QUIESCED`, increments
fences, removes remote leases, marks affected workers offline and records
terminal events. It never waits on remote callbacks while admission is closed.
Event delivery is scheduled after admission reopens.

`bash_129` passed both new compiler tests: an actual PDF build continues after
its HTTP response, and exclusive quiescence rejects late remote callbacks.
Both targeted and wildcard WS/SSE revocation tests also passed. Nine of ten
existing transport cases passed; cursor presence exposed a separate throttle
race, retained as a failure rather than relabeled green.

## Trailing presence correction

The previous server discarded presence updates within its throttle window.
Client-side spacing did not guarantee server processing spacing after
asynchronous authorization. A final cursor could disappear until another
later update. A real burst regression failed, then passed with additional
observation, confirming that timing-dependent evidence alone was insufficient.

`PresenceQueue` now retains the latest pending cursor, coalesces while a
broadcast is in flight, and emits the trailing value after the throttle window.
Broadcast rechecks current authentication/access. Socket/file/service closure
cancels pending timers. Controlled-clock tests exercise exact trailing
delivery/cancellation without sleeps or timing luck.

`bash_132` exited 0: all 13 affected queue/transport tests passed, including the
original authenticated presence case, burst delivery, convergence/restart,
lost acknowledgments, offline deadline, epoch recovery and role/token/session
revocation. Type-aware lint on all changed compiler/core/test files passed.
The passing actual compiler and SSE cases were not rerun unnecessarily.

Fixtures awaited transport/socket/runtime cleanup and removed their exact
temporary roots. Earlier failed receipts `bash_129`, `bash_130`, and the
diagnostic timing observation `bash_131` remain in the session evidence.
