# Diagnostics and support

Use the repository-pinned Bun 1.4.4 runtime. Run `bun scripts/ops/doctor.ts` against an
operator-owned `QUIRE_DATA_DIR`. The command uses actual SQL/repository reads,
fixed tool version commands with checked exits, and the compiler's real
confined TeX/PDF probe. An installed executable or old environment row is not
current compiler availability. Required native failures produce exit 1.
Docker, Pandoc, R and configured external providers are reported separately;
missing SaaS credentials do not make native startup unhealthy. Provider
configuration is metadata, explicitly not a connectivity claim.

## Redacted diagnostic artifact

An authenticated current operator uses `POST /api/admin/diagnostics` with
same-origin CSRF authority and `Idempotency-Key`. The response is an Operation;
download its bytes at `GET /api/operations/:id/download` with the same actor.
The core download port rechecks current operator authority. A demoted operator
cannot replay creation or download an earlier artifact.

`quire-support.json` is an actual content-addressed JSON byte artifact, not a
source archive or backup. The manifest declares its exact contents and
omissions. It contains only Bun version, SQL dialect/read status, fixed tool
names/version-command exit codes, real sandbox probe status, configured API
TCP status, repository-port read status, installed/probed environment counts,
deployment profile/backend and SIEM enabled/credential-presence flags.

Redaction is an allowlist: project source, generated documents, raw database
rows, inquiry bodies, audit details, names, emails, IP addresses, host paths,
endpoint URLs, environment values, keys, tokens, encrypted credentials and
all subprocess stdout/stderr are omitted before serialization. There is no
option to include private contents silently. Review the manifest before
sharing the artifact. The stored artifact and operation persist until the
operator's normal blob/operation retention procedure removes them.

## SIEM

The current operator reads `GET /api/admin/audit/siem` and writes
`PUT /api/admin/audit/siem` using its returned ETag as `If-Match`, body
`expectedVersion`, endpoint, enabled flag and optional secret. A missing
secret preserves the existing encrypted credential; an empty secret clears
it. Enabling without a secret is rejected. HTTPS is required in production;
development HTTP is limited to loopback. Credentials, query parameters and
fragments in the endpoint URL are rejected. Endpoint selection is an explicit
operator-approved connection, not an arbitrary public/user URL fetch.

The secret is AES-256-GCM encrypted with the existing instance key and
resource-associated data. GET exposes only `secretPresent`, never the secret.
Credential rotation/disable fences stale worker claims. Dispatch also checks
that the configuration's author remains an active current operator.

The application owner calls `startSupport(context)` after module registration
and awaits `stopSupport(context)` before closing adapters. A timer reconciles
one ordered audit event at a time; `dispatchSiem(context)` is also an explicit
single-step operational seam. SQL cursor, attempts, lease deadline, retry time
and categorical failure persist in `support_siem`. No network await occurs in
a SQL transaction. Competing APIs claim under the shared account lock and a
30-second durable lease. Requests have a five-second deadline, no redirect or
hidden HTTP retry. Failures retain the cursor and back off from one second to
five minutes; a dead worker's lease expires for takeover.

The receiver gets `POST` JSON `{format:"quire-audit-v1",seq,id,at,event}`,
`Authorization: Bearer <configured secret>` and stable
`Idempotency-Key: quire-audit-<audit id>`. Target, actor, IP and untrusted audit
details are omitted. A receiver must atomically deduplicate that key and
acknowledge only after durable ingestion. Only an HTTP 2xx acknowledgement
advances the cursor. This is at-least-once transport with receiver-enforced
idempotency, not a claim that HTTP can provide exactly-once delivery.
Changing destination preserves the already-delivered cursor.

Inspect `support_siem.cursor,attempts,retry_at,last_error,lease_until` through
the operator's SQL tooling when investigating an outage. Do not expose its
encrypted credential column in tickets. An outage never records delivery.

## Support inquiry

`POST /api/support/inquiries` is the public same-origin support form with
`Idempotency-Key`. Input is length-bounded and persists privately in
`support_inquiries`. Its idempotency scope is the normalized email plus key,
HMACed under the instance key; changed payload with the same key returns 409.

The module consumes an injected `InquiryOutbox`: `recipient()` resolves the
actual configured destination, and `enqueue(tx,inquiry)` durably enqueues via
the existing outbound-mail implementation. This function is SQL-only and must
deduplicate using the inquiry's stable ID. The support lane does not implement
another SMTP sender. Inquiry persistence, mail enqueue and queued status commit
atomically. HTTP 200 means queued, never delivered or a promised response time.

If the recipient/hook is absent, HTTP 503 `SUPPORT_UNCONFIGURED` truthfully
reports local persistence and its opaque inquiry ID. No mail is created, no
recipient is invented and no SLA is stated. Retrying the same request after
configuration can enqueue the original inquiry once. Private inquiries are
excluded from diagnostic bundles and require operator-managed retention.

## Verification

`bun test tests/operations/support` drives real native storage and loopback
HTTP. The receiver is stopped/restarted on its owned port and durably dedupes
an event whose first acknowledgement fails. Tests retain original canary
inputs only inside their owned temporary roots and prove no canary reaches a
downloaded diagnostic artifact. No external mail or SIEM message is sent.
