# Bounded compiler processes

The O worker module registers `workersList`, `workerPolicyGet`, `workersCreate`,
`workerPolicy`, `workerDrain` and `workerDelete`. The existing core operation
reader remains authoritative for operation status. Register `migrations` and
`register` from `services/operations/workers`, lane O, order 80.

The compiler must call the admission exports described in
`docs/handoffs/p2o-workers-hooks.md` inside its own claim/fencing transactions.
Without those hooks, managed bounds are not an enforced security boundary.
The API must not start its local compiler pump when operating a managed pool.
`managedWorkerPool(db)` provides durable mode discovery to compiler lifecycle
and PDF-diff paths, returning false for compiler-only stores without the
additive O schema.

## Start the role

First migrate and start the real API with the complete application module list.
Then run the controller using the same data directory and original instance key:

```sh
QUIRE_DATA_DIR=/absolute/owned/quire-data \
QUIRE_COORDINATOR_URL=http://127.0.0.1:3001 \
bun scripts/ops/workers.ts
```

For scale, supply the PostgreSQL/Redis/S3/repository settings from
`deploy/portable/README.md` and the same `QUIRE_SECRET_KEY` as all API roles.
The controller consumes real SQL, event, blob and repository adapters; it does
not create an API-local compile engine. The compiler bearer is derived in memory
using the existing compiler HMAC convention. It is not printed or passed in
command-line arguments. Restrict the coordinator listener to loopback or a
private authenticated TLS network.

Linux user systemd with delegated resource control is required. Native pools
need the accepted bwrap/TeX toolchain; Docker pools need locally provisioned
immutable images with actual environment-registry probe receipts. Each worker executes the accepted compiler main as a
separate transient service, with 2 GiB memory, no swap, 64 tasks, one CPU quota,
no new privileges, control-group termination and a 24-hour maximum lifetime.
Each actual compile retains the compiler's separate isolated per-job limits.
The worker runs the real selected environment/confinement/PDF probes before its
first registration; a process appearing on PATH is not readiness.

For `sandbox:"docker"`, provision environments through the environment lane's
existing registry, then select that policy through the worker API. The
controller resolves available, nonretired manifests through the verified
environment resolver and writes an owner-only JSON manifest beneath
`<dataDir>/work/worker-pools/<controller-owner>/<worker-id>/environments.json`.
It forwards `QUIRE_WORKER_ENVIRONMENTS_FILE` to the real compiler worker.
The worker independently probes each immutable image/profile before advertising
its IDs and dispatches jobs through the accepted `runProfile` path.
Manifest files are removed after exact role exit, and the owned controller
workspace is removed at shutdown. Native roles preserve the default native
worker startup path without a manifest file.

`QUIRE_WORKER_ENVIRONMENT_IDS` optionally restricts the controller's environment
selection. Without it, the current backend's verified environments are selected
automatically. Changing the backend or selected registry IDs drains incompatible
roles before replacements launch; draining roles still consume maximum slots.

One SQL controller authority is renewed every two seconds and expires after ten
seconds. A second active controller fails with `WORKER_CONTROLLER_CONFLICT`.
After takeover, old controller workers cannot claim or renew/complete leases.
The old controller stops its own local units on shutdown; the successor never
signals a PID belonging to another machine or claims to have observed its exit.

## Operator actions

All browser actions require a current active operator, same-origin CSRF for
mutations, and a session created within fifteen minutes. Authorization is
rechecked under the account and compiler transaction locks before receipt
replay. A previously successful receipt never bypasses demotion or revocation.

- Read `/api/admin/workers/policy` for `version` and the actual configured pool.
  Set `min`, `max`, `timeoutSeconds`, `sandbox:"bwrap"|"docker"` and `expectedVersion`.
  Require `0 <= min <= max <= 32`, with a positive timeout at most 600 seconds.
  Enabled Docker capacity requires verified available manifests; missing or
  untrusted environments fail explicitly. This module does not build or pull
  images. Zero capacity can be configured without an available toolchain.
  Saving policy opts into durable managed admission, including before the
  first controller starts; zero policy therefore cannot fall back to legacy
  worker claims or an API-local pump.
- `POST /api/admin/workers` with `{poolId,count}` and `Idempotency-Key` requests
  durable capacity. It requires a current controller, rejects exceeding maximum,
  and returns a queued operation. Success means actual workers registered after
  their host probes, not that rows were invented. Identical concurrent requests
  share the same committed receipt; conflicting bodies return 409.
- Automatic desired capacity is `min(max, max(min, requested, queued+running))`,
  counting jobs compatible with the selected backend and environment IDs.
  All non-exited owned processes, including draining ones, count against the
  hard maximum before a new process can launch. `min:0,max:0` disables new claims
  and drains existing processes. It does not manufacture a successful compile or
  cancel immutable queued jobs.
- Read `/api/admin/workers` for actual compiler heartbeat/lease state.
  `x-worker-versions` maps visible managed worker IDs to lifecycle versions
  because the accepted Worker DTO has no version field.
- `POST /api/admin/workers/:id/drain` with `{expectedVersion}` and an
  `Idempotency-Key` atomically stops future claims. The operation remains queued
  until that worker's current lease finishes and the exact owned process exits.
  An outstanding active job is never killed by normal drain. Minimum capacity
  may cause a different process to replace the drained one after its exit.
- `DELETE /api/admin/workers/:id` with `{expectedVersion}` only retires an
  already-exited managed role without a live lease. Live deletion returns
  `WORKER_BUSY`; cancel work through its authorized compiler API if necessary,
  then drain and wait for exit. Deletion leaves a durable tombstone so the old
  worker ID cannot regain claims.

Unexpected process death fences its actual outstanding leases and records
`WORKER_PROCESS_EXITED`; it does not mark a failed job successful or retry it
silently. A replacement process services subsequent queued work.

`SIGINT`/`SIGTERM` stops controller-owned worker services and awaits their
terminal callbacks before closing adapters. Use the drain operations first
when active jobs must finish before shutting down the controller.

## Verification and ownership

```sh
bun test tests/operations/workers
./node_modules/.bin/tsc --noEmit -p tests/operations/workers/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  services/operations/workers scripts/ops/workers.ts tests/operations/workers
```

Tests use only `quire-p2o-workers-*` temporary roots, loopback ephemeral listeners
and UUID-qualified `quire-worker-*.service` units they launched. Compiler probes
and jobs retain the compiler's own UUID-qualified sandbox cleanup. Do not
glob-stop another session's compiler/worker services.

Systemd reference consulted:
<https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html>
(`--service-type=exec`, `--wait`, `--pipe`, `--collect`, environment forwarding
and propagation of child exit status). The actual installed systemd and native
Bun 1.3.14 behavior is verified by the owned process tests, not inferred from
the current manual alone.
