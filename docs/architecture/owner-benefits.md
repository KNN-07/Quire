# Project-owner benefits and writable-capacity transitions

Decision date: October 27, 2026. Status: recommended implementation, not implemented or accepted product behavior. This document closes the design decision only. No implementation, suite run, or live provider request accompanied it.

## Decision

Introduce an explicit four-field **benefit grant**, separate from existing `Policy` restrictions. Resolve grants from the current project owner on every authorization. Keep `PolicyPort.forProject(actorId, projectId): Promise<Policy>` as the consumer contract; do not invent `policy.evaluate` or reinterpret existing user policy rows as subscriptions.

Add one benefit-set table and one nullable project column containing the owner's selected writable membership IDs. Project roles remain assigned roles. Authorization computes an effective role, treating unselected or over-capacity Editors/Reviewers as Viewers. No role deletion, source rewrite, review deletion, or history purge accompanies a downgrade.

Reject the smaller-looking alternative of replacing `actorId` with `ownerId` in the policy query: it would bypass actor/federation restrictions, change AI consent and allowances, and still leave existing collaborators writable.

## Requirements and current evidence

Original capability IDs in `docs/discovery/services.md`:

- **C32a/C32b, C34a, C35:** Editors and Reviewers consume owner-controlled capacity; owner and Viewers do not. Owner tracking eligibility enables collaborators' proposals. Downgrade preserves existing proposals.
- **C37/C38:** accessible history is distinct from retained storage; labeled versions remain accessible outside the ordinary window.
- **C39a, C40a/C40b, A51a:** ownership, subscription and offboarding changes affect existing projects; project benefits differ from personal benefits and restrictions.
- **A51b:** file/upload/editable-material limits are independent technical controls.
- **C33a/C33b:** named membership and links remain distinct. The matrix elects counting admitted link Editors and no Reviewer links.
- **I43, I44a/I44b, I45a, I50a/I50b:** personal connector ownership and AI accounting are not transferable project benefits.
- **A52a/A52b, A53b, A55a/A55b/A55d:** licensing differs from administration; eligibility loss, accepted management and privileged reassignment are separate.

`docs/discovery/core.md` supplies **P03/P04**, its commercial-policy table (compile budget, writable collaborators, history, AI), and **A17-A20** reference workflows. These are requirements/source interpretations, not Quire acceptance. No vendor numerical plan parity is elected here.

Source inspected for this decision:

| Existing mechanism | Actual evidence and remaining gap |
| --- | --- |
| Policy | `services/accounts/identity/policy.ts`, `packages/runtime/src/services.ts`: `forProject` checks the active actor and live project, intersects project/global, actor `user`/`federation-user`, actor organizations and workspace organization policies, then applies actor AI consent. It does not select `owner_id` or billing benefits. `defaultPolicy` is 180 seconds, unlimited members/history, tracking on. |
| Restriction integrity | `tests/accounts/identity/federation-policy.test.ts` requires separate user and federation rows: 150 seconds intersected with 45 gives 45; removing federation restores 150 without changing the user row. `services/adapters/federation/provisioning.ts` explicitly avoids taking over manual licensing. |
| Capacity/access | `services/core/base/access.ts`: `checkCapacity` counts Editor and Reviewer rows and excludes the target's current seat. `role` returns the assigned role; existing over-capacity members therefore remain writable. `effective-access.ts` independently counts only Editors for link `join`: that DTO calculation must use the new shared calculation too. |
| Corrections already landed | `docs/handoffs/p3-core-capability-corrections.md`, `tests/core/base/capability-authority.test.ts`, `tests/core/review/labeled-window.test.ts`: Reviewer-seat counting, same-seat role conversion, owner-only rename, and label-aware history access are implemented with recorded scoped receipts. They do **not** implement owner projection or effective downgrades. |
| Billing | `governance/billing.ts`: trusted `recordBillingTransition` locks accounts, checks version and `SEATS_IN_USE`, persists state/audit. `governance/members.ts` independently assigns `licensed` seats. `adapters/billing/contracts.ts` configures price IDs/names, not benefits. `reconcile.ts` maps authoritative subscription state to billing state but emits `policy.changed` using a billing-account ID. |
| Provider admission | `adapters/billing/webhooks.ts` verifies signatures, serializes provider reconciliation, re-fetches authoritative state, checks configuration generation, and commits state with webhook receipt. `tests/adapters/billing/flows.test.ts` preserves duplicate/reordered-event behavior and scheduled cancellation remaining active. Checkout alone does not activate a plan. |
| Ownership/lifecycle | `core/base/project-routes.ts:projectTransfer` removes the recipient's membership, makes the former owner Editor, and changes owner/version under the account lock. Its transaction does not repeat all target/sharing preflight checks. `governance/managed.ts:transferProjects` has distinct active verified target checks and project-scoped access events. Release currently retains organization membership/licensing; delete and lifecycle terminal advance reassign before disabling accounts/grants. |
| Fanout | `governance/shared.ts:publishPolicyChange` already enumerates live workspace, owner and collaborator projects, recording project IDs. `core/review/events.ts` can deliver those events to authorized project readers. `realtime.ts` refreshes every socket on policy events but refresh only rechecks reading; each update separately authorizes writing. Billing-account-only events cannot notify the relevant SSE project subscribers. |
| Consumers/fences | `core/review/mutations.ts` rechecks suggestion policy inside the account/branch-fenced transaction. `history-store.ts` centralizes label-aware access. `base/source-records.ts:validateSource` rechecks authorization and branch/project versions during publication. `compiler/service.ts` stores limits before its compiler-only insertion transaction; `compiler/diff.ts` separately inserts historical compile jobs with `defaultLimits`. Both compiler paths need current benefit admission. |
| Personal services | `adapters/shared/grants.ts` requires active actor and matching grant owner. Dropbox `policy.ts` has independent project/organization deny checks; references `bibliography.ts` and `link-source.ts` retain current-owner/credential checks. `adapters/ai/admission.ts` charges `ai_usage.user_id=actor.id`; `ai/store.ts` applies actor consent and intersected provider policy. There is no inspected general personal-premium connector entitlement to claim complete. |

Paths abbreviated in this table under `governance/`, `adapters/`, and `core/` mean `services/accounts/governance/`, `services/adapters/`, and `services/core/`. `docs/feature-matrix.md` still explicitly marks C32b/C35/C39a/C40a-b/A51a partial.

## Benefit representation and admission

Add `ProjectBenefitsSchema`/`ProjectBenefits` in `packages/contracts/src/accounts.ts`: exactly `compileSeconds`, `writableMembers`, `historyDays`, `trackChanges`, reusing their current `PolicySchema` validators. Null means unlimited for the two nullable numeric fields. No AI, sharing, connectors, upload limits, or plan names belong in this type.

Add `account_project_benefits`:

```text
scope_kind: deployment | user | plan
scope_id: text
benefits_json: text nullable
version: nonnegative integer
updated_at: instant
PRIMARY KEY(scope_kind, scope_id)
```

Keys are `deployment/local`, `user/<user UUID>`, and `plan/<provider>:<planId>` where provider is the existing `manual|configured` enum. Nullable JSON is a withdrawn contribution, not unlimited benefits; retain its counter to prevent stale resurrection. The deployment row is mandatory and cannot be withdrawn.

Add operator-only `adminProjectBenefitsGet` and `adminProjectBenefitsPut`:

```text
GET /api/admin/project-benefits/:kind/:key
PUT /api/admin/project-benefits/:kind/:key
body: { benefits: ProjectBenefits | null, expectedVersion: number }
output: { benefits: ProjectBenefits | null, version: number }
```

Absent optional sets read as `{benefits:null, version:0}`; the first PUT uses version 0 and writes version 1. Validate key shape and referenced user at admission. Use governance `route`, `operator`, `fresh`, CSRF, account lock, optimistic version, audit and committed project-event fanout. Organization admins cannot grant themselves benefits.

The operator explicitly maps a real configured price ID, or a deliberate manual plan ID, to benefits. Do not derive benefits from price, display name, subscription amount or the word "Pro". Keep merchant secrets/catalog formats unchanged. An unmapped active plan contributes nothing beyond independently configured grants; it is not an invented paid tier. The administrative GET makes this visible.

For owner `o`, resolve:

1. Deployment baseline.
2. Optional explicit user grant for `o`.
3. Each mapped plan for which `billing_accounts.status='active'`, `organization_id` matches an existing `members` row for `o`, and that row has `licensed=1`.

Combine contributions componentwise by maximum/OR; null is infinity. Multiple sponsorships cannot revoke one another. A grant cannot deny: a restriction must use policy. Unlicensed managers/admins, self-enrolled `licensed=0` institution members, invitations, unbilled accounts and unmapped plans do not confer a commercial grant. Existing organization billing routes remain the only provider-backed admission; the nullable personal `billing_accounts.user_id` column does not establish an implemented personal checkout contract. Explicit user grants are operator configuration, not claims of payment.

`active` is authoritative committed billing state. `past_due`/`canceled` remove that plan contribution immediately; `active` with `renewsAt=null` retains it, including scheduled cancellation. Preserve current seat-reduction rejection and receipt rollback, rather than silently choosing which licensed organization members to evict.

Migration baseline is the existing local configuration `(180, null, null, true)`, not hosted Free. To deploy finite plans, the operator explicitly changes that baseline and maps plans. Existing restrictive organization values still cap grants; an old 180-second organization ceiling must be deliberately raised before a 240-second grant can be realized.

## Policy invariants

Let `B(o)` be resolved benefits. Let `E(a,p)` be the exact explicit policy rows selected today for actor `a` and project `p`, including organization records. For the four benefit fields:

```text
forProject(a,p)[benefitFields] = meet(B(currentOwner(p)), E(a,p)[benefitFields])
```

Meet is minimum/AND, with null as infinity. With no explicit rows, use `B`, not an extra 180-second restriction. For every other field retain today's intersection/default behavior and actor AI consent. Existing `policy_sets` and organization JSON remain restrictions byte-for-byte: a user ceiling of 10 seconds or tracking false continues to constrain that actor even when the owner has a stronger grant.

The collaborator's **benefit grant** is excluded, not their restrictions. Conversely, the owner's personal restriction rows are not transplanted onto other actors. Actor organization and workspace restrictions continue to apply exactly where they apply today. A premium collaborator cannot upgrade a basic-owned project. An owner cannot grant access merely by having benefits; role, active-actor, sharing, maintenance and branch checks still run first.

Use a SQL-context-bound resolver in new `services/accounts/identity/project-benefits.ts`; no cache, copied project entitlement, asynchronous materialization, or provider call during authorization. It also exposes the project-wide benefit ceiling: `B(owner)` intersected with explicit project/global/workspace restrictions only. This is the shared capacity boundary. Actor-specific restrictions are then applied independently. Do not call `forProject(owner,p)` as a substitute: it confuses owner restrictions/consent with a common project grant and unnecessarily requires an owner login-capable account for collaborators' reads.

Changing only these four fields must leave actor AI allowance/consent, Dropbox restrictions, grant ownership, reference-owner refresh, and all technical file limits unchanged. This design neither adds nor certifies personal premium connector eligibility.

## Existing-member transitions

Add nullable `projects.writable_member_ids_json`, containing distinct **project_members.id** values, not user IDs. Null means automatic selection; `[]` means explicitly nobody. Membership IDs avoid restoring a deleted/recreated membership through a stale selection.

Put the shared capacity/selection resolver in the accounts benefit module (it only reads foundation tables). For each fresh authorization:

1. Let `M` contain current assigned Editor/Reviewer membership IDs, excluding owner; admitted link Editors count. Viewer rows and pending invitations do not.
2. Candidate set `S` is `M` for null selection, otherwise stored IDs intersected with `M`.
3. Let `C` be the project-wide capacity above. If `C` is finite and `|S| > C`, no non-owner candidate is effective and `selectionRequired=true`. Do not choose winners by UUID, last activity, or database order.
4. Otherwise selected members retain their assigned roles; unselected writable members become effective Viewers.
5. For actor `a`, an additional finite actor-specific `forProject(a,p).writableMembers` below `|S|` makes only that actor an effective Viewer. It cannot evict other actors' selected memberships. Owner remains Owner and consumes no seat; their actor restrictions still constrain benefit-consuming actions and admission decisions.

This makes lowering a live limit fail closed without a background rewrite. Increasing it immediately restores automatic selection when it fits. Explicit owner selections persist across plan changes; an oversized selection remains suspended until it fits again or the owner replaces it. No destructive role demotions occur.

Add owner-only `accessWritableMembersPut`:

```text
PUT /api/projects/:p/writable-members
body: { memberIds: Id[] | null, expectedVersion: number }
output: existing OkSchema
```

Under `quire:accounts`, recheck active owner, editor-open state, project version, current sharing authorization and current capacity; reject duplicates, unknown IDs, Viewer IDs, owner IDs and oversized selections. Null is accepted only when all assigned writable members fit. Increment project version and record `access.changed`; selection does not increment assigned member-role versions.

Keep `AccessStore.role` as assigned-role lookup for owner/member identity decisions. Add one effective-role/capacity calculation used by `authorize`, `checkCapacity` and `effectiveAccess`, never three independent counts. Excess members retain reads/downloads/copies and ordinary Viewer behavior, including currently allowed named-Viewer chat, but cannot mutate source/files/settings, compile, comment, propose, decide or restore. Selected Reviewers can comment when tracking is off but cannot create new suggestions. Existing suggestions stay readable and decidable by effective Editor/Owner even when tracking is off.

Admission rules:

- A new writable admission consumes one selected seat. In automatic mode count all assigned writable members; in explicit mode append the admitted membership ID atomically with membership creation/promotion. Invitations reserve nothing; acceptance rechecks capacity.
- When `selectionRequired`, reject new admissions until the owner resolves selection. A link join cannot choose itself as the sole survivor.
- Editor-to-Reviewer or Reviewer-to-Editor changes of an existing writable assignment consume no new seat and preserve its selected/unselected state, including while over capacity. Use the selection route to reactivate a dormant member. Existing-target exclusion remains.
- Re-read current owner inside invitation acceptance/link admission transactions, rather than using the outer `project.ownerId`; an intervening transfer must not admit against former-owner policy.

Extend `projectAccess`/`projectJoin` outputs with `effectiveRole`, `benefits` (the actor's four effective fields), and `capacityLimited`; retain `role` as assigned role and derive capabilities from effective role. Extend owner-only `accessGet` members with nullable `memberId`, `effectiveRole`, `capacityLimited`, plus a top-level `writableSelection` containing stored IDs/null, capacity, effective count and `selectionRequired`. Do not expose the full membership list through `projectAccess`.

## Ownership, lifecycle, events and fencing

Every ordinary or privileged ownership change reads the recipient's benefits after changing `owner_id`. Reset selection to `[]` for a finite new project capacity, or null for unlimited. Thus finite-capacity transfers require the new owner to select collaborators, including the former owner if desired; no previous owner's grant or selection persists. Ordinary transfer retains the existing former-owner Editor assignment, not guaranteed effective editing.

Repeat recipient activity, distinctness, current collaborator and sharing checks inside ordinary transfer's transaction. A currently managed owner must use the authorized managed/admin transfer path, not ordinary self-transfer (`MANAGED_TRANSFER_REQUIRED`). Keep privileged `transferProjects`' distinct active verified recipient checks, admin authorization, last-admin/operator protections and managed reassignment-before-deletion ordering. Record project-scoped policy/access changes and enqueue both owners' transfer notifications transactionally through existing governance notification infrastructure.

Managed release clears `members.licensed` for the releasing organization and increments that member's version in the same transaction. It preserves membership/role, account recovery checks, ownership and content. The released organization's seat no longer grants benefits; independently held user grants or other licensed sponsorships survive. Removal-to-baseline is not unconditional cancellation of a personal benefit. Deletion/terminal advance resolve recipient benefits, revoke sessions/grants and remove memberships as today. Lapse/recover do not become new billing transitions; their existing account lifecycle remains separate.

In `recordBillingTransition`, record affected **project** policy events using `publishPolicyChange({organizationId,...})`; remove the billing-account-ID surrogate event from adapter `publishSubscription`. In `applyBillingTransition`, dispatch after commit as the verified webhook route already does. Member changes already call user fanout; release must also do so. Benefit PUT fans out by user, matching plan organizations, or all projects for deployment changes. Federation provisioning must add user-to-project fanout after its membership/ceiling mutation. Include external projects owned by beneficiaries, not just organization workspaces. Derivation remains authoritative even before an event is delivered.

Reuse persisted `policy.changed`/`access.changed`, with `aggregateId=payload.resourceId=projectId`. Event sequence, not unrelated account version, is the invalidation cursor. SSE already performs authorized project delivery. Editor consumers must refetch `projectAccess` on these events and stop mutation controls when capabilities change. Existing WebSocket update admission is the enforcement boundary even if UI invalidation is delayed; no socket-local role cache may authorize writes.

All configuration, membership, selection, ownership and billing writes share `quire:accounts`. Keep branch leases, `branches.assert`, current-role checks, source-intent validation, optimistic counters, idempotency receipts and outbox writes. Do not hold this lock during network/provider work or byte preparation.

Compiler changes use account lock **before** compiler lock: fresh transaction-bound role/policy checks and limits persistence at admission in `service.ts` and `diff.ts`. Recheck queued jobs at local claim (`execute`) and remote claim (`CompilerLeases.lease`), before cache reuse: current role must permit compilation; replace their wall budget with the current policy capped by existing worker/deployment ceilings. Unauthorized jobs become canceled with `POLICY_CHANGED`, without new attempts or provider work. Already running jobs keep their bounded start-time budget and existing completion fences; there is no retroactive extension, refund or new admission. This is the explicit in-flight decision: a started execution lease is not a retained project entitlement. Transfers and downgrades affect every subsequent authorization and every not-yet-started job.

History reads continue through `HistoryStore.dto/accessible`; labels remain exceptions, and no inaccessible snapshot is purged. Extract the age/label predicate into new `core/base/history-access.ts`, reading labels through `history_versions.snapshot_id` and evaluating current actor policy on the supplied SQL context. Preserve `history_versions.created_at` for captured history; an uncaptured compile snapshot uses its own creation time. It must not require review registration, history capture or `history_order`: compiler-only compositions also use it. `HistoryStore.dto` uses the predicate to report accessibility; mutation/byte consumers assert it.

Restoration must recheck the selected history target under the source admission/publication account fence, not just before waiting for the branch. Resolve the existing `review_restore_intents` target using the source receipt's actor/key/route and verify its project/branch; completion of already-published recovery remains completion, not a second user restore. PDF-diff historical jobs must honor the same history gate as ordinary historical comparison, as well as the new compile budget. Queued historical claims recheck it before executing or reusing cached output.

## File ownership and migration

One backend implementer owns:

- `packages/contracts/src/accounts.ts`, `routes-accounts.ts`, `routes-core.ts`: grant DTO and exact routes/output additions. `PolicyPort` and `ProjectSchema` need no new method or entitlement snapshot.
- New `services/accounts/identity/project-benefits.ts`; existing `identity/policy.ts`, `identity/index.ts`: projection and append-only migration.
- New `services/accounts/governance/project-benefits.ts`; existing `governance/index.ts`, `billing.ts`, `managed.ts`, `shared.ts`: operator admission, release/transfer behavior and project fanout. `members.ts`/`lifecycle.ts` reuse their existing mutation paths; no independent billing engine.
- Existing `services/core/base/access.ts`, `access-records.ts`, `access-routes.ts`, `effective-access.ts`, `invitations.ts`, `project-routes.ts`: consume the accounts selection calculation in all admission/transfer paths.
- New `services/core/base/history-access.ts`; existing `services/core/base/source-records.ts`, `services/core/review/history.ts`, `history-store.ts`: shared history eligibility and fenced restore target checks.
- Existing `services/compiler/service.ts`, `leases.ts`, `diff.ts`: fresh budget/role/history admission and queue claims.
- Existing `services/adapters/billing/reconcile.ts`, `services/adapters/federation/provisioning.ts`: correct affected-project invalidation.

Existing governance helpers can be imported by core as they already are; do not introduce a reverse governance-to-core dependency. Keep transfer selection reset and the shared capacity resolver in the accounts layer where governance-only fixtures can use them. UI/application integration belongs to the other owners: contract handoff is access refresh, assigned/effective role display, and the owner selection operation; this document does not edit their files.

Append migration **`012-a-project-benefits`** to identity's exported migrations. It creates the benefit table, seeds only the deployment baseline, and adds the nullable project selection column. Foundation already creates projects/billing/members before identity migrations; base fixtures include identity without governance, and governance fixtures may omit core. Therefore do not place required storage solely in governance/core registration. Supply distinct SQLite/PostgreSQL SQL.

Do not modify any old migration ID/SQL/digest, seeded identity, role, policy JSON, history, grant secret or fixture database. Existing projects start automatic selection; pre-existing over-capacity assignments immediately become effectively read-only under the new rule. Do not import policy JSON into grants: ambiguous old values remain restrictions. Operators must explicitly configure desired higher benefits; record this deployment change rather than silently upgrading users.

Migration tests must retain every existing digest/receipt assertion and append assertions for the new migration and preserved data. Restart must retain selections/grants and recompute against current billing. No compatibility mode, legacy policy bypass, new retry loop or periodic entitlement reconciler is needed.

## Deterministic acceptance contract

Use existing real SQLite/HTTP harnesses, injected clocks, persisted source/review fixtures and controlled signed billing provider. New assertions below are missing under current code. Subscribe before actions; use explicit barriers with bounded timeouts for races, never sleeps/polling or live vendors.

| Test location | Arrangement, action and decisive assertion |
| --- | --- |
| New `tests/accounts/identity/project-benefits.test.ts` | Configure baseline `(12,1,1,false)` and owner grant `(90,3,null,true)` with nonbinding explicit ceilings. Free collaborator receives 90/3/full/tracking; its own higher grant cannot lift a basic-owned second project. Actor user ceiling 30 and federation ceiling 20 yield 20; actor tracking false wins. Repeat workspace/global/project/actor-org denials separately. AI fields remain byte-equivalent before/after owner grants. |
| Same file; existing migration tests | Unconfigured local deployment stays 180/unlimited/full/tracking with empty paid catalog. User and plan tombstones cannot be resurrected by stale PUT. Nonoperators cannot grant benefits; invalid/null deployment is rejected. Reopen baseline fixture; old receipts/policies/roles remain equal, only new receipt/storage appear. |
| `tests/accounts/governance/billing.test.ts`; `tests/adapters/billing/flows.test.ts` | Map a controlled price, assign an owner seat, activate by signed webhook. Two already-existing owned projects change, including an external workspace; unlicensed admin does not. Checkout alone changes neither. Cancel/past-due/unassign withdraws only that sponsorship. Scheduled active nonrenewal retains it. Duplicate/reordered receipts do not create duplicate transitions; `SEATS_IN_USE` still rolls back state, receipts and events. |
| New `tests/core/base/writable-capacity.test.ts` | Seed Editor+Reviewer, one Viewer and pending invite under capacity 2; lower owner grant to 1. Both assigned writable roles survive in SQL but effective roles are Viewer; direct writes/compile/comment/propose/restore fail, reads succeed. Select Reviewer: comments succeed, proposal follows tracking, Editor stays read-only. Restore capacity 2 in automatic mode: both work without re-inviting. Explicit subsets remain explicit. |
| Same; existing `capability-authority.test.ts`, `effective-access.test.ts` | Reviewer counts for link `join`; same-seat Editor/Reviewer conversion succeeds without promotion of a dormant seat. Overfull automatic selection blocks invitation acceptance/link self-admission. Resolve selection, then race two admissions for one remaining seat behind an account-lock barrier: exactly one succeeds. Duplicate/foreign/Viewer selection IDs fail atomically. Removed/recreated member ID cannot regain an old selection. |
| `tests/core/base/share.test.ts`; governance `managed.test.ts` | Transfer paid owner to basic collaborator: finite selection resets empty, old role retained, all four benefits resolve new owner. Competing transfer uses stale version and fails. Suspend/remove target or change sharing between preflight/transaction: transfer fails. Managed ordinary transfer fails; authorized admin transfer retains its verified-target checks. Release clears only sponsoring license; delete/day-boundary advance reassign before revocation and use recipient benefits. |
| `tests/core/review/labeled-window.test.ts`, `enforcement.test.ts` | With controlled clock, downgrade full history/tracking to one day/off. Old unlabeled timeline/source/compare/restore is inaccessible; labeled counterparts remain accessible. Existing suggestion IDs/text/authors survive; effective Editor can decide them, selected Reviewer cannot create new proposals. Barrier before restore publication plus downgrade rejects an expired target without source mutation. |
| New `tests/compiler/owner-benefits.test.ts` | Hold enqueue after immutable snapshot preparation, commit owner downgrade, release barrier: persisted wall budget is new value. Hold queue before local/remote claim, then transfer/unselect actor: no unauthorized execution or cache success. PDF-diff jobs use current budget and historical access; running fixture retains its start-time budget. Existing worker ceilings and late-callback fencing still apply. |
| `tests/core/review/events.test.ts`, `session-revocation.test.ts` | Open collaborator SSE and WebSocket before owner seat loss. Await project-scoped policy event; fresh effective-access is read-only and next socket write fails without advancing revision. Owner-only/billing-account-only event is insufficient. An unrelated-project reader receives no unauthorized project data. Replay/restart preserves invalidation semantics. |
| Existing `tests/adapters/dropbox`, `references`, `ai` | Owner benefit change never authorizes another actor's grant, reference refresh or additional AI uses. Own valid connector still requires its existing policy/role gates. Imported reference bytes and AI actor usage ledger remain unchanged by downgrade/transfer. |

After implementation, run once:

```sh
bun test tests/accounts tests/core/base tests/core/review tests/compiler tests/adapters/billing tests/adapters/dropbox tests/adapters/references tests/adapters/ai
bun run typecheck
bun run lint
```

Run existing portable migration/transaction gates for both dialects as well; schema SQL parsing alone is not PostgreSQL behavioral acceptance. Product UI owners must separately demonstrate the refreshed controls/selection operation on their assembled surfaces. None of these future commands was run for this design.

## Product decisions not established by the original sources

Actual Quire baseline/plan values, price mappings, paid personal connector eligibility and unlicensed institutional sponsorship terms require product configuration; ship the existing honest local baseline until supplied. Do not infer these from vendor prices or group labels.

C33's link-counting conflict and C39/A51's unspecified general overflow winner selection are resolved here: admitted link Editors count; no arbitrary survivor; owner explicitly selects. In-flight compilation and multi-sponsorship combination are also concrete Quire decisions above, not vendor-parity claims.

C40a's prospective sharing-policy promise remains a separate unresolved product contract: current code applies live deny-wins sharing and this change preserves it. Git's personal-premium versus owner-premium wording and full personal connector licensing remain separate gaps. No new external fact or live-provider access is needed to implement this design; genuine commercial inputs must arrive through explicit configuration, not fabricated entitlements.
