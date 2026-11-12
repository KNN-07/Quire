# PROJECT KNOWLEDGE BASE

**Generated:** 2026-11-12
**Commit:** 21089107ed830aa09d60a1206f32511617e64aaf
**Branch:** main

## OVERVIEW
Quire is a self-hosted LaTeX workspace with collaborative editing, Git history,
optional providers, and isolated PDF compilation. Its TypeScript stack uses
repository-local Bun 1.4.4; local storage uses SQLite, local blobs and Git,
while the portable profile uses PostgreSQL, Redis and S3-compatible storage.

## STRUCTURE
```text
Quire/
├── apps/                 # Server composition and browser application
├── packages/             # Shared contracts and runtime authority
├── services/             # Core, accounts, adapters, compiler and operations
├── workers/compiler/     # Compiler execution process
├── tests/                # Service, integration and browser acceptance families
├── deploy/               # Deployment roles and portable runtime
├── scripts/ops/          # Environment admission and fixture restore drills
└── docs/                 # Requirements, decisions, runbooks and bounded evidence
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Application assembly | apps/server/src/composition.ts | Ordered modules; F owns composition |
| Endpoint changes | packages/contracts/src/endpoint.ts; registry.ts | Eight route groups plus health |
| Runtime and SQL | packages/runtime/src/context.ts; database.ts | Runtime/ModuleContext; paired SQLite/PostgreSQL migrations |
| Project/source authority | services/core/base/ | Recovery precedes CoreProjects and route registration |
| Git and review | services/core/git/; services/core/review/ | Journaled Git; realtime lifecycle |
| Provider integration | services/adapters/ | Contributions extend core delegates; interchange owns dispatch |
| Identity/governance | services/accounts/identity/; governance/ | Authentication, onboarding and organization lifecycle |
| Billing/delivery | services/adapters/billing/; delivery/ | Stripe REST receipts and durable mail outbox |
| Compilation | services/compiler/; workers/compiler/main.ts | Service/lease authority and worker lifecycle |
| Browser/editor | apps/web/src/main.tsx; apps/web/src/features/editor/ | AppRouter mount; editor owns geometry |
| Installation/recovery | services/operations/; deploy/ | Controller authority, backups, admission and workers |
| Deployment/toolchains | deploy/runtime/; deploy/helm/; scripts/ops/ | Runtime roles, operator inputs and admission proposals |
| Test fixtures | tests/fixtures/runtime.ts; tests/core/base/harness.ts | runtimeFixture/isolatedData and baseFixture |
| Browser acceptance | tests/ui-editor/; tests/ui-product/; tests/e2e/ | Browser suites and isolated E2E composition |
| Operator procedures | docs/runbooks/ | Deployment, adapters and update constraints |
| Requirements/history | docs/discovery/; docs/handoffs/ | Design evidence and phase-specific receipts |

## CODE MAP
Symbols below are source/export observations from reducer digests. Current
resolved reference counts and graph centrality are unmeasured.

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| createApplication | Function | apps/server/src/composition.ts | Unmeasured | Assemble ordered modules |
| endpointRegistry | Registry | packages/contracts/src/registry.ts | Unmeasured | Frozen endpoint descriptors |
| Runtime / ModuleContext | Runtime contracts | packages/runtime/src/context.ts | Unmeasured | SQL/UoW, events, blobs, services and admission |
| createApplicationAdapters | Function | services/adapters/index.ts | Unmeasured | Adapter assembly |
| CompilerService / CompilerLeases | Service symbols | services/compiler/index.ts | Unmeasured | Compilation and lease authority |
| workerMain | Function | workers/compiler/main.ts:8 | Unmeasured | Controlled-entry admission before worker setup |
| runtimeFixture / baseFixture | Test helpers | tests/fixtures/runtime.ts:11; tests/core/base/harness.ts:21 | Unmeasured | Runtime isolation and project fixture |
| remoteGitHarness | Test helper | tests/adapters/remote-git/harness.ts:24 | Unmeasured | Remote Git fixture |
| adapterFixture | Test helper | tests/adapters/shared/harness.ts:21 | Unmeasured | Shared adapter fixture |
| assistantApplication | Test helper | tests/ui-editor/assistant/application.ts:23 | Unmeasured | Assistant application fixture |
| sourceEntry | Test symbol | tests/ui-editor/source/browser-session.ts:5 | Unmeasured | Source browser session |

## CONVENTIONS
- Feature lanes export `register(context)`; server composition owns their ordering.
- Services receive `SqlExecutor`, never native database handles.
- Provider/Git preparation and release happen outside SQL; `publish(tx)` is final SQL only.
- Installation control uses an independent ledger, never application `schema_migrations`.
- Use package scripts or repository-local Bun 1.4.4; the plan's Bun 1.3.14 baseline is historical.
- Custom lint forbids product-copy em dashes and unexplained suppression directives.

## ANTI-PATTERNS (THIS PROJECT)
- No unsandboxed compiler fallback, pretend PDF or placeholder-success routes.
- No browser-authoritative durable state, canned AI success or mock production integrations.
- Never capture a root SQL executor inside a transaction callback; keep blob/Git/hash/network work outside SQL.
- Never replay uncertain external writes, expose plaintext tokens or bypass SSRF controls.
- Keep credentials out of URLs, project files, exports and logs.
- Never replace the global runtime or generate per-API instance keys.
- Do not copy live SQLite independently of WAL, blobs and Git; preserve instance keys and independent backup signing authority.

## UNIQUE STYLES
- Source editing uses a private tracked Y.Doc, explicit proposals and actor-scoped draft recovery; no second save path.
- Event waits subscribe before actions and dispose cancellations.
- E2E selects matching specs via `tests/e2e/playwright.config.ts`, with one worker, fresh data, health readiness and no server reuse; Bun browser suites have separate selection.
- Historical portable baseline capture requires an extracted, unmodified `3fe3a23` tree; never target user data.
- Environment profiles use owned images rather than host PATH discovery.
- SMTP delivery is at least once across remote acceptance and local commit.

## COMMANDS
```bash
bun install
bun run db:migrate
bun run seed
bun run doctor
bun run dev
bun run dev:web
bun run typecheck
bun run lint
bun run build
bun run verify:matrix
bun run test
bun run test:e2e
./node_modules/.bin/bun test tests/ui-editor/source
```

## NOTES
- Read nested AGENTS.md for domain-specific authority and fixture constraints.
- Implementation plans and feature matrices describe work to build, not completed behavior.
- Architecture documents are dated design checkpoints, not a current source census.
- Evidence retains snapshot, fixture, provider, platform and reviewed-state boundaries.
- P67 integrated validation preserves `behavioralAcceptance:false`; static/build success does not prove whole-product acceptance.
- Executable presence alone does not establish compiler readiness.
- Backup-admission scale needs `QUIRE_TEST_POSTGRES_URL` and `QUIRE_TEST_REDIS_URL`; review optionally uses `QUIRE_REVIEW_POSTGRES_URL`.
- Owned provider fixtures establish protocol behavior, not live inference or payment availability.
- Native installation acceptance observes processes/systemd/cgroups; ledger fixtures do not attest to host fencing.
- Helm requires operator images, existing secrets, durable backup storage and external services; ingress and workers default off.
- Offline environment admission proposals are unsigned review material; probes grant no execution admission.
- `scripts/ops/restore-drill.ts` accepts only `--fixture complete`, never a live restore.
- `docs/feature-matrix.md` retains its October 27, 2026 checkpoint; historical signatures are documentary claims.
