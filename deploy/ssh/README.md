# SSH process role

Use `docs/runbooks/ssh.md` for provisioning and a disposable verification
instance. `scripts/ops/ssh.ts config` renders the complete private sshd
configuration; it does not edit the host configuration or install a service.

There are two roles on the same host: a private loopback Bun broker and a
dedicated high-port OpenSSH service. The only authenticated key source is the
broker's live database lookup. Every returned key has `restrict` and a forced
command. The broker secret file is mode 0600 and belongs to the service user.
The daemon never reads `~/.ssh/authorized_keys`, runs `~/.ssh/rc`, accepts a
password, allocates a TTY, or permits forwarding.

Only the singleton repository role mounts canonical Git in scale. The SSH
broker uses the existing runtime PostgreSQL/blob/repository ports and disposable
named-only transport repositories. It must not mount the repository volume.
Native uses the same native data directory and instance key as the API.

No certificate, host key, production user, systemd unit or host service is
silently provisioned. Operator-managed activation is outside this sandbox
implementation.
