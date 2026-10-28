# Mail delivery adapter

`createDeliveryModule()` consumes the existing durable `mail_outbox`. It does
not create notification mail itself. Producers remain responsible for ACL,
actor state, event preferences, channel preferences, digest authorization and
transactional dedupe before an outbox row commits.

The default local mailbox remains unchanged:

- existing producers may continue to write `status='local'`;
- SMTP delivery retains that status and only sets `sent_at`;
- `services/accounts/identity/mail.ts` can still retrieve retained local mail;
- an absent or disabled SMTP provider opens no SMTP connection.

## Assembly exports

```ts
import {
  createDeliveryModule,
  localMailContribution,
  smtpContribution,
} from "./services/adapters/delivery";

const adapters = createAdapterModules({
  contributions: [smtpContribution, localMailContribution],
});
const delivery = createDeliveryModule();

// Runtime modules: adapters.connections, adapters.providers, delivery.module
// Shutdown: delivery.close(), adapters.close(), runtime.close()
```

`delivery.drain()` performs one bounded batch. `delivery.schedule(intervalMs)`
starts the optional non-overlapping scheduler and returns a handle whose
`close()` waits for its active drain and releases the timer.

## SMTP provider configuration

The existing operator provider record for kind `smtp` is used. Credentials are
stored through the shared AES-GCM `SecretBox` under `QUIRE_SECRET_KEY`; reads
never return the credential document.

| Provider field | SMTP meaning                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `baseUrl`      | HTTPS-shaped endpoint used only for SMTP hostname and port, for example `https://smtp.example.org:465` |
| `model`        | `implicit` or `starttls`                                                                               |
| `secret`       | JSON document shown below; encrypted before persistence                                                |
| `enabled`      | operator delivery switch                                                                               |

```json
{
  "username": "smtp-user",
  "password": "provider-secret",
  "from": "no-reply@example.org",
  "ehloName": "quire.example.org",
  "ca": "optional PEM CA bundle"
}
```

`AUTH PLAIN` is permitted only after certificate-verified TLS. TLS certificate
verification is never disabled. The client uses CRLF framing, EHLO, multiline
reply parsing, MIME base64 text bodies, dot transparency, stable Message-ID
values derived from the durable outbox ID, and the final DATA reply as the
handoff receipt.

## Delivery state and retry policy

Migration `062-x-mail-delivery` adds a SQLite/PostgreSQL sidecar ledger without
changing foundation outbox SQL or digests. A transaction claims due rows with a
lease, external SMTP I/O runs outside SQL, and receipt publication uses the
supplied transaction executor.

- SMTP `2xx` after DATA: `sent`, receipt persisted, `mail_outbox.sent_at` set.
- SMTP `4xx` or TLS/transport failure: `retry`.
- SMTP `5xx`: `permanent`.
- Default temporary schedule: 1 minute, 5 minutes, 30 minutes, 2 hours.
- Default maximum: five attempts, then `SMTP_RETRY_EXHAUSTED`.
- Default drain batch: 20 rows; configurable up to 100.

Receipts and diagnostics omit credentials and message content. Provider reply
text is bounded and email addresses are redacted. SMTP is an at-least-once
protocol across the narrow crash window after remote acceptance and before
local receipt commit; the stable Message-ID gives cooperating providers and the
fixture a deterministic dedupe key.

## Integration contract deltas

These shared changes are deliberately not made from this lane:

1. Root composition must include `smtpContribution`,
   `localMailContribution`, `delivery.module`, and matching close calls.
2. Shared `configurationCapability()` currently marks every version-zero
   provider unconfigured. A built-in-provider exemption (or an integration-owned
   seeded `localMail` provider record) is required if the capability registry
   must report the established local mailbox as `ready` without operator setup.
3. `mail_outbox` has no actor, notification kind, project or preference-version
   columns. Delivery therefore honors the authoritative producer-time ACL and
   notification preference decision. Rechecking policy at dispatch would require
   a shared outbox contract migration carrying those typed references.

No authorized external SMTP sender/domain or credentials were supplied for this
work. Protocol-fixture success is not a claim of live third-party delivery.
