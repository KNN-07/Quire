# SSH Git bridge

The bridge exposes `ssh://<service-user>@<host>:<port>/<project-uuid>.git`.
Register an ordinary OpenSSH public key through the existing account SSH-key
API. Authentication resolves its SHA-256 fingerprint against the live account
and key records; repository read permits named Viewers/Reviewers and push
permits Editors/Owners under the same core policy as smart HTTP. Git tokens
remain smart-HTTP credentials, not alternate SSH credentials.

The bridge accepts only `git-upload-pack '<uuid>.git'` and
`git-receive-pack '<uuid>.git'` (an optional leading slash is allowed).
SFTP, scp, upload-archive, arbitrary commands, filesystem paths, forwarding,
PTYs, environment injection and user rc files are unavailable.

## Prerequisites and authority

Run Bun 1.3.14, Git and OpenSSH on Linux. Execute `bun --version`,
`git --version`, `sshd -V` and `sshd -t -f <owned-config>`; finding binaries on
PATH alone does not verify the service. `/usr/bin/env` is the root-owned
AuthorizedKeysCommand launcher; all configuration, Bun code and private files
must be controlled by the trusted deployment operator. The launcher uses a
dedicated existing OS service user. Do not attach this configuration to the
machine's normal SSH service.

The broker listens only on `127.0.0.1`. Its client JSON is:

```json
{"url":"http://127.0.0.1:33022/","token":"<64 lowercase random hex characters>"}
```

Provision this file outside the repository with mode 0600, owned by the SSH
service user. It authenticates private broker traffic, not Git users. Never
publish it or put it in a clone URL. The API, broker and repository service
must share the current deployment database and original instance key.

Native uses `QUIRE_PROFILE=local` (or the default) and the existing
`QUIRE_DATA_DIR`. Scale uses `QUIRE_PROFILE=scale`
and the PostgreSQL/Redis/authenticated S3/repository settings described in
`deploy/portable/README.md`, with a separate private broker data directory.
The SSH broker never uses an API-local canonical path. Run migrations before
starting the roles; do not generate a new instance key for the broker.
The dedicated SSH runtime registers identity/core/Git services only; it does
not start API workers, run compiler probes, or register external integrations.

## Owned high-port instance

These commands describe an operator-chosen disposable directory and existing
user, not a request to install into `/etc`, `/srv` or `~/.ssh`:

```sh
ssh-keygen -q -t ed25519 -N '' -f <owned-directory>/host
bun scripts/ops/ssh.ts config <owned-directory>/client.json \
  <owned-directory>/host 33023 <existing-user> <owned-directory>/sshd.pid
# Save the rendered output as <owned-directory>/sshd_config, then validate it.
/usr/sbin/sshd -t -f <owned-directory>/sshd_config
QUIRE_DATA_DIR=<native-data> bun scripts/ops/ssh.ts serve <owned-directory>/client.json
/usr/sbin/sshd -D -e -f <owned-directory>/sshd_config
```

Supervise the broker and dedicated sshd as distinct processes. The broker
prints `QUIRE_SSH_READY` only after binding its actual listener. OpenSSH logs
`Server listening` after its listener opens. Pin the generated host public key
in an owned `known_hosts`; never disable host verification for production.
Clients use `IdentitiesOnly=yes` and the account's registered private key.

## Publication, limits and shutdown

Each session starts with a physically separate object store containing only
finalized named ancestry. Hidden checkpoints, alternates and canonical
repository paths are never exposed. Receive-pack runs inside that quarantine.
Core validates trees and refs, checks browser dirtiness and optimistic heads,
imports objects through the repository port, acquires current branch fences
and hydrates source through the durable journal. Report-status is held until
publication completes, so a rejected canonical push cannot report success.
Current key/account/ACL authority is checked again before publication.

The broker admits at most 16 sessions. A Git process group is bounded to
120 seconds, 50 MiB input and 64 MiB combined output; WebSocket messages are
at most 1 MiB and transport backpressure is capped at 4 MiB. The forced client
has a 125-second deadline. Hooks and user/system Git configuration are disabled.
No installed compile toolchain or compiler success is implied by SSH readiness.

Stop sshd to reject new connections, then terminate the broker with SIGTERM.
Broker shutdown aborts active Git process groups and drains sessions before
closing the listener and runtime adapters. Stop and await each owned sshd child;
remove only the instance's host/client keys, JSON secret, generated
configuration, PID file, known-host file and disposable data directory.
Never remove the shared production database, blobs or canonical Git volume.

## Verification

Run `bun test tests/operations/ssh`. Its integration fixture owns high-port
listeners, temporary Ed25519 keys and `quire-p2o-ssh-*` directories and, for
the remote path, a uniquely named PostgreSQL container. It tests actual
clone/fetch/push, current role/key/ACL revocation, hidden-object denial and
arbitrary-command denial. Terminal evidence and cleanup belong in
`docs/evidence/p2o-ssh/` and `docs/handoffs/p2o-ssh.md`.

Primary references consulted: OpenBSD `sshd_config(5)` and `sshd(8)`,
Git `git-upload-pack(1)` and `git-receive-pack(1)`, and the official Bun
subprocess/WebSocket documentation. The installed Bun 1.3.14 declarations
are the final API compatibility boundary; no Bun 1.4-only API is required.
