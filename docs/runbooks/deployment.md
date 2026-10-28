# Deployment

The native baseline is Linux with project-local Bun **1.4.4**. Production web requests use
the built React assets, not Vite's development server. All commands below are
explicit operator commands; installing a prefix does not start or enable a
system service.
Use `node_modules/.bin/bun`, pinned by `package.json` and `.bun-version`; do not
replace the workstation's global Bun. Historical 1.3.14 receipts describe only
those earlier scenarios, not current-runtime acceptance.

## Native owned prefix

Prepare the source release on a connected build machine:

```sh
BUN="$PWD/node_modules/.bin/bun"
"$BUN" install --frozen-lockfile
"$BUN" run build
"$BUN" scripts/ops/install.ts --source "$PWD" --prefix /tmp/quire-owned-install \
  --bun "$BUN" --port 43181
/tmp/quire-owned-install/bin/quire serve
```

The destination must not exist. `bin/quire serve` completes schema migration
before listening. `release/` contains application code and installed packages;
`bin/bun` is the verified 1.4.4 executable. `quire.env` has mode 0600 and a
fresh instance secret. Durable SQLite/WAL, content-addressed blobs and canonical
Git repositories live in `data/`. Do not copy a live SQLite file independently
of its WAL, objects and Git. Use the backup runbook for consistent recovery.
`backup-signing.pem` is a separately generated Ed25519 private key (mode 0600),
not the instance authentication secret. The launcher exports its absolute path
through `QUIRE_BACKUP_SIGNING_KEY_FILE` for production startup.

The local compiler requires the accepted real native TeX, user-systemd, bwrap
and resource-containment configuration. Probe the actual running installation:

```sh
/tmp/quire-owned-install/bin/quire doctor
```

Doctor executes tools, runs the real confined compiler probe and checks the
actual HTTP database health. It does not equate a binary on PATH with an
available environment. It fails when an execution or health probe fails.

For upgrades, install a new prefix, quiesce writers, back up the old installation,
and preserve its exact `QUIRE_SECRET_KEY` and durable data before switching
traffic. Never substitute a newly generated key for an existing instance's key.
Preserve the independent backup signing key and its separately retained trusted
public key as part of the operator's backup trust/rotation procedure.
The installer deliberately does not overwrite a prefix, restore a database,
enable a daemon or make an automatic production cutover.

## Compose scale topology

`deploy/compose/compose.yaml` runs two API/realtime coordinators, one singleton
Git repository role, PostgreSQL, Redis with AOF, authenticated MinIO, a one-shot
bucket provisioner and a one-shot migration role. Only the repository mounts
the canonical Git volume. API private volumes are distinct. The API image
contains no host TeX or user-systemd and uses `QUIRE_COMPILER_BACKEND=docker`;
it does not claim an API-local native environment.

Build with the pinned Bun digest and dated Debian package snapshot. The Dockerfile
retains `/app-system-packages.tsv`; release image IDs and the offline manifest
are authoritative for an already produced image.
The supplied store manifest pins are Linux/amd64. An operator targeting another
architecture must supply verified `QUIRE_POSTGRES_IMAGE`, `QUIRE_REDIS_IMAGE`
and `QUIRE_S3_IMAGE` references for that architecture rather than reuse these
platform manifests.

```sh
docker build -f deploy/runtime/Dockerfile -t quire-owned-app:release .
```

Create a private `runtime.env` with the same 64-hex `QUIRE_SECRET_KEY` and
32-byte-or-longer `QUIRE_REPOSITORY_TOKEN` for both APIs. Set `QUIRE_PUBLIC_URL`
to the browser's real origin. Create a private `compose.env`:

```text
QUIRE_PROJECT=quire-owned
QUIRE_APP_IMAGE=quire-owned-app:release
QUIRE_BUN_IMAGE=oven/bun:1.4.4-debian@sha256:93d5032fe06d163427822dc1598f420363759bb18155c9cc90eb1be05a64a19e
QUIRE_ENV_FILE=/absolute/private/runtime.env
QUIRE_TLS_DIR=/absolute/private/repository-tls
QUIRE_BACKUP_SIGNING_KEY_FILE=/absolute/private/backup-signing.pem
QUIRE_DB_PASSWORD=<random URL-safe secret>
QUIRE_S3_ACCESS_KEY_ID=<private access key>
QUIRE_S3_SECRET_ACCESS_KEY=<private secret>
QUIRE_HTTP_PORT=43182
QUIRE_HTTP_SECOND_PORT=43183
```

`QUIRE_TLS_DIR` contains `ca.pem`, `cert.pem` and `key.pem`. The repository
certificate must cover DNS `repository`; use a CA and key type supported by the
actual Bun baseline. The executed fixture uses RSA-2048. The repository serves
TLS on private port 3443 and forwards to its loopback-only authenticated backend
on 3002. APIs receive the CA, never the repository private key. No TLS
verification is disabled. Supply production certificates rather than copying
the short-lived test certificate.
The backup signer must be an independent Ed25519 PKCS8 key. Only API roles
receive that private-key mount; repository/bucket/migration roles do not.
Both APIs mount the same durable `backups` volume at `/backups`, with
`QUIRE_BACKUP_ROOT=/backups`. This volume is separate from either API's private
`/data`. Scale startup rejects a missing or relative shared backup root before
opening adapters. The same pathname on two private volumes is not shared
storage. Preserve this volume and the independent signer when replacing an API.
The shared root must have mode 0700; new image-backed Compose volumes inherit
that mode. Provision existing shared volumes with UID 1000 ownership and 0700.

```sh
docker compose --env-file /absolute/private/compose.env \
  -f deploy/compose/compose.yaml config --quiet
docker compose --env-file /absolute/private/compose.env \
  -f deploy/compose/compose.yaml up --build --wait --wait-timeout 180
docker compose --env-file /absolute/private/compose.env \
  -f deploy/compose/compose.yaml logs --follow --timestamps
```

PostgreSQL readiness precedes migration. Migration completion precedes the
repository. Repository's authenticated SQL-backed TLS probe, Redis health and
actual bucket provisioning precede API startup. The API readiness probe executes
the real database health endpoint. Dependencies are private; only API ports
bind loopback. Put an operator-owned TLS reverse proxy in front of the API,
preserving WebSocket upgrades, SSE streaming and long compile/download timeouts.
`/api`, `/git`, `/events`, `/scim` and `/internal` retain their real handlers;
other GET/HEAD paths serve built assets or the SPA entrypoint.

`down` retains data volumes. `down --volumes` is destructive and belongs only
to disposable fixtures or an explicitly approved decommission.

### Remote compilation

Run the accepted native worker on a confined host, or consume the environment
producer's actually probed image manifests and configured Docker runner.
Never run `worker` in the plain API image and call that an available compiler.
Do not mount a Docker socket in the API.

```sh
QUIRE_COORDINATOR_URL=http://127.0.0.1:43182 \
QUIRE_WORKER_BEARER=<HMAC-SHA256 instance key over quire:compiler:worker:v1> \
"$BUN" workers/compiler/main.ts
```

Native workers perform their real probe before advertising an environment.
For image profiles, `QUIRE_WORKER_ENVIRONMENTS_FILE` supplies the producer's
JSON manifest array; `QUIRE_WORKER_ENVIRONMENT_IDS` selects verified IDs.
Both producer/worker identity checks and coordinator artifact validation must
pass before a deployment can claim successful remote compilation.
For Docker environments the trusted external worker renders PDFs with actual
`pdftoppm` inside the selected immutable image, then signs a receipt bound to
the job, attempt, fence, environment, image, artifact name and content digest.
The API verifies that receipt under the current lease before fenced storage.
The sandbox never receives the signing credential. Native environments retain
the actual local confined validator. Neither Compose nor Helm API roles
provide a Docker runner or a separate validation sidecar.

## Helm

`deploy/helm` consumes reachable real external PostgreSQL, Redis and an
authenticated pre-provisioned S3 bucket. Provision an existing runtime Secret
with the portable profile variables in `deploy/portable/README.md`. Provision
a separate TLS Secret containing `ca.pem`, `cert.pem`, `key.pem`; its
certificate must cover `<release>-repository`. The chart mounts only its CA
into API pods. Never commit either Secret.
Also provision an independent backup-signing Secret containing Ed25519
`key.pem`, mounted only in the API roles.
Provision `existingBackupClaim` as one durable shared-filesystem PVC writable
by UID 1000. Every API mounts that same claim at `/backups` and receives
`QUIRE_BACKUP_ROOT=/backups`. APIs scheduled across nodes require a real
ReadWriteMany filesystem; a separate RWO backup claim per API is incorrect.
The claim must survive API private-data replacement and release upgrades.
A nonroot init creates its `archives` subdirectory with mode 0700; every API
mounts that same subdirectory at `/backups`. `OnRootMismatch` avoids recursively
changing existing archive permissions when another API attaches the claim.
An API init container copies that projected Secret into a mode-0600 regular
file in a memory-backed volume. The runtime intentionally rejects symlink
private keys; Kubernetes' projected Secret symlinks are never passed directly
to that loader. Roll API pods when rotating this Secret.

```sh
helm lint deploy/helm --set image=<verified-image> \
  --set existingSecret=<runtime-secret> --set existingTLSSecret=<tls-secret> \
  --set existingBackupSigningSecret=<backup-signing-secret> --set existingBackupClaim=<shared-backup-pvc>
helm template quire-owned deploy/helm --set image=<verified-image> \
  --set existingSecret=<runtime-secret> --set existingTLSSecret=<tls-secret> \
  --set existingBackupSigningSecret=<backup-signing-secret> --set existingBackupClaim=<shared-backup-pvc>
helm install quire-owned deploy/helm --namespace <owned-namespace> \
  --set image=<verified-image> --set existingSecret=<runtime-secret> \
  --set existingTLSSecret=<tls-secret> \
  --set existingBackupSigningSecret=<backup-signing-secret> --set existingBackupClaim=<shared-backup-pvc> \
  --wait --wait-for-jobs --timeout 5m
```

Use an immutable registry digest for published releases. Offline clusters must
already contain the architecture-specific image and can use
`--set imagePullPolicy=Never`. The chart creates a migration Job; every API and
repository init container checks every selected PostgreSQL migration digest
before its service starts. API replicas have distinct RWO private claims; only
the singleton repository has the RWO Git claim. Git is not an HA service.
Repository service discovery publishes its singleton address before readiness,
so its own real TLS probe can connect without an empty-Service readiness cycle.
API init containers additionally wait for that authenticated repository probe.

Required cluster prerequisites are an accessible API server, matching Linux
image architecture, an RWO dynamic storage class (or prebound private/Git claims),
a separately provisioned shared backup filesystem, sufficient
capacity, real external stores and trusted TLS. The optional Ingress requires
an installed controller, `ingress.className`, `ingress.host` and
`ingress.tlsSecret`. SSE buffering and WebSocket settings are controller-specific.
The chart includes nginx timeout/body-size annotations, not an invented ingress
controller or certificate issuer.
Fresh claims use a short root init container with only CHOWN/FOWNER to assign
the mounted private/Git directories to UID 1000 before non-root startup.
The existing shared backup filesystem must already permit UID/GID 1000 writes;
the chart does not chown an operator's shared filesystem.
The namespace's admission policy must permit that init container.

`worker.enabled` requires a separately verified confined remote-worker image
and explicit environment IDs. The plain API image is not such an image.
Uninstalling a release does not delete its StatefulSet PVCs; retain or remove
the exact claims only through the operator's recovery/decommission procedure.

## Signed offline package and image bundles

On the connected producer, use a dedicated Ed25519 signing key:

```sh
"$BUN" scripts/ops/airgap.ts create --source "$PWD" \
  --output /tmp/quire-owned-bundle --bun "$BUN" \
  --signing-key /private/release-signing.pem \
  --environments /private/executed-environment-manifests.json \
  --image <application-image> --image <postgres-image> \
  --image <redis-image> --image <s3-image> --image <verified-toolchain-image>
```

The bundle directory contains `manifest.json`, detached `manifest.sig`,
`payload/runtime/bun`, complete installed `payload/release` packages and actual
`payload/images.tar` from architecture-specific `docker image save`. Optional
`payload/environments.json` preserves the selected producer manifests under the
same signed inventory. Manifests
record each producer image's descriptor ID, a stable configuration/rootfs content
digest, and every regular file's length, SHA-256 and
execution permission, plus internal package symlink targets. External symlinks,
special files, changed permissions, added files, byte changes, wrong signing
identity and wrong host architecture are rejected. The private signing key and
production instance secrets/data are not included.

Carry the bundle plus a separately trusted public key to the offline machine:

```sh
"$BUN" scripts/ops/airgap.ts verify /media/quire-bundle \
  --public-key /trusted/release-public.pem
"$BUN" scripts/ops/airgap.ts load /media/quire-bundle \
  --public-key /trusted/release-public.pem
/media/quire-bundle/payload/runtime/bun \
  /media/quire-bundle/payload/release/scripts/ops/install.ts \
  --source /media/quire-bundle/payload/release \
  --prefix /tmp/quire-owned-offline \
  --bun /media/quire-bundle/payload/runtime/bun
```

Image load verifies the signature and payload before invoking Docker, then
checks the loaded configuration/rootfs content digests. Docker 29 normalizes
an index descriptor into its selected platform manifest on architecture-specific
load; that representation change is not a different executable image.
For Docker worker enrollment, run the producer's real `scripts/ops/environments.ts
probe <loaded-image-id> <profile>` on the confined worker host after import and
enroll its resulting manifest through the operator API. Do not silently rewrite
an existing project pin or mark an unexecuted manifest available.
Installation uses bundled packages and Bun without
`bun install`, a registry fetch or a network downloader. Runtime network needs
remain explicit: local operation has no external store dependency; scale
operation still needs its private PostgreSQL, Redis, repository and S3 network.
Offline scale startup also requires the same durable shared backup filesystem
mounted at the same absolute `QUIRE_BACKUP_ROOT` on every API, plus the
independent shared signer. Provision that filesystem separately; an image
archive carries neither live backup data nor storage-provider capacity. Use the
bundled updated Compose shared volume or Helm `existingBackupClaim` contract.
Native installs retain their data-directory backup default.
External providers remain unconfigured or require their actual configured
networks. An offline bundle does not promise offline external integrations.

## Verification and evidence

Direct checks live in `tests/operations/deployment`. Run:

```sh
"$BUN" test tests/operations/deployment
"$BUN" node_modules/typescript/bin/tsc --noEmit -p tests/operations/deployment/tsconfig.json
"$BUN" node_modules/oxlint/bin/oxlint --type-aware --deny-warnings \
  deploy/runtime scripts/ops/install.ts scripts/ops/airgap.ts tests/operations/deployment
```

Native tests use fresh `quire-p2o-deployment-*` temporary roots and an ephemeral
loopback port, subscribe to the startup output before making requests, terminate
their exact process and remove their roots in `finally`. Destructive fixture
cleanup is never a production restore. The final deployment handoff records
actual command exits, exact image IDs, observed health/persistence, cluster
prerequisites, temporary resources and their cleanup.

Primary implementation references consulted: Docker Compose startup-order
documentation, Helm's chart template guide, curl's `--aws-sigv4` manual and the
tagged Bun runtime declarations installed by this repository. The Bun S3 client
cannot create a bucket with an empty object key on baseline 1.3.14; the bucket
provisioner therefore executes curl's real signed bucket request and checks
both subprocess exit and HTTP status.
