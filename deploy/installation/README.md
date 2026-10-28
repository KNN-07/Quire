# systemd-local-v1 host binding

This directory describes provisioning inputs, not a production installer.
The integration entrypoints and signed-release producer must supply the actual
role factories before configuration is accepted.

Provision a private stable controller directory, a separate private control
root, a private socket root, the application's release root, private data
generations, and private archive/restore roots. Keep the controller and control
ledger outside replaceable releases and application generations. The selected
user manager's startup/lingering policy is an operator prerequisite.

The controller runs Bun 1.4.4 and a standalone controller bundle under one
exact `quire-<installationId>-controller.service`. Use
`Type=exec`, `KillMode=control-group`, `SendSIGKILL=yes` and independent
`Restart=on-failure`. The controller bundle calls
`SystemdInstallationAuthority.open(config)`, constructs
`InstallationStorageHost`, constructs the existing UpdateService with
`authority.store`, then installs `startControllerServer`. It owns the single
update scheduler. Never open control SQLite from an API or helper.

The driver creates exact transient role/helper slots from the immutable role
inventory, with `BindsTo`/`After` the controller, control-group termination, and
`Restart=no`. List roles in drain order; launch order is reversed. Include all
activator units. No unregistered execution or Docker container is supported by
this initial driver; those cases fail closed instead of pretending a CLI exit
proved the container stopped.

Pin the canonical Bun executable and standalone stable launcher bundle by
SHA-256. The launcher takes only the private socket path, obtains its real
invocation-bound permit, and chooses `serveReleaseRole` or `serveStorageHelper`
from the permit purpose. It must not construct runtime/storage before the
permit. Release bundles export `prepareInstallationRole(binding, role)` and
carry signed `installation-runtime.json` migration/asset inventories.

The driver uses actual bwrap mount/PID isolation. It does not rely on
`InaccessiblePaths` being effective in a user manager. Ordinary roles cannot
write the socket directory, see control files, access the host manager/Docker
socket under `/run`, or write release/controller files. Maintenance receives
only explicit private data/archive roots and explicit read-only secrets from
`<controlRoot>/secrets/`, never the ledger. The fixture proves bwrap operation
on this host; no global systemd or namespace settings are repaired.

Fresh targets are pre-provisioned and migration-seeded in their original
dialect, with the original application secret. Supply two distinct targets
for preflight and rollback and retain all initial bindings. The host durably
claims each target before import and carries every claimed/committed/failed
binding forward in retained identity checks. PostgreSQL targets require real
catalog identity privileges, a distinct S3 bucket at the same unambiguous
authority, a fresh owned Git volume, and a fresh Redis namespace. Provisioning
rights are not inferred and no database/bucket/volume is automatically dropped.

Recovery is the exact authenticated operator `recover` envelope naming the
current installation, operation, epoch, and generation. The controller first
reobserves and stops old invocations, retains missing helper outcomes, and
restores to a fresh target only when live migration was attempted. Deleting a
lock, restarting a daemon, or waiting cannot reopen maintenance.

Compose, Helm, multi-host writers, missing role factories and unprobed storage
are explicit unavailable capabilities. See `docs/handoffs/p7-supervisor.md`
for the final evidence and the separate configured integration gate.
