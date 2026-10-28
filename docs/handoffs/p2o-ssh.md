# P2O SSH Git bridge

Owner: `st_01a17c30`. October 27, 2026. Status: COMPLETE for the assigned
SSH transport, owned deployment instance, direct tests/configuration/docs,
terminal evidence and exact cleanup. No production deployment, system/user
installation, workspace commit or push was performed.

## Result and verified boundary

Real OpenSSH public-key authentication uses the existing account SSH keys and
SHA-256 fingerprints. Its dynamic AuthorizedKeysCommand returns only a
currently active matching key, with `restrict` and a fixed forced command.
The forced client accepts only upload-pack/receive-pack for an opaque Quire
project UUID. It does not accept shell commands, paths, upload-archive,
passwords, forwarding, PTYs or user rc files. No `~/.ssh` or system sshd file
was modified.

The broker calls the exported core `serveGitSession`; it does not duplicate
Git publication, invent an HTTP token, or access a canonical repository path.
Core supplies a physically separate named-only public/quarantine repository,
validates trees/branches and dirty/stale state, imports immutable objects
through the repository port, and publishes/hydrates through its fenced journal.
Current key/account/access authority is rechecked at durable publication and
recovery boundaries. SSH does not turn a revoked HTTP Git token into a key.
Existing token/HTTP behavior remains owned and verified by core.

Receive-pack's final status is retained until core publication completes.
The Git service receives the exact supplied quarantine path and runs with that
same working directory; neither the SSH client nor a scale API supplies a
canonical filesystem path.

Each Git process group, including Git helper descendants, has a 120-second
deadline, 50 MiB input budget and 64 MiB combined output budget. The broker
admits 16 sessions, caps WebSocket messages at 1 MiB and backpressure at 4 MiB;
the forced client has a 125-second deadline. Hooks and global/system Git
configuration are disabled. The client consumes the final exit frame before
initiating normal socket closure; shutdown aborts active groups, terminates
their sockets, drains sessions and closes runtime adapters.

The standalone SSH role assembles the existing identity/core/Git modules. It
does not start API workers, compiler probes, backup services or external
integrations. Scale construction uses the existing real scale adapter factory;
the singleton repository service remains the only canonical Git owner.

## Exports and entrypoints

`services/operations/ssh/index.ts` exports:

```ts
startSshBridge(repo: GitRepository, options: SshBridgeOptions): Promise<{
  url: string;
  close(): Promise<void>;
}>;
type GitSession = (repo: GitRepository, input: {
  readonly fingerprint: string;
  readonly projectId: Id;
  readonly service: "git-upload-pack" | "git-receive-pack";
  readonly run: (path: string) => Promise<void>;
}) => Promise<void>;
type SshBridgeOptions = {
  readonly token: string;
  readonly clientFile: string;
  readonly command: readonly string[];
  readonly session: GitSession;
  readonly port?: number;
};
createSshRuntime(config?: RuntimeConfig): Promise<Runtime>;
const sshModules: readonly ServiceModule[];
authorizedKey(path: string, fingerprint: string): Promise<string>;
forcedSession(path: string, fingerprint: string, command: string): Promise<number>;
readClient(path: string): Promise<{ url: string; token: string }>;
parseCommand(command: string): {
  service: "git-upload-pack" | "git-receive-pack";
  projectId: Id;
};
renderSshdConfig(input: SshdConfig): string;
shellQuote(value: string): string;
```

`clientSchema` and `SshdConfig` are also exported. The complete actual
compiler-resolved inventory is `docs/evidence/p2o-ssh/exports.md`.

`scripts/ops/ssh.ts` implements `serve`, `keys`, `session` and `config`.
`config` renders a complete separate loopback/high-port sshd configuration.
The broker client JSON must be owned by the service user with mode 0600.
`deploy/ssh/README.md` and `docs/runbooks/ssh.md` give native/scale authority,
provisioning, host-key pinning, process supervision, limits and exact shutdown
instructions. Native uses the runtime's `local` profile; scale uses `scale`.

No shared package, root dependency/configuration, composition file, original
input or SQLite migration definition was edited by this producer. No new
schema or migration was needed. The existing async SQL, blob, repository and
transaction ports remain authoritative.

## Commands, exits and retained evidence

All paths below are under `docs/evidence/p2o-ssh/`.

| Actual command/check | Terminal result | Evidence |
| --- | --- | --- |
| `bun test tests/operations/ssh` | Exit 0: 32 pass, 0 fail, 87 expectations, 7 files, 63.88 seconds | `ssh-accepted.log` |
| `bun x --no-install tsc --noEmit -p tests/operations/ssh/tsconfig.json` after parent composition repair | Exit 0 | `typecheck-complete.log` |
| `bun x --no-install tsc --noEmit -p tests/operations/ssh/tsconfig.production.json` | Exit 0 | `production-typecheck.log` |
| `bun x --no-install oxlint --type-aware --deny-warnings services/operations/ssh scripts/ops/ssh.ts tests/operations/ssh` | Exit 0 | `static-accepted.log`, `SSH_STATIC_EXITS ... lint=0` |
| Exact final source/configuration SHA-256 inventory | Exit 0 | `input-hashes.log` |
| Owned daemon/container/temporary-root audit | Exit 0, empty listings | `cleanup-complete.log` |
| Forced-client/Git-child/core-transport-root audit | Exit 0, empty listings | `child-cleanup-complete.log` |
| Parent exact unreachable-object cleanup and Git fsck | fsck exit 0 before/after; HEAD unchanged | `parent-cleanup.md` |

The initial test-graph strict failure was the concurrent parent
`BackupHost.signingKey` composition mismatch, not an SSH diagnostic. Its
original exit-2 output is retained in `static-accepted.log`; the unchanged
full strict command subsequently passed in `typecheck-complete.log`. No type
error, warning or test failure was suppressed.

The 32 tests drive actual clone/fetch/push, Owner and Editor source
materialization, Viewer/Reviewer read-without-push, current key deletion,
account suspension, current ACL loss, exact in-flight revoke-before-publication,
dirty-browser rejection, branch-only publication, a known real hidden-object
want, arbitrary command/path denial, actual Git cancellation and input limits.
The deployed-role test launches the actual broker CLI in a separate OS process
beside the actual high-port sshd, then awaits both clean exits.

The final parent admission wrapper was added after this transport capture.
Its actual receipt is `docs/handoffs/p2u-hmr-ssh-admission.md`: six passing
regressions, five of them SSH, include real clone/fetch/push, revocation after
CAS, failed-finalization recovery and complete-session maintenance admission.
The actual final `services/core/git/session.ts` was read: admission encloses
authorization, protocol callback, publication and temporary cleanup. The
existing callback signature is unchanged. Passed unrelated suites were not
rerun. Core's original session/HTTP verification is separately recorded in
`docs/handoffs/p2o-git-session.md`.

## Actual instances and Git artifacts

Executed versions were Bun 1.3.14, Git 2.53.0, OpenSSH 10.2p1
Ubuntu-2ubuntu3.8 and Docker client/server 29.8.2. Actual `sshd -t`,
authentication and Git traffic were exercised; availability was not inferred
from PATH.

The accepted pushed heads, each with matching 75-byte browser source, were:

| Path/actor | Actual named head |
| --- | --- |
| Native Owner | `3151c235eb66a2db399452e59d11719b1bacc175` |
| Native Editor | `6010b8aa692382f53aa58fd7e93fcd29f99c65d3` |
| Remote singleton Owner | `19990f93fd0d2d809397514b53476a42e8ad8dd1` |

The remote transport fixture used real PostgreSQL at `127.0.0.1:32963`,
container `quire-p2o-ssh-pg-1a237aa9-f7c9-4936-8403-cb4bb6a9d974`,
container ID `9a9f1dfe41b95aedc1fad88b4518cfd5bf908b96fc9d8c47d4df765a42e20040`,
and the installed PostgreSQL image
`sha256:dc17045ccfd343b49600570ea734b9c4991cf1c3f3302e67df51e3b402dd55c4`.
Its actual repository endpoint was `http://127.0.0.1:33625/`, with canonical
Git only under `/tmp/quire-p2o-ssh-vdFhFq/canonical`; the API-local Git directory
was removed before successful clone/push/fetch. sshd PID 221396 listened on
45897 and its broker on 46091.

That fixture explicitly uses native disk blobs alongside real PostgreSQL and
the real remote repository ports; it is not represented as a fresh full
Redis/S3 scale acceptance run. P1S's accepted scale topology remains the scale
prerequisite. The standalone deployed native test used broker PID 222413 at
35511 and sshd PID 222440 at 41101, with their own generated temporary keys.
All named instances and artifacts above were disposable and are now removed.

## Failure history and exact cleanup

The first actual probe exposed an adapter error: passing `.` as the Git
service's repository argument caused it to read the workspace despite
`--git-dir`. It was stopped and repaired to use the exact quarantine path plus
that same working directory. Git rejected the attempted non-bare workspace
branch update; no ref changed. It had installed exactly three unreachable
objects before rejection. The parent independently verified and removed only
those three objects, with fsck exit 0 and unchanged HEAD, as recorded in
`parent-cleanup.md`. Other unreachable objects were deliberately untouched.
`interrupted-run.md` and `ssh-initial.log` retain the original failure.

The successful Git probe initially exposed a native Bun shutdown lifecycle
stall; those timeout/interrupted transcripts remain retained. Client-initiated
closure after consuming the exit frame fixes the lifecycle, and the accepted
full suite includes clean shutdown. The separate deployed-role fixture also
retains its invalid-profile and full-API startup failures before the dedicated
SSH runtime correction. No failed run was relabeled green.

Every accepted fixture closes the broker, awaits sshd exit 0, closes runtime
adapters, removes its exact `quire-p2o-ssh-*` directory (host/client private
keys, client secret, known-host file, PID/config files, native DB/blobs and
clones), and removes core public/quarantine roots in `finally`. The remote
fixture stops and awaits PostgreSQL, then removes its exact container and
anonymous volume. The initially interrupted orphan daemon groups 2531,
43206, 54103, 66753, 83378 and 102367 were individually stopped; their exact
owned roots and the failed startup root were removed. No broad process kill,
system sshd change, global Git prune/GC or production restore was used.

Final independent audits list no SSH-owned daemon, forced client, Git child,
container, owned temporary root or core SSH transport root. The parent
cleanup dependency is resolved. Source-size and architectural review is in
`review.md`: the largest production module is 119 pure LOC and the largest
test helper is 122. Boundaries are parsed, variants exhaustive, subprocess
results checked, no type escape hatches or fixed test sleeps were added, and
no assigned SSH behavior remains deferred.
