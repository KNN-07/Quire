# P2O deployment - VERIFIED FINAL

October 27, 2026. Deployment child `st_01a17c32`. Current runtime acceptance is
project-local Bun **1.4.4**, not the historical 1.3.14 baseline. No global runtime
replacement, production deployment, commit or destructive Git operation occurred.
All final checks are terminal and owned fixtures have been removed.

## Delivered artifacts

- `deploy/runtime/server.ts`: production static/SPA serving around the actual API,
  internal worker, SSE and WebSocket handlers; exports `startProductionServer`.
- `deploy/runtime/{repository,readiness,schema-ready,bucket,doctor}.ts`: real TLS
  repository role, authenticated SQL-backed readiness, migration-digest gate,
  SigV4 bucket provisioning and executed native/HTTP doctor.
- `deploy/runtime/Dockerfile` and `entrypoint.sh`: nonroot production image and
  explicit migration/API/repository/worker roles.
- `scripts/ops/install.ts`: exports `install`; fresh owned-prefix installation,
  complete packages, actual runtime, independent private backup signer and launcher.
- `scripts/ops/airgap.ts`: exports `createBundle`, `verifyBundle`, `loadBundle`;
  actual architecture-specific saved images, complete packages, signed inventory,
  separately trusted public key and verification before image load.
- `deploy/compose/compose.yaml`: two APIs, singleton TLS Git repository,
  PostgreSQL, Redis/AOF, MinIO and completed migration/bucket prerequisites.
- `deploy/helm`: real external-store chart, migration Job, private API claims,
  singleton Git claim, shared backup PVC and independent signing Secret.
- `tests/operations/deployment`: real native, image/offline, transport,
  persistence, worker, PDF and shared-archive proof scripts and private fixtures.
- Operator instructions: `docs/runbooks/deployment.md` and
  `deploy/portable/README.md`.

## Final frozen source and runtime

The final image contains these actual inspected source hashes:

```text
composition.ts 394d2489317a0498cdadc5840dd9c42ce7af08cd1536d097d656f3a1512cc014
artifacts.ts   a2ee800e50209ab6799e672a815b23283649a033ae7c54377e1977b952b045aa
```

`bun144-final-runtime.log` records actual image Bun `1.4.4`, those hashes and
`/backups` mode `0700`, owner `1000:1000`. `bun144-surviving-api-health.log`
records actual HTTP `runtime: bun-1.4.4`, PostgreSQL health `ok`.
The official base is pinned to
`oven/bun:1.4.4-debian@sha256:93d5032fe06d163427822dc1598f420363759bb18155c9cc90eb1be05a64a19e`.

Final application image identity:

```text
producer index  sha256:a8dbcbee1badfa3b3daf85dc43051c416a070de1aae2f99f240a6a01c95d4a00
amd64 manifest  sha256:3f77893296c8469e60a95db8ea74c257c049f8a9c2686ce6b762b135a90f08f7
configuration   sha256:5bf8296034d3abafde4c2f049ba45f2446e724dfd3842733f66a20033d5fd8b3
runtime content f53c86cc306baf771eb14b39677f184ffb4b79ca8458e6c7848b774395888f58
```

Docker normalizes an imported platform archive's descriptor envelope. Verification
compares actual configuration/rootfs content rather than falsely requiring the
producer's index descriptor to survive import unchanged.

## Current Bun 1.4.4 terminal verification

All evidence paths below are under `docs/evidence/p2o-deployment/`.
Each log contains its exact command, terminal exit code and stdout/stderr.

| Receipt | Terminal result |
| --- | --- |
| `bun144-native-copy-fixed.log` | Exit 0; 11 tests, 23 assertions. Actual installed Bun 1.4.4, real web/SQLite/HTTP identity restart, private modes, unauthorized worker route and ten signed-inventory/prefix negatives. |
| `bun144-final-owned-types.log`, `bun144-final-owned-lint.log`, `bun144-final-profile-lint.log` | Exit 0; scoped strict TypeScript/type-aware lint and final profile-pack edit lint. Final pack edit also had no LSP diagnostics. |
| `bun144-final-image-build.log` | Exit 0; actual frozen-source image and production web build. Existing Vite chunk-size warning retained. |
| `bun144-final-compose-start.log` | Exit 0; actual two-API full-product startup, real stores, migration and authenticated TLS repository readiness. |
| `shared-backup-schema-ledger.log` | Exit 0; actual 32 PostgreSQL schema receipts, including adapter migrations from the full application inventory. |
| `bun144-final-helm-lint.log`, `bun144-final-helm-upgrade.log` | Exit 0; final chart and real Helm revision 2, migration Job and ready API/repository pods. |
| `bun144-final-shared-compose-proof.log` | Exit 0; signed archive created by A, A container and entire private volume removed, exact archive verified and listed by B. |
| `bun144-final-shared-helm-proof.log` | Exit 0; signed archive created by API ordinal 1, its pod and entire private PVC removed, exact archive verified and listed by ordinal 0. |
| `bun144-offline-pack.log` | Exit 0; real signed five-image/three-profile pack, actual image import, offline native installation, migration, actual confined native doctor and SQLite HTTP health. |

Compose archive `c0ee5d60-fb93-4a56-86c1-530489129db7` had manifest digest
`fa24bbd69ba24e54076684c2af4f29282e6fbb74552aa7cb43e8776cab038e2c`.
Helm archive `a625da5c-239c-49c3-a4bf-3bb0584316af` had manifest digest
`ff9b6b87b402215932b0f06bf36b788385ab742987e4b43ed36b7ce73cbece9a`.
Both lived under the same absolute `/backups` on their respective API pairs.

Compose uses one separate durable `backups` volume, not either private `/data`.
Helm requires `existingBackupClaim`, mounts its common `archives` subdirectory
at `/backups`, and initializes it as UID 1000 with mode 0700.
`fsGroupChangePolicy: OnRootMismatch` avoids widening existing archive modes
when a second API mounts the claim. Independent signer bytes are shared across
APIs; projected Kubernetes signer symlinks are copied into private regular files.

The actual Kubernetes fixture was the existing single-node
`kind-tensorjudge-gvisor`, with one shared same-node RWO backup filesystem.
This is not a multi-node RWX acceptance claim. Production multi-node placement
requires an operator-provisioned real RWX filesystem writable by UID 1000.
Git remains singleton. Ingress/controller/public TLS and external providers were
not provisioned or represented as verified production services.

## Final signed offline pack

The executed pack contained **9,462 inventory entries**, **1,674,049,601 regular-file
bytes**, native Linux/x64 Bun 1.4.4, complete installed packages, actual saved
application/PostgreSQL/Redis/MinIO/toolchain images and the producer's three
final executed manifests. The toolchain image is
`sha256:1ffb2fe8f831d4296f2de1c993a491444a9f6706e5498151ff41783468448258`.
Profile IDs were preserved exactly:

- Default: `82483981-0386-41e0-8b1e-b97d4da70b54`.
- Restricted: `cd23a37b-b165-4143-8480-b55a1a64b2f8`.
- Knitr: `dde2b77c-9e05-4754-8a00-a2d1e0d93c33`.

These are carried executed artifacts, not implicit production registrations.
Operators must provision the exact worker image and enroll matching manifests.
Scale deployment additionally requires the shared backup filesystem and signer;
an offline image archive does not provision storage or external networks.

Retained current artifacts:

```text
bundle-1.4.4-manifest.json
  d511c11dcba6c7d288240faf243ae6d736f6e64b5070624ebe7fa13f7eb77015
bundle-1.4.4-manifest.sig
  d460ab626c70feb6202bef388816e1e592bd23dfa3063a9634678e091e2a1bd5
bundle-1.4.4-trusted-public.pem
  5bc76a5573350d342fe142a442a97a59dda174e47e022552b2cf47e94761eb6c
```

`bun144-retained-artifact-hashes.log` also hashes the producer manifest and
historical PDF. The full ephemeral pack, image tar, installation and private
signing keys were removed by awaited proof cleanup; no release was published.
The runnable pack tooling and signed execution receipts remain.

## Preserved historical scenarios, Bun 1.3.14

These are not relabeled as current-runtime acceptance:

- `realtime-validation-proof.log`: actual durable SSE replay and authenticated
  WebSocket synchronization of 113 source bytes, exit 0.
- `compose-validation-durable.log` and `helm-validation-durable.log`: actual
  SQL metadata, S3 source bytes and canonical Git tree persisted across upgrades.
  Canonical tree: `fa74bfc2af9f841e0e092789a0ce31bbeac49e0d`.
- `deployed-pdf-proof-branch.log`: hardened API rejected missing and forged
  receipts with 422 `PDF_VALIDATION_REQUIRED`, then accepted the actual external
  Docker worker's rendered/signed PDF. Authorized download was 41,497 bytes,
  SHA-256 `ed71277fae5986392ec628709e8c33a3dc6244b4cf41f18871d2bbaef094ecbc`.
  Worker exit was 0 and gateway/manifest cleanup was awaited.
- `image-worker-current-proof.log` and `remote-worker-proof.log`: actual Docker
  and native confinement probes plus deployed lease/heartbeat registration.
- `production-desktop.png`, `production-mobile.png`: inspected real production
  landing page at 1365x900 and 390x844, without blank or overlapping layout.
- `bundle-proof-validation.log` and unversioned `bundle-manifest.*`: earlier
  successful 1.3.14 offline scenario, preserved separately from current artifacts.

APIs have no Docker socket, runner or native TeX. Docker PDF validation belongs
to the trusted external worker; its receipt is checked against current lease,
image, job, attempt, fence, path and digest before fenced storage.
The parent receipt is `docs/handoffs/p2o-remote-pdf-validation.md`.
Its failed bash_145 was a binary-body fixture mislabeled as JSON, not an
accepted validation bypass; bash_146 subsequently passed the real HTTP negatives.
Unchanged historical PDF/SSE/browser scenarios were not globally rerun.

## Failures retained and corrected

Initial real deployment failures remain in evidence: YAML tmpfs quoting,
bucket creation API selection, source-fixture closure, TLS key compatibility,
repository discovery/ownership, Kubernetes projected-key symlinks and Docker
descriptor normalization. No verification or TLS check was disabled.
The actual shared-root HTTP failure was `BACKUP_ROOT_PERMISSIONS`: the initial
volume root inherited 0755. Image provisioning and Helm's private shared
subdirectory now enforce 0700; actual archive proofs pass.

The first 1.4.4 native run failed `ERR_INCOMPATIBLE_OPTION_PAIR` because older
Bun accepted `dereference` with `verbatimSymlinks`. The copy helper now uses
mutually exclusive options while preserving isolated-package symlinks; the
complete relevant run passed once after this material correction.
New optional-WebSocket type diagnostics were routed to the root owner and
resolved by its required-handler contract, not suppressed in deployment.

## Exact cleanup and ownership

`bun144-cleanup-{compose,helm,namespace,host-images,cluster-images,pv,private-roots}.log`
record exit-0 removal of the exact owned project/namespace, all remaining
volumes/PVCs/PVs, owned app tags/importer aliases and private fixture directories.
The creator private volume/PVC had already been deleted inside each real proof.
Both owned port-forwards were stopped. Native/worker/doctor children and streams
were awaited by their fixtures.

`bun144-cleanup-verified.log`, exit 0, asserts no owned containers, network,
volumes, namespace, matching PV claim references, image tags, `/tmp` fixture
roots or listeners on ports 43182-43186 remain. It records project-local Bun
1.4.4 and unchanged global `/home/norman/.bun/bin/bun` 1.3.14.
The producer's retained toolchain image, shared base/store images, build caches,
existing cluster and unrelated workloads were not pruned or reconfigured.

## Post-write review

1. Owned paths only; frozen composition and other lanes were not edited.
2. Installer, image, serving, storage and artifact responsibilities stay separate.
3. CLI inputs, signed manifests, HTTP results and executed profiles cross parsed boundaries.
4. Role/action/profile variants use explicit contracts and exhaustive branches where applicable.
5. No casts, suppression, skipped assertions or unsafe execution fallback make checks pass.
6. No retry shim or broad defensive layer hides invalid inputs or unsupported roles.
7. Existing package/runtime/TLS contracts are consumed directly; single-use logic stays local.
8. Real tools, stores, HTTP, Docker, Git, Kubernetes and process cleanup provide evidence.
9. Async proofs subscribe before actions and use bounded events, not timing sleeps.
10. Side effects use owned roots/IDs; no re-query is used to justify broad destructive cleanup.
11. Existing logging/style and small interfaces are retained. `bun144-owned-size.log`
    reports a maximum of 121 nonempty/noncomment owned TypeScript lines per file.
