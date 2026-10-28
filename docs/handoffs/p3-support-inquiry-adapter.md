# Transactional support inquiry adapter

Status: verified, October 27, 2026.

`AdapterDeployment.supportRecipient` and environment variable
`QUIRE_SUPPORT_RECIPIENT` accept a validated email address. No default external
recipient is invented. `createApplicationAdapters().inquiries` implements the
existing support `InquiryOutbox` contract:

- `recipient()` returns the configured address or null.
- `enqueue(tx, inquiry)` inserts into the existing `mail_outbox` using the
  supplied transaction and actual runtime clock.
- `support:<inquiry.id>` provides durable deduplication.
- The existing delivery worker remains the sole sender and scheduler. Enqueue
  performs no network I/O. Without SMTP configuration, queued mail remains
  local; this is not a claim of external delivery.

Receipt `bash_179`, project-local Bun 1.4.4: five tests passed across
`tests/integration/adapters/support-inquiry.test.ts` and `schedulers.test.ts`.
They prove configuration validation, actual persisted enqueue/reopen/dedup,
caller-transaction rollback, real TLS SMTP scheduling and failure-stop cleanup.
Scoped type-aware lint and full repository TypeScript then exited 0.

The operations integrator owns passing this handle into actual support route
registration and proving its default-host HTTP behavior. That integration is
separate from this accepted adapter seam.
