# Controller-owned installations

This runbook describes the concrete `systemd-local-v1` integration. The current
acceptance status is recorded in
`docs/handoffs/p7-installation-integration.md`; an IN PROGRESS handoff is not
production or configured-update acceptance.

## Prerequisites and ownership

Use Bun 1.4.4, one explicitly selected Linux user manager, and a complete
same-host inventory of every Quire writer. Provision its startup/lingering
policy separately. Manager reachability alone does not prove sandboxing:
the concrete driver probes actual bwrap isolation and attests each invocation.
Compose, Helm and multi-host writers have no inferred support and must return
`UPDATES_DEPLOYMENT_UNSUPPORTED`.

Keep the stable Bun executable/controller/launcher, private control root,
private socket root, application release root, data generations and archives
separate. Canonical paths and private ownership are checked. The application
and helpers never open `control.sqlite`; no application archive contains its
receipts, release floor or recovery authority.

Every unit name is installation-specific with the exact
`quire-<installationId>-` prefix. The controller is an independently supervised
`Type=exec`, `KillMode=control-group`, `SendSIGKILL=yes` service. The driver
creates and stops its exact role/helper slots. Ordinary slots bind to the
controller, and their real cgroups must be empty before maintenance.

Tracked compiler/environment/worker execution is a separate required
capability. Do not forward a manager/Docker socket through the role sandbox or
retain unrestricted `systemd-run` calls as an installation fallback. The
driver's current extension requirements and unsupported bounds are recorded in
`docs/evidence/p7-installation-integration/driver-extension-request.md`.

## Stable and signed artifacts

Build the installation artifacts with `bun run build:installation`; the full
`bun run build` also includes this step. It produces:

* `dist/installation/installation-main.js`: controller, status, recovery and
  stable role launcher.
* `dist/installation/installation-role.js`: signed release factories.
* `dist/installation/ssh.js`: signed SSH proxy asset.

The stable entrypoint is `apps/server/src/installation-main.ts`. Install its Bun
bundle outside every replaceable release and pin both that bundle and the
canonical Bun 1.4.4 executable by SHA-256 in `SystemdDriverConfig`.
The same bundle dispatches controller/operator commands and the driver's
single-argument role-socket invocation.

Each signed release exports the actual factory from
`apps/server/src/installation-role.ts`:

```ts
prepareInstallationRole(binding, role)
prepareInstallationWorker(binding, request)
```

It is callable only from the actual launcher session. API, PostgreSQL
repository, SSH, worker-controller and worker construction use the supplied
release/data binding. API preparation binds its listener but rejects callers;
producers remain inactive until the exact controller activation starts them.

Release assets include:

* The bundled role entrypoint and any configured SSH proxy entrypoint.
* `installation-runtime.json`, containing the complete original-dialect
  migration inventory and asset SHA-256 values, including the role entrypoint.
* `installation-roles.json`, itself included in the signed asset inventory.

The roles metadata names the installation, private control socket and each
exact role slot with kind, host, port, public URL and compiler backend.
API roles name their private credential filename relative to the binding's
local data directory. SSH roles additionally name their existing bridge client
file and signed SSH proxy entrypoint. Worker roles name the approved
coordinator/environment IDs and, for standalone workers, worker ID.

Required top-level JSON filenames pass the parent-verified package parser.
Traversal, absolute/backslash paths, duplicate paths and missing/nonexecutable
entrypoint fences remain active. Do not omit metadata or bypass validation to
work around a package failure. See `p7-package-root-metadata.md` for that
separate parser receipt.

## Provisioning the binding

Normal controller startup opens existing control authority; it does not
initialize missing or corrupt control SQL into an open state. Bootstrap and
legacy conversion require an explicit operator-arranged stopped installation,
the accepted control provisioning/import APIs and independent control backup.
Never infer a baseline release/floor from the `current` symlink alone.

The application root has an exact `.quire-update-root` installation ID and a
relative `current` release symlink. Each native data generation has an installed
`.quire-installation.json` marker. Direct API/repository/migration/worker/SSH
storage entrypoints reject that marker or installed release ancestry before
opening storage. Explicit unmarked source/development invocations retain their
uncontrolled behavior.

Pre-provision at least two distinct fresh targets for preflight and rollback.
They use the original dialect, exact prior migration inventory and application
secret, with pristine SQL and empty blob/Git authority. Provision the backup
signer, API credential files, local work/mail directories and backup/restore
directories in each promoted local generation. Old/failed targets and archives
remain retained; the controller never drops them as rollback cleanup.

For PostgreSQL, the binding names the inspected cluster system identifier and
database OID, distinct S3 bucket, fresh owned Git volume, fresh Redis namespace
and explicit private secret references. Catalog identity privileges and
fresh-store provisioning rights are operator prerequisites. No SQLite fallback
or invented S3 prefix is accepted. The real role also needs its separate local
runtime directory writable under the validated sandbox policy.

Application credentials cannot access the control ledger or operator recovery
secret. API credentials are installation- and role-scoped; their credential
file contains `id`, `installationId`, `channel: "api"` and 64 hexadecimal secret
characters. The controller configuration references each credential's private
file and exact role. Operator credentials use `channel: "operator"` and no role.

Ambient `QUIRE_` data/key/DSN values are discarded in controlled role
construction. Native and scale configuration is reconstructed from the approved
binding and signed role metadata. Rebinding creates new processes and storage
handles; it does not assign a new database to an existing runtime.

## Controller and operator commands

With the pinned stable Bun executable and bundle:

```sh
<bun-1.4.4> <stable-installation.js> controller <private-installation-config.json>
<bun-1.4.4> <stable-installation.js> status <socket-root> <operator-credential.json>
<bun-1.4.4> <stable-installation.js> recover <socket-root> <operator-credential.json> <installation-id> <operation-id>
```

For a local checkout with built artifacts, the corresponding package commands
are `bun run installation:controller <private-installation-config.json>`,
`bun run installation:status <socket-root> <operator-credential.json>`, and
`bun run installation:recover <socket-root> <operator-credential.json>
<installation-id> <operation-id>`. These do not provision an installation.
Production supervision must use the separately installed, digest-pinned
stable executable and bundle, not mutable checkout artifacts.

The controller configuration is parsed by
`InstallationControllerConfigSchema` in
`services/operations/installation/controller.ts`. It contains the concrete
driver, storage policy, signed-feed update configuration and credential-file
references. Its update installation/root must match the driver's installation
and application root. Only the controller constructs `UpdateService` and starts
its scheduler. Before stopping a scheduled update it reopens the current
binding and rechecks that the actor is still an active operator.

The API retains current identity/operator, CSRF, fresh-session and command-key
reservation checks. Its existing task endpoints merge application operations
with authoritative control receipts in ascending cursor order. There is no
queued/running application update mirror. A reservation without controller
acceptance is not a scheduled update.

`status` reads the actual control state and, while maintenance owns an
operation, its persisted authoritative operation receipt through the
authenticated operator socket. Its JSON has `installation` and `operation`
fields; an interrupted receipt is not reconstructed from application SQL.
Recovery requires the exact installation and operation ID and uses
the current epoch/generation from that authority. API credentials cannot
recover. Generic confirmation, deleting a lock or restarting a process cannot
reopen interrupted maintenance.

The private `controller-ready.json` and `.installation-active-<role>.json`
files are operational observations only. No launcher, update, recovery or
floor decision reads them. They cannot replace a control receipt or permit.

## Failure and acceptance

Controller/helper loss retains closed authority until exact recovery. A
reported migration failure can restore the verified archive into a new owned
generation; old database handles are not reused. Completed-health-failure
rollback requires the coordinated reported-result contract described in the
extension request. A committed successful generation must never be
automatically rolled back after it may have accepted user writes.

Do not call an unavailable orchestration/restore capability configured
success. Before enabling signed updates, require the FINAL configured native
and supported same-host scale proof, including the actual role cohort,
signed package, real migration/health/rollback, crash/recovery boundaries and
exact owned-resource cleanup. Foundation, prepared-runtime, supervisor-adapter
and reader tests retain their separately documented scopes.
