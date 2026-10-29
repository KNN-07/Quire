# P28 AI operator policy

Status: FINAL, October 28, 2026. Scoped native and mounted-browser acceptance;
not live vendor or PostgreSQL execution acceptance.

Scope: D22 AI provider request logging, citation-search policy and
confidential-document behavior; preserve I50 consent, quota, cancellation,
review and privacy boundaries. No live vendor inference claim.

## Semantics and source

Read `docs/feature-matrix.md` I50a/I50b and D22 AI provider remainder,
`docs/discovery/design-source/22-admin-operations.source.html:113-116`,
and original extracted `research/waves/integrations/expand-50.md`
(`/tmp/tmp.0KkWOTN9jO/research`, preserved `research.zip`).

The source control says to log prompts/responses, allow citation web search,
and block confidential-tagged projects. Existing account `PolicySchema` does
not contain these fields. This implementation introduces a separate
provider-specific policy and independent CAS resource instead of inflating
every account or changing shared provider connection persistence.

Request logging offers off, metadata, or encrypted retained prompts/responses.
Private Ask is never converted into durable content by an operator toggle.
Content logging is limited to Agent and explicitly shared conversations;
shared Ask clear/expiry also erases its optional audit ciphertext. No selected
file, image, diagnostic, credential or full provider payload is copied to the
optional request log. Mandatory usage/security/review records remain.

Citation permission intersects with current terms consent, user preference
and selected providers. Turning it off rejects before reservation/retrieval.
The default preserves the existing consent-gated retrieval permission on
upgrade, rather than silently disabling already-configured users.

Confidential tags are the current project owner's normalized `confidential`
dashboard tag. Collaborators' private tags do not classify others' projects.
The independent owner-controlled project confidentiality flag always denies
AI, regardless of the operator tag toggle. There is no global override.

## Implementation

`GET/PUT /api/admin/providers/ai/policy`, operator authentication/CSRF,
transactional role recheck, independent If-Match/version CAS, audited writes,
and `policy.changed` cancellation events. New additive SQLite/PostgreSQL
migrations preserve original migration SQL. A run pins both connection and
operator-policy versions and rechecks before retrieval, model dispatch and
publication. Late output is discarded; dispatched usage is not refunded.

Connection settings and policy are separate forms with explicit labels.
There is no need to edit out-of-scope `shared/configuration.ts` or
`shared/contracts.ts`; the earlier proposed seam extension was avoided.

## Evidence

All commands used project-local Bun 1.4.4 (`38afee6c8`) from the repository
root. Logs are under `docs/evidence/p28-ai-policy/`.

| Receipt | Observed result |
| --- | --- |
| `native.log` | 26 passed, 0 failed, 147 assertions, exit 0. New policy cases plus directly affected governance, persistence, conversations, reviewed edits and tools. |
| `static-final.log` | Both scoped strict TypeScript projects exit 0; typed lint exit 0. The subsequently added session-clear audit regression passes once, 1 test/3 assertions, exit 0. |
| `browser-final.log` | Actual mounted application: 1 passed, 0 failed, 29 assertions, exit 0. UI connection save, policy save/reload, 409 stale write, 403 nonoperator, actual citation-policy and explicit-confidential denials, real controlled inference and metadata log. |
| `browser-0328dccc-66fd-4717-9d55-c11e6805cbfa/` | Four inspected screenshots: 1440/light, 1440/dark, 390/light, 390/dark. Actual policy version 2, metadata logging, citation search disabled and tag rule disabled; explicit confidentiality still returned 403. |
| `inspection-and-cleanup.md` | Visual observations, completed monitor statuses, exact removed roots and refused listeners. |

Native command:

```sh
node_modules/.bin/bun test tests/adapters/ai/operator-policy \
  tests/adapters/ai/governance.test.ts tests/adapters/ai/persistence.test.ts \
  tests/adapters/ai/conversations.test.ts tests/adapters/ai/review.test.ts \
  tests/adapters/ai/tools.test.ts
```

The session-clear request-log status branch was added after that selection;
its new test ran separately without replaying the passing suite:

```sh
node_modules/.bin/bun test tests/adapters/ai/operator-policy/clear.test.ts
node_modules/.bin/bun test tests/ui-product/admin/ai-policy/browser.test.ts
node_modules/.bin/tsc -p tests/adapters/ai/operator-policy/tsconfig.json
node_modules/.bin/tsc -p tests/ui-product/admin/ai-policy/tsconfig.json
node_modules/.bin/oxlint --type-aware --deny-warnings \
  services/adapters/ai services/adapters/shared/provider-policy.ts \
  services/adapters/shared/provider-routes.ts services/adapters/shared/migrations.ts \
  packages/contracts/src/work.ts packages/contracts/src/routes-operations.ts \
  apps/web/src/features/admin/Provider.tsx \
  tests/adapters/ai/operator-policy tests/ui-product/admin/ai-policy
```

The original `static.log` retains the corrected type-import lint failure.
The original `browser.log` retains the failed browser fixture: browser
APIRequestContext mutations omitted Origin and the project result could not
be parsed. Explicit same-origin headers corrected that fixture; this was not
a product authorization bypass. Failed-run cleanup also completed. No failed
artifact was relabeled or overwritten.

Assertions cover durable policy after runtime restart, unauthenticated and
nonoperator denial, CSRF, independent If-Match/CAS, audit secrecy, all three
logging settings, encrypted retained content, private Ask canaries, shared
clear erasure, owner-tag normalization, unconditional explicit confidentiality,
user citation/terms consent, controlled Crossref provenance and policy-change
late-output discard with dispatched usage still charged. Existing reviewed
edit/undo tests pass without bypassing review.

No required result remains pending. All five monitor jobs are finished; final
native/browser/static jobs exited 0, with initial failures retained as above.
Browser/API/provider listeners from both browser attempts refuse connection
and their exact temporary roots are absent. Native fixtures use awaited
disposal of their runtime, provider and temporary roots.

## Boundaries and integration notes

This closes the elected D22 controls, not all I50 group/default-policy or
upgrade/reset acceptance. The controlled local OpenAI/Crossref-shaped HTTP
fixtures are not live vendor success. SQLite persistence/restart is executed;
the explicit PostgreSQL migration variants are supplied but were not run
against PostgreSQL in this lane.

The operator audit log is stored in `ai_request_logs`; this scope does not
add an operator content-log browser/export. The provider's existing
capability list reports connection configuration, not an individual request's
effective consent/policy eligibility.

Only ProviderConfig and provider route entries changed in shared contracts;
global PolicySchema and Environment were untouched. No changes were made to
`shared/configuration.ts` or `shared/contracts.ts`. Concurrent diagnostic
changes in `services/adapters/ai/context.ts` belong to another lane and are
not part of this delivery. No commits or original research/design input edits.
