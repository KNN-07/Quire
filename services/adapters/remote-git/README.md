# Remote Git adapters

Native target: repository-pinned Bun (see `.bun-version`) and Git 2.53 or
later. No provider SDK or new dependency is required.

## Assembly

Create one remote integration and pass its contributions to the shared adapter
factory:

```ts
const remoteGit = createRemoteGitIntegration()
const adapters = createAdapterModules({
  contributions: remoteGit.contributions,
})

const interchange = createInterchangeModule()
modules.push(
  adapters.connections,
  adapters.providers,
  remoteGit.module,
  interchange.module,
)
```

The module is order 62, after shared connection/provider modules 60/61. It
registers migration `062-x-remote-git`, recovery for prepared repository
publications and generic Git credential enrollment, but no import route by
default. Interchange order 65 is the single composed owner of
`POST /api/imports`; it dispatches Git/GitHub to the
actual `ConfiguredAdapter` contributions and encrypted `GrantStore`.
The contribution registry installs these exact actions:

- GitHub/GitLab: `listRepositories`, `import`, `exportNew`, `pull`, `push`,
  `disconnect`.
- Generic Git: `clone`, `fetch`, `push`.

For a standalone deployment that intentionally omits interchange, opt in
explicitly:

```ts
createRemoteGitIntegration({ registerImportRoute: true })
```

Never enable that fallback in an assembly that registers interchange; route
registration is exclusive.

## Operator configuration

Configure GitHub or GitLab through `PUT /api/admin/providers/:kind`.

| Field | GitHub | GitLab |
| --- | --- | --- |
| `baseUrl` | `https://github.com` or a GitHub Enterprise web origin | GitLab web origin |
| `model` | OAuth application client ID | OAuth application ID |
| `secret` | OAuth application client secret | OAuth application secret |
| OAuth scopes | `repo read:user` | `api` |
| callback | `/api/connections/github/callback` | `/api/connections/gitlab/callback` |

Register the callback against the exact `QUIRE_PUBLIC_URL` origin. GitHub.com
REST uses `https://api.github.com`; GitHub Enterprise derives `/api/v3`.
GitLab derives `/api/v4`.

GitHub grant deletion uses the OAuth application grant API. GitLab uses
`/oauth/revoke`. Provider configuration availability does not claim a live
login, repository read, creation, push, or revocation succeeded.

## Transport and synchronization

Git URLs must be credential-free HTTPS. Tests may explicitly grant one exact
literal-loopback fixture origin. Before Git starts, every DNS answer is checked
by the shared network policy; Git receives the selected address through
`http.curloptResolve`, rejects redirects and proxies, disables hooks and
terminal prompts, and reads credentials only through an ephemeral askpass
process environment. Tokens are never inserted into URLs, arguments, source
objects, archives, operation results, or error messages.

Imports fetch advertised named branches and tags, reject submodules, symlinks
and Git LFS pointer content, import canonical objects through
`RepositoryService.importPack`, and publish refs through a fenced repository
intent. The selected branch becomes the browser source through
`prepareSource`/`finalizePreparedSources`; other named refs and history remain
canonical Git objects. Quire internal `refs/quire/*` are never exported.

Bindings store the last local and remote heads plus an optimistic version.
Pull fast-forwards only when ancestry proves it safe. Divergence publishes a
local `<branch>-remote-conflict-<oid>` branch and leaves both original heads
unchanged. Push uses `--force-with-lease`; if the remote moved, Quire pushes the
local head to `quire-conflict/<branch>-<oid>` instead of replacing the remote.
Later synchronization remains blocked until the remote head is an ancestor of
the resolved local head.

Prepared source publications are recorded in `remote_git_intents` before the
canonical ref CAS. Startup re-acquires the branch fence, rechecks grant
ownership/current project authority, adopts the repository intent, and
finalizes source, binding, cursor, operation receipt and events in the supplied
transaction.

## Import ownership and action parameters

The default module registers credential enrollment independently of import.
Unified import parsing, receipts and route registration belong to interchange.
The standalone fallback is off by default. It uses the same contribution and
action code for isolated remote Git deployments and focused tests.

- `listRepositories`: `{ limit }`; use the returned adapter cursor on the next
  request.
- `import` / `clone`: `{ name, url, branch, workspaceId? }`.
- `exportNew`: `{ name, namespace?, private, branch? }`.
- `pull` / `fetch` / `push`: `{ branch?, expectedBindingVersion }`.
- `disconnect`: `{ expectedBindingVersion }`.

Every action also requires the shared grant version, idempotency key and
per-action cursor. Project actions repeat current ACL/policy checks before
preparation and in final publication.

## Generic Git credential enrollment

Configure the `git` provider and put Git on the server's PATH. The account
Connections form calls `POST /api/connections/git/credentials` with
`{label, url, username, secret}`. The route requires an authenticated session
and CSRF validation, verifies access to the repository and saves an encrypted,
actor-owned grant. `ExternalAdapter.execute` accepts the actor, action
parameters and expected grant version.

Disconnecting the saved connection removes the local credential only. Revoke
the password or token at its issuer if it should no longer work there. The
smart-HTTP fixture covers the Git transport, not third-party provider acceptance.

## Checks

```sh
bun test tests/adapters/remote-git
./node_modules/.bin/tsc -p tests/adapters/remote-git/tsconfig.production.json
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  services/adapters/remote-git tests/adapters/remote-git
```
