# P2X remote Git adapter handoff

Owner: `st_01a17c48`. Date: October 27, 2026.

Status: **IMPLEMENTED; foundation credential blocker resolved by parent follow-up**.

Configured GitHub and GitLab behavior, canonical generic Git transport,
fixtures, migration, recovery and documentation are complete inside the
assigned hard write boundary. The exact owned behavior command passes.
The parent has now added and verified non-OAuth credential admission and explicit
local credential deletion; see `p2x-generic-credentials.md` for the current
implementation and receipts. The shared P2X base is also FINAL. This handoff
still does not claim whole-application composition acceptance.

Final import ownership: interchange exclusively owns the unified
`POST /api/imports` route in composed runtimes. Remote Git's module registers
only migration and recovery by default. Its route is an explicit standalone
fallback (`registerImportRoute: true`) and must not be enabled when interchange
is assembled.

## Delivered behavior

### GitHub and GitLab

- OAuth authorization code with shared S256 PKCE/state/session/configuration
  binding and encrypted grants.
- Current-user repository listing with page cursors.
- New-project import from a saved grant and selected branch.
- New provider repository creation followed by actual Git push.
- Manual pull, push and project binding disconnect.
- Current grant ownership/version, provider configuration, adapter cursor,
  project ACL/policy and branch fence checks.
- GitHub application-grant deletion and GitLab OAuth revocation.

### Generic Git

- Credential-free HTTPS URL validation, all-address policy checks and selected
  DNS address pinning through `http.curloptResolve`.
- Redirect/proxy denial, disabled hooks/system/global config and no terminal
  prompting.
- Ephemeral askpass credentials that never enter a URL, command argument,
  source tree, archive, operation result or error text.
- Actual clone/fetch/push mechanics verified over smart HTTP.
- `clone`, `fetch`, `push` contribution actions are registered.

The generic contribution now becomes available when the operator enables it and
Git is installed. User-owned credential admission verifies access to the selected
repository and stores encrypted repository-bound credentials. Local connection
deletion forgets the credential without claiming upstream token revocation.
The original foundation request below is retained as historical scope context;
its current resolution and test receipts are in `p2x-generic-credentials.md`.

### Canonical publication and conflicts

Remote objects enter only through `RepositoryService.importPack`; outbound
objects use `RepositoryService.exportNamed`. New source is built with
`CoreProjects.prepareSource` and committed with
`finalizePreparedSources(tx, ...)` inside the supplied transaction. No
API-local canonical repository path is used.

Imports preserve advertised named branches and tags, including
`protected/release` and `v1.0.0` fixture refs. Submodules, symlinks, `.git`
paths and Git LFS pointers fail with actionable errors. Internal
`refs/quire/*` are not exported.

Pull fast-forwards only when ancestry proves safety. Divergence creates
`<branch>-remote-conflict-<oid>` locally and leaves main/remote unchanged.
Push uses `--force-with-lease`; a moved remote receives the local commit only
at `quire-conflict/<branch>-<oid>`. A saved conflict blocks later
synchronization until the remote head is an ancestor of the resolved local
head.

`remote_git_intents` persists source/project/binding/ref/receipt descriptors
before canonical ref publication. Startup re-acquires the branch fence,
rechecks active grant ownership and project/workspace authority, adopts the
repository intent, and finalizes source, binding, cursor, operation receipt and
events transactionally. The rollback fixture proves restart completion.

## Exact public exports

Public entrypoint: `services/adapters/remote-git/index.ts`.

```ts
type RemoteGitIntegrationOptions = RemoteGitOptions & {
  readonly registerImportRoute?: boolean;
};

createRemoteGitIntegration(options?: RemoteGitIntegrationOptions): {
  readonly contributions: readonly AdapterContribution[];
  readonly module: ServiceModule;
};

githubContribution(options?: RemoteGitOptions): AdapterContribution;
gitlabContribution(options?: RemoteGitOptions): AdapterContribution;

class RemoteRepository {
  static open(input: {
    readonly url: string;
    readonly credentials?: GitCredentials;
    readonly options?: RemoteGitOptions;
  }): Promise<RemoteRepository>;
}
```

Other exports:

- `migrations`
- `RemoteGitOptions`
- `GitCredentials`
- `RepositorySummarySchema`
- `RemoteBindingSchema`
- `BindingCursorSchema`

Assembly:

- GitHub/GitLab contributions:
  `listRepositories, import, exportNew, pull, push, disconnect`.
- Generic contribution: `clone, fetch, push`.
- Service module: `062-x-remote-git`, lane X, order 62.
- Default module ownership: migrations and recovery only.
- Unified route owner: interchange module 65, which dispatches Git/GitHub to
  the real `ConfiguredAdapter` and encrypted `GrantStore`.
- Standalone-only fallback: `{ registerImportRoute: true }` registers
  `POST /api/imports` when interchange is intentionally absent.

The parent must create one integration per runtime, pass all three
contributions to `createAdapterModules`, and register modules in order:
shared connections 60, shared providers 61, remote Git 62, interchange 65.
The composed sequence must leave `registerImportRoute` false/default.

## Exact migration

Migration ID: `062-x-remote-git`.

SQLite:

```sql
CREATE UNIQUE INDEX remote_bindings_project_unique ON remote_bindings(project_id);
CREATE TABLE remote_git_intents (
  id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id),
  actor_id TEXT NOT NULL REFERENCES users(id), grant_id TEXT NOT NULL REFERENCES provider_grants(id),
  action TEXT NOT NULL, project_id TEXT NOT NULL, payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'prepared', created_at TEXT NOT NULL
) STRICT;
```

PostgreSQL:

```sql
CREATE UNIQUE INDEX remote_bindings_project_unique ON remote_bindings(project_id);
CREATE TABLE remote_git_intents (
  id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES operations(id),
  actor_id TEXT NOT NULL REFERENCES users(id), grant_id TEXT NOT NULL REFERENCES provider_grants(id),
  action TEXT NOT NULL, project_id TEXT NOT NULL, payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'prepared', created_at TEXT NOT NULL
);
```

Digests:

- SQLite:
  `e5100e6461282f8c0e0b933db3a2fdc342eb61581aeda03f227b83e8be632ff9`
- PostgreSQL:
  `9207d10ac088f2f689999172ae4c71b986eeef612838a8e0d7d1f96d2c123927`

No existing migration or original input was edited.

## Terminal commands and exits

| Command | Exit/result | Evidence |
| --- | --- | --- |
| `bun test tests/adapters/remote-git` | Exit 0; 10 pass, 0 fail, 37 expectations, 7 files, 15.18 s | `docs/evidence/p2x-remote-git/final-checks.md` |
| `bun test tests/adapters/interchange/remote.test.ts` | Exit 0; 2 pass, 0 fail, 5 expectations, 1 file, 4.57 s | same |
| `./node_modules/.bin/tsc -p tests/adapters/remote-git/tsconfig.production.json --noEmit --pretty false` | Pre-correction exit 0; final rerun exit 2 only for concurrent core-owned `services/core/git/routes.ts:89`; zero remote Git diagnostic | same |
| `./node_modules/.bin/oxlint --type-aware --deny-warnings services/adapters/remote-git tests/adapters/remote-git` | Exit 0, no output | same |
| `./node_modules/.bin/tsc -p tests/adapters/tsconfig.json --noEmit --pretty false` | Exit 2 only for fourteen operations-owned missing `deploy/compiler/fixtures/**` imports; zero owned diagnostic | same |
| supplied no-excuse script | Exit 2 because native Bun could not resolve installed TypeScript from the external script | same |
| equivalent scoped banned-pattern audit | Zero matches across seven rule classes | same |
| migration digest command | Exit 0, exact hashes above | same |
| owned process/temp cleanup probes | Exit 0 / empty | `docs/evidence/p2x-remote-git/cleanup.md` |

The expected negative HTTP logs contain stable codes/request IDs only:
`GRANT_UNAVAILABLE` after actual revoke and `ADAPTER_FAILED` during the injected
rollback that startup recovery completes.

## Coverage evidence

Protocol-faithful fixtures implement provider OAuth, REST and actual
`git http-backend`, rather than success-only mocks. Covered outcomes:

1. Exact unconfigured prerequisites.
2. GitHub OAuth, list, idempotent replay and import.
3. GitLab OAuth, list and import.
4. New GitHub repository creation and actual push.
5. Generic pinned clone/fetch/push.
6. Fast-forward pull.
7. Pull conflict branch preserving both sides.
8. Push conflict branch preserving both sides.
9. Stale binding/cursor rejection.
10. Binding disconnect and upstream revocation.
11. Encrypted secret and result redaction.
12. Named protected branch/tag preservation.
13. Publication rollback and restart recovery.
14. Listener/process/temp-root cleanup.
15. Default remote module leaves `importCreate` unregistered.
16. Remote recovery plus interchange assemble with one route owner and perform
    a real delegated GitHub import without duplicate registration.

## Concrete foundation contract delta

`docs/handoffs/p2x-base.md` is `NOT RELEASED`. Foundation must apply its
actor-aware `ExternalAdapter` delta:

```ts
test(grantId: Id, actorId: Id): Promise<...>;
execute(input: {
  actorId: Id;
  parameters: Readonly<Record<string, unknown>>;
  expectedVersion: number;
  action: string;
  grantId: Id;
  projectId?: Id;
  expectedCursor: string | null;
  key: string;
}): Promise<Operation>;
```

Foundation must also add the typed connection-availability route requested by
the base owner.

Remote Git additionally requires a typed X-owned non-OAuth credential
enrollment/revocation route that calls `GrantStore.create` only after verifying
the supplied credential against a selected repository URL. Required boundary:

```ts
POST /api/connections/git/credentials
{
  label: string;
  url: string;
  username: string;
  secret: string;
}
-> AdapterGrant
```

The route must use current session/CSRF authority, safe/pinned Git transport,
encrypted `GrantStore` persistence, one-time plaintext handling, and an exact
revocation/deletion contract. Until this frozen contract exists, generic
authenticated actions remain truthfully unconfigured even though their real
transport implementation passes.

No casts or suppressions were added around either missing port.

## External prerequisites

No live credential or paid/external write was supplied or used.

- GitHub: OAuth app/client registration, exact callback, `repo read:user`
  grant, and organization approval where required.
- GitLab: OAuth application registration, exact callback, `api` grant, and
  namespace/project creation authority.
- Generic Git: the foundation credential-enrollment contract above plus a
  user-authorized HTTPS Git credential and repository permission.
- Live success may be claimed only after conditional tests run with those
  credentials and explicit authorization for provider writes.

Official primary sources and consultation date are retained in
`docs/evidence/p2x-remote-git/sources.md`.

## Cleanup and architectural review

No owned process, listener, temp root, browser or container remains. Shared
ports 5173/3001 and Docker images were untouched. No workspace commit/push or
nested agent was used.

Every owned TypeScript file is at or below 250 pure LOC. `git-process.ts`
(242), `import-project.ts` (248) and `pull.ts` (211) are in the warning band;
the next substantive edit should split their named responsibility.

Architectural review:

1. Files own one short responsibility after provider/fixture/test splits.
2. Provider/HTTP/Git boundary data is parsed with Zod.
3. Tagged variants do not use non-exhaustive discrimination.
4. No `any`, assertion, suppression, non-null assertion or mutable export.
5. No defensive checks duplicate type guarantees.
6. Helpers have multiple callers or encapsulate resource lifetime.
7. Every shipped behavior has a regression that drives its real surface.
8. Functions group inputs into named typed objects.
9. No destructive operation is redundantly re-queried as proof.
10. Names are positive except intended guard/filter conditions.
11. No new logger or credential-bearing log was introduced.
