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

Later accepted runtime scopes are recorded in `p21-activation-deadlock.md`,
`p22-restored-inventory.md`, `p23-promotion.md` and `p23-environment-build.md`
under `docs/handoffs/`: native and same-host scale rollback, full archive
comparison before activation, successful signed promotion with real managed
compilation, and installed build/probe/publication. Earlier extension requests
are historical where these receipts explicitly supersede them.

An available environment means its toolchain probes passed. Controlled worker
use also requires the signed role's admitted environment IDs and execution
profile; building an image does not grant another role permission to execute
it. Configure those admissions explicitly when deploying a custom environment.

## Admit a built custom environment

The supported path is **build, review, next signed release, replacement worker**.
`GET /api/environments/admission` reports each immutable environment's probe
trust separately from its current signed execution route. `selectable` requires
both. `admitted` identifies a signed route, not a promise that a worker is
currently online. `unmanaged` explicitly identifies a non-controlled deployment.
New-project and project-settings pickers disable unadmitted environments.
Controlled compilation and setting the deployment default also reject them
with `ENVIRONMENT_NOT_ADMITTED`; an existing project pin is never rewritten.

1. Submit the existing operator environment-build operation and wait for its
   terminal result. Download `/api/operations/<operation-id>/download` with that
   operator's authenticated session. Retain the returned `manifest`, `report`
   and build output. Require `available: true`, all real probe checks passing,
   and the immutable `sha256:` image present on the installation host.
2. From the operator-owned host, export the matching successful
   `execution_launches.record_json` from the private `control.sqlite` as
   `build-execution.json`. Match `request.work.kind: "environment-build"`,
   `request.work.operationId`, the installation ID, and `result.image`.
   This is a read-only operator evidence export, not an application capability.
   Never expose that ledger or a signing key to the API/worker sandbox.
3. Construct `admission-input.json` with these fields:
   `manifest` (the current signed `installation-roles.json`), `environment` and
   `report` (from the downloaded build receipt), `build` (the exported execution
   record), and the exact `controllerRole`, `workerRole`, `sourceProfileId`,
   `profileId` chosen by the operator. The source profile must already be a
   Docker profile exclusively for that worker role, with its compile,
   validation and startup probe recipes and adequate limits. It must not
   permit environment builds. Choose a new profile ID.

   ```sh
   ./node_modules/.bin/bun scripts/ops/environments.ts admission-proposal admission-input.json > admission-proposal.json
   jq '.manifest' admission-proposal.json > installation-roles.next.json
   ```

   The proposal is unsigned. Review its source/candidate manifest hashes,
   build execution/release IDs, exact environment ID and image digest.
   Its only grant changes append that ID to the chosen controller and worker
   lists and clone the already-approved worker profile for that exact image.
   It does not add roles, widen limits or recipes, change live metadata, or
   sign anything. Input files must come from the trusted installation; passing
   JSON validation does not authenticate an operator-supplied evidence file.
4. In the separate release-signing environment, use a reviewed release package
   containing the actual role bundle, complete migrations and signed asset
   inventory. The admission packager changes only `installation-roles.json`
   and its inventory digest; it verifies all prior listed asset hashes first.
   Prepare `release.next.json` with `id`, a strictly newer `version` and
   `sequence`, `security`, `notes`, future `expiresAt`, `compatibleSchema`, and
   the exact same-origin HTTPS `packageUrl`. Do not include package hash/size:
   the tool calculates them from the bytes it emits.

   ```sh
   ./node_modules/.bin/bun scripts/ops/environment-admission-release.ts \
     reviewed-package.json installation-roles.next.json release.next.json \
     /operator-only/release-signing.pem > signed-admission.json
   jq -j '.package' signed-admission.json > package.json
   jq '.feed' signed-admission.json > feed.json
   ```

   `jq -j` deliberately emits the exact package bytes without a trailing
   newline. Retain the signed feed, public trust key and package digest.
   Publish through the installation's authorized release channel, validate
   with `scripts/ops/update.ts validate <operator-config.json>`, then schedule
   the exact release through `POST /api/admin/updates` with the real operator
   session, CSRF token, idempotency key and configured maintenance window.
   No application role receives the release private key.
   Before each update, retain two unclaimed pristine preflight/rollback targets
   bound to the **currently installed** release and its migration inventory.
   After promotion, bootstrap targets bound to the old release are not valid
   targets for the next update. Provision the new targets as the host operator;
   when changing the private controller configuration, stop that exact owned
   controller and restart it with the revised inventory. Do not change control
   SQL, reuse a claimed target, or repoint an existing data generation.
5. Require the completed controller update receipt, the new release/floor,
   a replacement managed worker advertising the exact environment ID, and
   successful startup probes. Refresh the admission status, select the
   environment, and compile an actual project. Retain the job's worker and
   environment IDs, consumed signed profile/image, PDF bytes and SHA-256.
   A successful build response alone is not this acceptance.

To revoke this admission, issue another reviewed, higher-sequence signed
release removing that image profile and its environment ID from both selected
role lists, with fresh targets bound to the admitted release as above.
Probe history stays intact, but status becomes `not-admitted`,
new selection/default/compilation is denied, and existing project pins remain
visible for an explicit operator/user migration. Do not delete or edit live
signed metadata or lower the retained release floor. Failed maintenance uses
the controller's existing exact recovery receipt workflow below.

### Explicit native target preparation between signed releases

This is a host-operator preparation step while authority is open, not automatic
production recovery. The acceptance fixture calls
`nativeInstallation().provisionNextNativeTargets()` explicitly between the
sequence-2 PDF proof and sequence-3 revocation. It performs these concrete steps:

* Read the authenticated committed binding and floor. Stop only the
  `driver.controllerUnit` named in that installation's private configuration
  with `systemctl --user stop <exact-controller-unit>`, under its configured
  user manager. Await its exit. Inspect that exact controller, role/helper
  inventory and the execution-ledger unit names; require zero main PIDs and
  empty cgroups before provisioning.
* Create two new private native data roots and distinct generation UUIDs.
  Provision the same application secret, existing API/SSH credential files
  and archive-signing credential required by that installation. The release
  signing private key is **not** one of these files. Create private work,
  backup and restore directories. Apply the complete migration inventory from
  the current signed release to new empty databases; do not seed project data,
  clone a live database, or populate blob/repository authority.
* Each new `InstallationBinding.release` is the exact current signed release
  binding, including target, entrypoint, release ID, version, sequence and both
  digests. Only its data root and generation ID are new. Verify the schema
  ledger, storage identities, empty blob/repository authority and application
  secret identity with the existing storage-binding checks.
  Those checks do not replace the restore's fresh-database row checks.
  The admission acceptance uses a schema-only marker migration with an empty
  new table; it does not use the generic fixture's synthetic data-seeding
  migration. A target containing such application rows is rejected as nonempty.
  Do not delete seeded rows to bypass that rejection or infer support for
  arbitrary data-seeding migrations from this bounded admission workflow.
* Append the two new bindings to the private controller configuration's
  `storage.freshTargets`, retaining previous targets and receipts. Restart the
  same owned controller with its pinned executable, bundle and revised config.
  Require a new supervisor epoch, an actual live controller PID, and the
  unchanged committed binding/floor before scheduling the next signed release.

The fixture records the exact unit observations, target bindings and verified
migration ledgers, stop exit, and restarted authority. Production provisioning
must supply the equivalent host-owned preparation. No application endpoint
creates targets, changes this private configuration or repairs a failed update.

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
