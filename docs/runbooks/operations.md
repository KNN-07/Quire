# Default operational host

The actual `createApplication` default catalog includes O070 signed-update
schemas/routes and O085 support schemas/routes once, alongside the existing
backup, task, environment and worker modules. The schema-only
`applicationMigrations()` collector consumes that same native catalog.
An explicit `modules` option still replaces the catalog; it does not silently
install another operational or adapter aggregate.

Use project-local Bun 1.4.4:

```sh
./node_modules/.bin/bun run db:migrate
./node_modules/.bin/bun run doctor
```

Run migration and doctor with the intended installation's actual runtime
configuration. This integration's tests use only disposable local roots and
ephemeral loopback ports; they do not provision an operator production host.

## Support

`app.start()` starts support SIEM dispatch only when O085 support is selected.
Repeated starts retain one support runner. `app.close()` stops that runner and
awaits pending delivery before adapter and runtime storage shutdown. SIEM
delivery remains SQL-leased and receiver-idempotent across API processes.

An authenticated current operator can create diagnostics through
`POST /api/admin/diagnostics`, with ordinary same-origin CSRF headers and an
`Idempotency-Key`. The returned operation's existing
`GET /api/operations/<id>/download` endpoint serves the actual allowlisted
redacted JSON bundle and rechecks download authorization. Diagnostics are
not a database dump or source export. SIEM configuration uses the existing
versioned `GET`/`PUT /api/admin/audit/siem` endpoints.

The public same-origin `POST /api/support/inquiries` saves bounded private
input durably. Configure the validated destination with
`QUIRE_SUPPORT_RECIPIENT` or `createApplication({ adapters: {
supportRecipient: "support@example.org" } })`. Default registration consumes
that same application's `adapters.inquiries` handle. Queued inquiries are
inserted atomically into the existing mail outbox using
`support:<inquiry.id>` deduplication; only the existing delivery scheduler
sends them. HTTP 200 means queued, not delivered. Without SMTP configuration,
mail remains local.

Without a configured recipient, the route returns 503 `SUPPORT_UNCONFIGURED`
and an opaque saved inquiry ID, never a claim of mail delivery. A replaced
custom support registration remains caller-owned; composition does not
overwrite it merely because its descriptor uses the same module ID.

The entire support dispatch, including network delivery and durable
acknowledgement, is admitted through `admission.background`, so maintenance
drains it before taking a snapshot.

## Signed updates

Without installation-host safety, operator `GET /api/admin/releases` returns
an empty page and authenticated, CSRF-authorized
`POST /api/admin/updates` returns 503 `UPDATES_UNCONFIGURED`.
No default API starts an update scheduler.

Feed URL, pinned signer and install prefix alone do not make an installer
ready. The host also requires retained distributed maintenance, a current
verified full backup, isolated restored migration preflight, actual live
migration/activation/executable health checks, rollback with control-storage
reconnection, and crash-retained recovery authority. The existing update
producer's signed package and recovery methods are documented in
`docs/runbooks/updates.md`; do not replace their safety callbacks with no-ops.

`docs/handoffs/p2o-integration.md` records the current integration evidence
and the exact parent-owned installation-authority decision.

## Affected verification

```sh
./node_modules/.bin/bun test tests/integration/operations
./node_modules/.bin/tsc --noEmit --pretty false -p tests/integration/operations/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  apps/server/src/composition.ts services/operations/index.ts \
  services/operations/support tests/integration/operations
```

Producer deployment, environment, worker, backup, signed-update and SSH
acceptance receipts remain separate. These commands are not a request to
rerun those unchanged suites or perform a real production update.
