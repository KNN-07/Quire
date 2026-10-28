# Organization AI-policy member notifications: FINAL producer

October 27, 2026. Closes the missing notification/email producer within I50b;
does not change organization policy defaults or claim live delivery.

The existing administrator-only organization policy mutation now queues
`organization.ai.changed` notifications when the AI mode actually changes.
Recipients are current, active organization members. It uses the existing
preference-aware notification/outbox helper inside the same transaction as
policy, audit and policy events. Per-event opt-out and delivery channels apply;
suspended/deleted users and nonmembers are excluded. Dedupe keys bind the
organization version and recipient. Stale writes and edits that leave the AI
mode unchanged produce no duplicate notice.

No network call occurs inside the mutation. The existing delivery scheduler
owns later email delivery. The fixed subject avoids embedding an untrusted
organization name in a mail header; the plain-text body names the organization
and old/new modes. Existing policy enforcement and cross-organization
intersection are unchanged.

The new native HTTP tests first failed on missing notifications and on a mail
failure trigger never being reached. After implementation,
`mon_D567PAPHX1G8CV6P` completed exit 0 on Bun 1.4.4:
13 cases passed, 47 assertions, 6.50 seconds. The two new cases ran with existing
governance route and audit/admin cases. They prove preference-aware recipients,
ordinary-member denial, stale/no-op deduplication, and complete rollback of
policy/version, notification receipts, mail, audit and events when enqueue fails.
The expected SQLite trigger error is retained in the passing rollback receipt.

Type-aware lint passed, and changed-file LSP diagnostics were clear. Root
TypeScript was not repeated while the driver lane was still changing; the
latest unrelated driver errors remain a separate stable-root verification gate.

Evidence: `docs/evidence/p9-ai-policy-notifications/results.txt` and
`source.sha256`. Existing await-using governance fixtures stop their HTTP
listeners, close storage and remove their owned roots. This receipt does not
claim an extra exact-root audit or an actual third-party mail transmission.

The remaining I50b default-policy/complete administration workflow boundary is
not silently waived. This is native producer acceptance, not a vendor-plan
default or every notification preference UI permutation.
