# Scheduled notification digests

Status: behavior and static gates verified on Bun 1.4.4.

The existing admitted mail-delivery tick now awaits
`flushNotificationDigests(runtime)` before draining the mail outbox. There is
no additional timer, sender or independent shutdown path. Existing due-time,
preference, current project-access, account-deletion and deduplication rules
remain in the governance implementation.

The first regression attempts (`bash_180`, `bash_181`) timed out during
default-host initialization, before any digest assertion. Lifecycle markers
located that boundary; real compiler registration executes the full native
toolchain hashing/probe. Initialization now has a separate bounded setup hook,
while the behavioral test retains its 30-second limit. Temporary markers were
removed. Those setup failures are not evidence of a digest failure.

With setup complete, `bash_182` reproduced the actual defect: a scheduled wake
left the due digest absent from the outbox. `bash_183` passed ten tests across
the new scheduler regression, existing real TLS SMTP lifecycle tests and
governance notification tests. Due mail persists exactly once across restart;
future mail remains deferred. Existing preference, rollback, revoked-access
and deleted-account tests pass. Scoped lint and full repository TypeScript
both exited 0.

The passing fixture awaits application/server disposal. The two earlier
pre-initialization timeouts did not return fixture root IDs; any residual
temporary roots require the final ownership audit rather than name-based
deletion. No global resource sweep was performed.
