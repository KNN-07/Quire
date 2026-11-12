# MAIL DELIVERY

## OVERVIEW
Durable outbox dispatch and SMTP receipts; score 8, distinct delivery protocol domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Public API | `index.ts` | `MailDelivery`, `createDeliveryModule` |
| Lifecycle | `module.ts` | `DeliveryScheduler` and drain ownership |
| Outbox dispatch | `delivery.ts` | Claims, attempts and receipts |
| SMTP protocol | `smtp.ts` | `SmtpClient` |
| TLS channel | `smtp-channel.ts` | Connection boundary |
| Message encoding | `message.ts` | MIME and stable message identity |
| Provider settings | `configuration.ts` | `parseSmtpSettings` |
| Contributions | `contributions.ts` | SMTP and retained local mailbox |
| Sidecar schema | `migrations.ts` | Delivery ledger |
| Contract | `README.md` | Retry and acceptance semantics |

## CONVENTIONS
- Consume the existing durable `mail_outbox`; producers authorize and deduplicate.
- SMTP keeps local status and sets `sent_at` after successful handoff.
- Drain one bounded batch; scheduler close waits for its active drain.
- Claim rows transactionally, perform SMTP outside SQL, then publish the receipt.
- AUTH PLAIN requires certificate-verified TLS.
- Final DATA reply is the SMTP handoff receipt.
- Stable Message-ID derives from the durable outbox ID.
- Disabled or absent SMTP configuration opens no connection.

## ANTI-PATTERNS
- Do not create notification mail inside the delivery adapter.
- Do not claim exactly-once delivery across remote acceptance and local commit.
- Do not expose message content or credentials in delivery diagnostics.
- Do not infer current recipient policy from outbox fields that do not carry it.
- Protocol fixtures do not establish live third-party delivery.
