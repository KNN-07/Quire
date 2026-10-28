# Complete operational CLI schema inventory

`apps/server/src/migrations.ts:applicationMigrations` collects foundation,
exported native modules and a fresh unregistered adapter factory in canonical
runtime order (`order`, then `id`). The temporary factory is closed in `finally`.
It does not register producers or load external deployment credentials.

`scripts/migrate.ts`, its quiesced transfer source/target inventory, and
`scripts/seed.ts` use this complete inventory. Exported composition modules and
explicit custom-module replacement semantics are unchanged.

Receipt `bash_164`: the actual migrate CLI ran twice with a Git executable that
would fail if invoked, proving schema-only startup does not contact Git.
All adapter migration IDs persisted with stable receipts; producer configuration
remained empty. The actual seed CLI then published seed projects using the same
complete schema. The test, touched-file type-aware lint and full repository
TypeScript passed with exit 0.

Canonical module ordering was then aligned with runtime assembly. The affected
actual CLI regression and touched-file lint passed again in `bash_165`, exit 0.
No live external provider or unowned database was contacted. The temporary
fixture root and child processes were removed on completion.
