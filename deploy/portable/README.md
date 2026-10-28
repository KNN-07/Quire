# Portable application roles

Use project-local `node_modules/.bin/bun` 1.4.4, pinned by `.bun-version` and
`package.json`. Do not replace the workstation's global runtime. Deployment
images, native prefixes and signed offline packs verify this exact version.

The native profile remains the default. The scale profile requires real
PostgreSQL, Redis, authenticated S3 and the singleton repository process.
APIs have separate private local directories; only the repository process
mounts the durable Git volume. It requires Linux `flock` and Git.

All API roles use the same original `QUIRE_SECRET_KEY` (64 lowercase hex
characters), PostgreSQL database, Redis namespace, bucket and repository
credentials. Never generate an independent instance key per API directory.

Required scale environment:

```text
QUIRE_PROFILE=scale
QUIRE_POSTGRES_URL=postgres://...
QUIRE_REDIS_URL=redis://...
QUIRE_REDIS_NAMESPACE=<deployment-specific namespace>
QUIRE_REPOSITORY_URL=https://<private repository service>
QUIRE_REPOSITORY_TOKEN=<at least 32 secret bytes>
QUIRE_S3_ENDPOINT=https://<S3 endpoint>
QUIRE_S3_BUCKET=<pre-provisioned bucket>
QUIRE_S3_REGION=<region>
QUIRE_S3_ACCESS_KEY_ID=<credential>
QUIRE_S3_SECRET_ACCESS_KEY=<credential>
QUIRE_SECRET_KEY=<original instance key>
QUIRE_BACKUP_ROOT=/absolute/shared/backup-filesystem
QUIRE_BACKUP_SIGNING_KEY_FILE=/absolute/private/independent-ed25519.pem
```

Every scale API must mount the same durable backup filesystem at exactly the
same absolute `QUIRE_BACKUP_ROOT`. Equal pathnames on private API volumes do
not satisfy this contract. Keep it separate from `QUIRE_DATA_DIR`, preserve it
when replacing an API, and provision ReadWriteMany storage for multi-node API
placement. The independent signer must also be the same trusted key across APIs.
Missing/relative shared roots reject startup before adapters open. Native
installations retain their local data-directory backup default.

`QUIRE_RECONCILE_MS` defaults to 1000. Redis only wakes durable SQL catch-up;
periodic reconciliation and explicit reconnect repair notification outages.
After a SQL commit, a failed Redis publish is logged rather than reported as
a failed mutation. A failed initial Redis connection rejects startup.

Start schema migration before either repository service or API:

```sh
bun run db:migrate
QUIRE_REPOSITORY_VOLUME=/srv/quire/git QUIRE_REPOSITORY_PORT=3002 bun run start:repository
```

The repository listener defaults to loopback. For private-network deployment,
set `QUIRE_REPOSITORY_HOST`, terminate TLS and authenticate the network boundary.
The APIs must use its remote coordinator; no API issues raw SQL fences around
repository admission.

For an empty development installation, seed through the real remote ports:

```sh
bun run seed
QUIRE_DATA_DIR=/srv/quire/api-a QUIRE_PORT=3001 bun apps/server/src/main.ts
QUIRE_DATA_DIR=/srv/quire/api-b QUIRE_PORT=3003 bun apps/server/src/main.ts
```

For an existing native installation, stop every API and compiler writer, finish
native intent recovery, and retain the original key. Use an empty migrated
PostgreSQL target and the running repository service:

```sh
QUIRE_TRANSFER_SOURCE=/srv/quire/native bun scripts/migrate.ts --quiesced
```

`--quiesced` is an explicit operator assertion that the source and target have
no writers. Transfer rejects unfinished source/review/repository intents,
active compiler jobs, nonempty target and key mismatch. It copies original
SQL receipts, explicit orders and counters, verified blob bytes, every Git
object and ref, then atomically finalizes target metadata. PostgreSQL retains
its own selected-dialect migration fingerprints; the command emits the original
native migration ledger in its receipt. Branch fence history retains the larger
native/target fence with expired ownership. A failed transfer must be
investigated and its disposable target recreated; it is not an online migration
or an automatic retry protocol. Start API serving only after successful transfer.

Scale APIs never start a local compile pump. Run actual compiler worker roles:

```sh
QUIRE_COORDINATOR_URL=https://<private API> \
QUIRE_WORKER_BEARER=<derived compiler worker bearer> \
bun run worker:compiler
```

The bearer is HMAC-SHA256 with the instance key over
`quire:compiler:worker:v1`; provision it through the secret manager, not logs.
Workers require the accepted confined native toolchain. Graceful shutdown
stops workers/transports before adapters and the PostgreSQL pool.

`bun run build` emits the existing API bundle plus separate repository and
compiler worker bundles. These roles do not imply Git HA, autoscaling, SSH,
Helm, backup or air-gap acceptance.

Runnable deployment artifacts now live under `deploy/runtime`, `deploy/compose`
and `deploy/helm`. The owned native installer is `scripts/ops/install.ts`; signed
offline packages and actual image archives use `scripts/ops/airgap.ts`.
See `docs/runbooks/deployment.md` for commands, TLS and durable-volume boundaries,
and `docs/handoffs/p2o-deployment.md` for terminal acceptance evidence.
The production static/API entrypoint is `deploy/runtime/server.ts`, preserving
the original API, realtime and internal worker transports. Scale coordinators
select `QUIRE_COMPILER_BACKEND=docker` and require separately verified worker
environment manifests instead of claiming an API-local native toolchain.

`bun run test:scale` runs the actual owned-service two-API failure/recovery
check, fresh scale seed/restart and offline-transfer preflight suites. It
requires Docker and the accepted confined native TeX toolchain.
