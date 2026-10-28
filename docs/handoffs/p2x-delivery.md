# P2X configured mail delivery handoff

Owner: `st_01a17c4b`. Date: 2026-10-27. Status: implementation complete,
owned verification clean, integration required.

## Outcome

The existing durable `mail_outbox` now has a real configurable SMTP consumer.
It performs authenticated certificate-verified TLS SMTP, bounded claims,
persisted leases/attempts/retry times, final DATA receipts, restart dedupe,
temporary/permanent rejection handling, redacted diagnostics and clean optional
scheduler shutdown.

The implementation does not invent notification emails. It consumes only rows
committed by existing identity, access and governance producers, so their
transactional receipts, ACL decisions, actor state and notification/channel
preferences remain authoritative.

The established local mailbox remains the default and is not replaced:

- no SMTP configuration reports an exact `unconfigured` reason and opens no
  connection;
- an operator-disabled SMTP provider reports `disabled`;
- original `mail_outbox.status='local'` is retained after SMTP delivery;
- only `sent_at` and the delivery-owned sidecar receipt change;
- `services/accounts/identity/mail.ts` therefore continues to expose retained
  local identity mail.

No external SMTP credentials or authorized sender/domain were supplied. The
passing socket fixture is not a claim of live third-party mail delivery.

## Authored scope

Production:

```text
services/adapters/delivery/README.md
services/adapters/delivery/configuration.ts
services/adapters/delivery/contributions.ts
services/adapters/delivery/delivery.ts
services/adapters/delivery/index.ts
services/adapters/delivery/message.ts
services/adapters/delivery/migrations.ts
services/adapters/delivery/module.ts
services/adapters/delivery/smtp-channel.ts
services/adapters/delivery/smtp.ts
```

Tests:

```text
tests/adapters/delivery/delivery.test.ts
tests/adapters/delivery/harness.ts
tests/adapters/delivery/smtp-fixture.ts
tests/adapters/delivery/tls-material.ts
```

Evidence and documentation:

```text
docs/evidence/p2x-delivery/tsconfig.json
docs/evidence/p2x-delivery/terminal-evidence.md
docs/evidence/p2x-delivery/sources.md
docs/handoffs/p2x-delivery.md
```

No root manifest, shared contract, runtime, account/core producer, application
composition, unrelated listener, Docker resource, original input, existing
migration or Git history was edited.

The required input `docs/handoffs/p2x-base.md` was absent throughout this task
(`ENOENT`). The actual accepted shared adapter implementation under
`services/adapters/shared/**` and its direct tests were read instead.

## Exact exports

Runtime values from `services/adapters/delivery/index.ts`:

```text
DeliveryScheduler
MailDelivery
SmtpClient
createDeliveryModule
localMailContribution
migrations
parseSmtpSettings
smtpAvailability
smtpContribution
```

Type exports:

```ts
DeliverySummary;
MailDeliveryOptions;
SmtpAttempt;
SmtpAvailability;
SmtpSettings;
```

Integration shape:

```ts
const adapters = createAdapterModules({
  contributions: [smtpContribution, localMailContribution],
});
const delivery = createDeliveryModule();

const modules = [adapters.connections, adapters.providers, delivery.module];

// Optional:
const scheduler = delivery.schedule(intervalMs);

// Shutdown order:
await scheduler?.close();
await delivery.close();
await adapters.close();
await runtime.close();
```

`delivery.drain()` performs one bounded immediate pass. The scheduler prevents
overlapping drains, unrefs its timer and waits for active delivery before close.

## Configuration contract

The existing encrypted operator provider configuration with `kind='smtp'` is
used.

| Field     | Required value                                                                   |
| --------- | -------------------------------------------------------------------------------- |
| `baseUrl` | HTTPS-shaped SMTP host/port metadata, for example `https://smtp.example.org:465` |
| `model`   | `implicit` or `starttls`                                                         |
| `secret`  | encrypted JSON document below                                                    |
| `enabled` | operator on/off switch                                                           |

Credential document before shared AES-GCM encryption:

```json
{
  "username": "smtp-user",
  "password": "provider-secret",
  "from": "no-reply@example.org",
  "ehloName": "quire.example.org",
  "ca": "optional PEM CA bundle"
}
```

The credential is encrypted by the current `SecretBox` under
`QUIRE_SECRET_KEY` with resource binding `provider:smtp`. TLS verification is
never disabled. AUTH PLAIN is sent only inside verified TLS.

Exact absent-provider state:

```text
Missing: operator SMTP provider configuration; SMTP host URL; TLS mode model (starttls or implicit); encrypted SMTP username/password/from identity
```

Exact disabled-provider state:

```text
SMTP provider disabled by operator
```

## SMTP protocol behavior

The client implements:

- implicit TLS and STARTTLS modes;
- TLS 1.2 minimum, certificate and hostname/IP verification, optional custom CA;
- `EHLO`, multiline replies and post-STARTTLS `EHLO`;
- `AUTH PLAIN` capability enforcement over TLS;
- `MAIL FROM`, `RCPT TO`, `DATA` and final acceptance reply;
- strict CRLF framing and dot transparency;
- ASCII-safe MIME headers and base64 UTF-8 text body;
- stable `Message-ID: <outbox-id@ehlo-name>`;
- bounded response/message sizes and operation timeout;
- `4xx` temporary versus `5xx` permanent classification.

Provider reply details are capped at 240 characters and email addresses are
redacted. Credentials and body content are never written into delivery
diagnostics or operation results.

SMTP cannot guarantee exactly-once delivery across the narrow crash window
after remote `250` acceptance and before local receipt commit. Quire therefore
uses at-least-once transport semantics, a stable Message-ID for provider-side
dedupe, and a durable local receipt to prevent ordinary restart resends.

## Migration

One additive delivery-owned migration:

```text
062-x-mail-delivery
```

It adds `adapter_mail_deliveries`, keyed by the existing outbox ID, with:

```text
provider
state: pending | sending | retry | sent | permanent
attempts
next_attempt_at
lease_id
lease_expires_at
provider_receipt
last_code
last_detail
delivered_at
updated_at
```

It has explicit SQLite and PostgreSQL SQL:

```text
SQLite SHA-256: abd0e2726adf48e728ba700d9c6976103932b5d1d4c1e1cdd34d43fd8376b2d4
PostgreSQL SHA-256: cb371f9417505f0dc44d5649b6a73171151595bbb0ef27f265ee1532175147f8
```

No original SQLite/PostgreSQL migration text or digest changed.

Claim and publication boundaries:

1. supplied `UnitOfWork` transaction locks `adapter:mail-delivery`;
2. due rows are sidecar-inserted without changing original content;
3. a bounded batch receives leases and incremented attempts;
4. SMTP I/O occurs outside SQL;
5. the supplied transaction executor fences the lease and publishes receipt,
   retry or permanent state;
6. successful publication sets `mail_outbox.sent_at` without changing local
   mailbox status.

Default policy:

```text
batch size: 20 (maximum configurable value 100)
lease: 60 seconds
attempts: 5
retry delays: 1 minute, 5 minutes, 30 minutes, 2 hours
exhausted code: SMTP_RETRY_EXHAUSTED
```

## Deterministic fixture

`SmtpFixture` is a real loopback TLS SMTP server with a fixture-only certificate
and key. It:

- requires the expected AUTH PLAIN credential over TLS;
- parses envelope and DATA commands;
- stores full accepted MIME content;
- dedupes by Message-ID;
- returns actual `450` temporary and `550` permanent replies;
- permits a deliberately untrusted CA path for TLS failure;
- exposes an event promise registered before delivery, with a bounded timeout;
- tracks and destroys every accepted socket before server close.

It sends no message to a person or external account.

## Final commands and exits

Native runtime:

```sh
bun --version
```

Exit `0`: `1.3.14`.

Focused behavior:

```sh
bun test tests/adapters/delivery
```

Exit `0`:

```text
5 pass
0 fail
21 expect() calls
Ran 5 tests across 1 file. [1.62s]
```

Owned strict TypeScript:

```sh
./node_modules/.bin/tsc --noEmit \
  -p docs/evidence/p2x-delivery/tsconfig.json
```

Exit `0`, no output.

Owned type-aware lint:

```sh
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  services/adapters/delivery tests/adapters/delivery
```

Exit `0`, no output.

Owned formatting:

```sh
./node_modules/.bin/oxfmt --check \
  services/adapters/delivery tests/adapters/delivery
```

Exit `0`: all 14 matched files correctly formatted.

Final LSP:

```text
services/adapters/delivery: 9 files, 0 diagnostics
tests/adapters/delivery: 4 files, 0 diagnostics
```

The programming-skill no-excuse script could not run against the repository's
TypeScript 5.9.3 because the script imports TypeScript 7
`typescript/unstable/*` APIs. It exited `2`. The owned TypeScript and
type-aware oxlint gates above passed without suppressions.

Repository-wide `bun run typecheck` exited `2` only on concurrent out-of-scope
publisher, remote-Git and UI files. Repository-wide `bun run lint` exited `1`
only on concurrent out-of-scope generated UI evidence, operations and UI tests.
Neither output named an owned delivery file.

## Cleanup evidence

After the final passing run:

```sh
find /tmp -maxdepth 1 -type d -name 'quire-p2x-delivery-*' -print
find /tmp -maxdepth 1 -type d -name 'quire-smtp-cert-*' -print
pgrep -af 'bun test tests/adapters/delivery'
```

Both `find` commands exited `0` with no output. `pgrep` exited `1` with no
match. No owned process, listener, container, scheduler, socket, fixture root
or certificate root remains.

Detailed evidence is retained at:

```text
docs/evidence/p2x-delivery/terminal-evidence.md
docs/evidence/p2x-delivery/sources.md
docs/evidence/p2x-delivery/tsconfig.json
```

## Official sources

Consulted 2026-10-27:

- RFC 5321, SMTP;
- RFC 3207, STARTTLS;
- RFC 4954, SMTP AUTH;
- official Node.js v22 `node:tls` API;
- official Node.js v22 `node:net` API.

Exact URLs and applied requirements are retained in
`docs/evidence/p2x-delivery/sources.md`.

## Concrete contract delta for the parent

No shared-file edit was made. Integration must resolve these exact boundaries:

1. **Composition:** include `smtpContribution`, `localMailContribution`,
   `delivery.module` and close calls in root assembly.
2. **Built-in local capability:** shared `configurationCapability()` currently
   marks every version-zero provider `unconfigured`. To show the existing local
   mailbox as `ready` without operator setup, foundation/integration must either
   exempt built-in providers or seed an integration-owned `localMail` provider
   record. The local mailbox itself already works and was not replaced.
3. **Dispatch-time policy recheck:** foundation `mail_outbox` has no actor ID,
   notification kind, project ID or preference-version reference. This
   implementation correctly honors the current producer-time ACL/preferences
   decision by consuming only committed outbox rows. If policy must be rechecked
   immediately before SMTP dispatch, shared contracts need typed outbox
   references and an additive foundation migration.
4. **Missing requested input:** `docs/handoffs/p2x-base.md` must be supplied or
   recreated by its owner if parent acceptance requires comparing this handoff
   against that document rather than the actual shared code.

## External prerequisite

Live external delivery remains blocked only by matrix prerequisite `X-MAIL`:

```text
authorized SMTP sender/domain
reachable SMTP submission host and port
TLS mode and trusted certificate chain/CA
authorized username/password
operator provider configuration
```

No paid/live write should be attempted until the current user authorizes the
specific external account and supplies those artifacts.

## Architectural self-review

1. Single responsibility: each file owns one noun phrase; the two files that
   crossed 250 LOC were split into queue delivery versus module scheduling and
   SMTP session versus channel protocol.
2. Boundary purity: provider rows, encrypted credential JSON, outbox rows and
   SMTP replies are parsed at their boundaries.
3. Variant discrimination: delivery outcomes use discriminated unions; no
   tagged variant is silently swallowed.
4. Escape hatches: no `any`, assertion cast, non-null assertion, ignore comment
   or suppression was added.
5. Defensive layers: checks correspond to external SQL, TLS, SMTP or
   configuration boundaries.
6. One-off helpers: helpers live only where they isolate protocol/state
   responsibility; no speculative service abstraction was added.
7. Tests: reverting TLS, retry, receipt, restart, disabled state or cleanup
   behavior makes direct tests fail.
8. Parameter bloat: no authored function exceeds three independent parameters.
9. Redundant verification: no setter/delete/write is immediately queried merely
   to prove its own contract.
10. Negative naming: state names are positive (`ready`, `sent`, `permanent`);
    negation appears only in guards.
11. Logging: no logger or credential-bearing log was introduced.
