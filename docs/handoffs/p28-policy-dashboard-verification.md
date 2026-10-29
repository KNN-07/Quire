# P28 policy and workspace dashboard independent verification

Status: **FINAL**, October 28, 2026.
Verifier: independent child `st_01a181ef`.

| Producer scope | Verdict | Acceptance boundary |
| --- | --- | --- |
| `p28-ai-policy.md` | **PASS** | Scoped persisted operator controls, native enforcement and mounted browser delivery; limitations below apply. |
| `p28-workspace-dashboard.md` | **PASS** | Membership-scoped workspace discovery/filtering intersecting project access, pagination and mounted dashboard behavior. |

No blocking implementation defect was found in the inspected scopes.
Neither verdict is whole-product acceptance, live vendor acceptance,
PostgreSQL execution acceptance, or a current global build claim. The P25
root build predates these changes and is not evidence for this tree.

## Prioritized findings and limitations

1. **Medium, provenance limitation, not an observed product failure:** the
   policy producer retained raw exit markers but no contemporaneous
   source-hash manifest. Current policy files are independently hashed in
   `docs/evidence/p28-policy-dashboard-verification/current-policy.sha256`;
   these identify the inspected source, not cryptographic proof of the exact
   earlier test inputs. The source and current test assertions are consistent
   with the original logs. Workspace has stronger provenance: all 11 producer
   source entries and all 39 artifact entries match current bytes. Full shared
   file hashes identify bytes, not ownership of concurrent edits.
2. **Medium, operational retention boundary:** request logging has no general
   TTL, operator purge/export UI, or retroactive deletion on logging-off.
   Metadata and Agent ciphertext remain retained. Shared Ask ciphertext is
   nulled on clear or expiry; expiry deletion is activity-driven, not an
   independently running deadline scheduler. See
   `services/adapters/ai/request-log.ts:9`,
   `services/adapters/ai/conversations.ts:100`,
   `services/adapters/ai/service.ts:41`, and
   `services/adapters/ai/README.md:218`. This matches the documented scoped
   contract; it must not be represented as time-bounded retention of all logs.
3. **Low, executed coverage boundary:** shared Ask clear erasure is directly
   asserted by the new policy test. The existing expiration test proves
   conversation/message expiry, but the new optional audit ciphertext's expiry
   branch is source-traced rather than separately executed in these receipts.
   Likewise, collaborator-private tags, operator demotion during a write and
   multi-runtime policy-change fencing are supported by source boundaries,
   not dedicated new executed cases in this delivery.
4. **Low, UI coverage boundary:** workspace cursor/bulk-selection reset,
   reload and Back are browser-executed. Closing the project-action dialog
   and clearing its transient page error on a workspace URL change are
   source-traced in `ProjectsPage.tsx:65`, not directly asserted in the
   producer browser test. Four captures per scope cover 1440/390 in light/dark,
   not every possible viewport or whole-product screen.

No item above is silently deferred as a claimed passing test. No passing
test was rerun by this verifier, and no production/test/global ledger file
was changed.

## Policy evidence and authority trace

Both producer handoffs are FINAL. Original policy receipts under
`docs/evidence/p28-ai-policy/` were read directly:

| Receipt | Observed original result |
| --- | --- |
| `native.log` | 26 pass, 0 fail, 147 expectations, `NATIVE_TEST_EXIT=0`. |
| `static-final.log` | Both scoped TypeScript exits 0; typed lint exit 0; later private-session-clear regression 1 pass, 3 expectations, `CLEAR_TEST_EXIT=0`. |
| `browser-final.log` | Actual mounted application, 1 pass, 29 expectations, `BROWSER_TEST_EXIT=0`; policy version 2, stale 409, nonoperator 403, citation 403, explicit confidential 403, one controlled dispatch. |

`static.log` still records the initial forbidden inline type import/lint
exit 1. `browser.log` still records the failed API fixture's missing data
envelope and exit 1; its root was disposed. These are not substituted for
successful receipts. Successful browser source explicitly sends same-origin
mutation headers. Its provider is a real controlled local HTTP server, not
a successful-response route mock or a live vendor.

The elected D22 source controls were checked against
`docs/discovery/design-source/22-admin-operations.source.html:114`:
prompt/response audit, citation permission and confidential-tag blocking.
The delivery deliberately narrows content logging to already durable Agent
or explicitly shared conversations to preserve private Ask. Defaults are not
copied from the design's example checkbox state.

`services/adapters/shared/provider-policy.ts:9` supplies the no-row defaults:
logging off, citation permission true, owner-tag blocking true, version 0.
`060-x-ai-operator-policy` adds its own policy table;
`069-x-ai-operator-enforcement` adds a default-zero pinned version and optional
request log. SQLite and PostgreSQL SQL variants exist. The inspected git diff
adds entries without rewriting original migration SQL. SQLite persistence and
runtime restart are executed; upgrade compatibility is supported by this
additive trace and the existing migration-digest regression, not a separate
complete old-installation upgrade run. PostgreSQL was not executed.

`provider-routes.ts:12` authenticates both policy reads/writes, denies
nonoperators, verifies mutation CSRF and enforces matching If-Match/body
versions. `provider-policy.ts:20` acquires the accounts transaction lock,
rechecks unsuspended/nondeleted operator authority, compares policy version,
persists an independent CAS resource and records policy audit plus
`policy.changed`. Connection settings have a separate resource/version.
The native test executes 401/403/CSRF/stale and header-mismatch denials,
policy durability and unchanged connection version.

`services/adapters/ai/store.ts:19` requires project access, an active session,
current terms consent, current project/user/organization/provider policy,
enabled configuration and explicit confidentiality protection.
Explicit `ai_project_security.confidential` denies regardless of tag-toggle
state. The optional tag rule joins the current project owner's tags only,
matching `lower(trim(name))='confidential'`; another collaborator's private
tag cannot classify the owner's project.

Operator citation denial occurs before context collection/reservation.
Permission is not consent: current user preference and selected retrieval
providers are still required. A user-preference denial can reserve then refund
before model dispatch; the native receipt explicitly observes that refund.
It should not be described as every citation denial happening before
reservation.

`admission.ts:34` pins connection and operator policy versions.
`execution.ts:24` rechecks before retrieval, before each retrieval provider,
in the dispatch transaction, and in the publication transaction.
`store.ts:81` rejects a changed pinned version. `service.ts:48` reacts to
policy/access/session events by aborting active runs; the persistent rechecks
also fence other runtimes before publication. The controlled gate regression
executes late-output discard with usage still charged after dispatch.
Existing reviewed-edit/undo cases remain passing in the original selection.

Logging off creates no optional record. Metadata logs tool/mode/status,
policy version and timestamps, with no ciphertext. Retained-content mode
encrypts only the explicit prompt and answer for Agent/shared conversations;
it does not directly serialize selected files, diagnostics, images,
credentials or the provider payload. Private Ask gets null ciphertext even
in retained-content mode. The native test decrypts Agent ciphertext and
checks exact prompt/answer, verifies a private prompt canary is absent from
persisted request JSON, checks shared-clear erasure and continued mandatory
usage/security audit. The later session-clear test proves the running
metadata record is atomically canceled without a late private response.
Encryption is not erasure: existing Agent content survives logging-off.

## Workspace evidence and access trace

Original receipts under `docs/evidence/p28-workspace-dashboard/`:

| Receipt | Observed original result |
| --- | --- |
| `native-final.log` / `.exit` | 11 pass, 0 fail, 94 expectations, `NATIVE_EXIT=0`. Includes eight existing dashboard regressions. |
| `browser-02.log` / `.exit` | 1 pass, 0 fail, 52 expectations, `BROWSER_EXIT=0`. |
| `types-core-final.exit`, `types-browser-02.exit`, `lint-final.exit` | Each exit 0. |

All retained artifacts, including earlier failed native/browser/type/lint
receipts, passed producer-manifest hash verification. Successful browser
source uses the real mounted `connectionApplication`, persisted memberships,
Git-backed project creation, authenticated Chromium and native responses;
no successful API-response mocking. Response and DOM subscriptions replace
fixed sleeps.

`packages/contracts/src/routes-core.ts:38` defines membership workspace
summaries and defaults project workspace to all. The new chooser does not
reuse the operator-wide organization directory.
`services/core/base/project-routes.ts:21` authenticates and marks workspace
summaries private/no-store. `project-list.ts:14` requires current membership
for a UUID before candidate/cursor evaluation, using the same 404 for unknown
and unauthorized workspaces. The actual native cases include operator
isolation, unauthenticated reads and malformed values.

`project-list.ts:20` independently restricts candidates to project owner or
project member, then intersects actor-local state, workspace, ownership,
search and private tag filters. Personal means `workspace_id IS NULL`,
including directly shared personal projects. All preserves project shares
for recipients outside the organization without granting workspace-name
discovery or UUID-filter access. Membership alone grants no hidden project.

`project-list.ts:38` invokes current project role before pagination;
`services/core/base/access.ts:24` rejects policy-revoked link memberships.
Only the filtered authorized set contributes sorting, cursor validation and
nextCursor. Native tests execute hidden/foreign cursor rejection, deterministic
pages, revoked-link exclusion before cursor counts, and 404 after membership
removal. Existing bulk tests still prove stale/duplicate/unauthorized preflight
and transaction rollback.

`apps/web/src/features/projects/ProjectsPage.tsx:65` resets cursor, selection,
action dialog and transient action error whenever the parsed URL workspace
changes. Owner/tag/search controls remain independent. Browser evidence
executes a real 50+1 team page, clearing selected rows on page/scope changes,
requests without the old cursor, reload, Back, institution isolation, editor
navigation, denied UUID with empty rows, and a nonmember's directly shared
project with no organization option. Native persistence is also checked after
runtime restart.

## Visual inspection, cleanup and provenance

All eight actual final PNGs were opened and inspected. Policy's final capture
directory is
`docs/evidence/p28-ai-policy/browser-0328dccc-66fd-4717-9d55-c11e6805cbfa/`;
workspace's is `docs/evidence/p28-workspace-dashboard/final/`.
Each includes 1440/390 light/dark. Policy controls, saved version and privacy
copy fit in both themes; the long mobile capability list requires scrolling.
Dashboard search/chooser do not overlap, personal rows remain readable, and
mobile cards/actions fit the width. No capture was replaced by an illustration
or accepted solely from geometry output.

Independent root/listener probes confirm all four original fixture roots
absent and all ten owned web/API/provider ports refusing TCP connections.
No producer job is claimed pending: policy's recorded five monitor jobs are
completed, workspace has final exit receipts. No missing live producer result
required a new watch.

Detailed image-by-image observations, receipt transcription, cleanup probes,
command limitations and hash provenance are retained in
`docs/evidence/p28-policy-dashboard-verification/inspection.md`.
Workspace's original `sources.sha256` and `artifacts.sha256` remain the
byte-identification authority for that lane; the independent current-policy
manifest identifies policy bytes reviewed here.

Only this handoff and the verifier's evidence directory were written.
No commits, passing test reruns, production/test edits, unrelated cleanup,
or global validation/ledger changes were performed.
