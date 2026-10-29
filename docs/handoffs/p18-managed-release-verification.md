# FINAL: P18 native managed-release verification

October 28, 2026. Independent auditor: `st_01a18100`.

**PASS for the gated native release contract.** The producer FINAL delivery exists, completed receipts match original execution output, source/evidence hashes match, and the release-caused migration-test selector failure is closed. This verdict does not accept unrestricted release of historic or passwordless accounts, global-SSO bypass, automatic federation re-enrollment, or management UI behavior.

## Evidence accepted

Producer delivery: `docs/handoffs/p18-managed-release.md`, read after its FINAL publication. SHA-256: `7906610cb94bd81d31fe2f00107b6e344cfb64ba27dffdeedf716548ebe99d35`.

Independent bounded evidence:

- `docs/evidence/p18-managed-release-verification/receipt-audit.md`: original JSONL record locations, exact artifact comparisons, source/migration hashes, final manifest checks, selector correction, and cleanup inspection.
- `docs/evidence/p18-managed-release-verification/invariant-map.md`: implementation-to-test mapping and precise coverage limits.

Producer evidence: `docs/evidence/p18-managed-release/`. The native receipt contains **108 pass, 0 fail, 381 assertions, 16 files**, exit 0. Fresh real PostgreSQL release/migration/rollback/restart completed exit 0. Both explicitly strict account/federation TypeScript projects and touched-file type-aware deny-warning lint completed exit 0. The corrected historical migration cases passed **2 tests, 29 assertions**; the parent's joined account compiler/lint command also exited 0.

These are inspected completed receipts, not planned commands. Native, PostgreSQL, static and final migration log artifacts were compared with original producer JSONL tool-result text. The parent's migration monitor payload and complete chained-command exit were inspected independently. Both final manifests passed: 17 source/test hashes and 8 evidence/parent-test hashes. No unchanged passing suite was rerun by this auditor.

## Release invariant verdicts

| Invariant | Verdict | Evidence and scope |
| --- | --- | --- |
| FINAL producer delivery and actual completed checks | PASS | FINAL file read; original exit-0 results and final source/artifact manifests inspected. |
| Owning-team authorization and account-version boundary | PASS | `managed.ts` authorizes the path organization; locked account lookup requires matching `managed_by` and nondeleted user, then checks account `expectedVersion`. Completed accepted-management and stale-version cases exercise the contract. Cross-team exclusion additionally follows from inspected organization-qualified SQL; no extra cross-team HTTP case is claimed. |
| Sole-admin release fails before domain mutation | PASS | Completed native test makes the target sole team admin, releases as operator, receives `LAST_ADMIN`, and compares unchanged domain snapshots. |
| Additive SQLite and PostgreSQL migrations | PASS | Existing identity fields survive SQLite upgrade; ownership constraints are tested. Real PostgreSQL verifies applied migration digest and restart. Historical/benefits hashes remain pinned and every PostgreSQL variant remains checked after the selector-only correction. |
| Explicit provenance, without seizing historic/personal links | PASS | New consumer identities are personal; federation/SCIM identities use trusted assembly organization. Existing links become unknown `legacy`. Unknown ownership blocks release without deletion; native and PostgreSQL gates passed. Historic completeness is limited below. |
| Personal and other-organization identities survive | PASS | Completed native and real SCIM/OIDC cases retain exact personal and other-organization rows at the same issuer. Deletion is user/organization/authority-qualified; admission rejects personal-authority collision. |
| Team membership/license and effective group authority end | PASS | Actual team member row disappears. SCIM relational members and group JSON are cleaned, group version advances, claims/owned account/federation ceiling disappear, and remaining members/claims survive. Real SCIM group GET confirms effective membership. |
| Account, independent grants/benefits and project collaboration survive | PASS | Completed tests retain projects, project memberships, provider grants and unrelated organization membership/license. Independent owner benefits fall from 90 to 60, not forcibly to deployment defaults. User is retained, unmanaged and unsuspended. |
| Independently usable recovery/login, with no global SSO bypass | PASS | Successful releases are followed by real password login and authenticated `/api/me`. Missing password/email rejects before mutation. Real requireSso configuration denies unsafe release, stays enabled, and still denies ordinary password login. No delivered email-recovery capability is inferred. |
| Stale sessions and outstanding tokens cease working | PASS | Sessions and one-time tokens are removed transactionally; old `/api/me` is 401. Native, real OIDC/SCIM and PostgreSQL receipts cover stale sessions and renewed password login. |
| Old-group renewed login cannot restore authority | PASS | Renewed signed OIDC callback returns 409; no group identity, team membership or federation ceiling is restored. SCIM writes/group reprovisioning are fenced, including after reinvitation. |
| Release overlapping external verification is fenced | PASS | Actual OIDC token exchange invokes release before admission commits; callback returns 409 with no session, membership or claims. Locked transaction checks permanent organization-release fence after proof verification. |
| Late failures roll back domain changes, events and fences | PASS | Native/federation audit-rejection triggers preserve snapshots and old usable session. PostgreSQL trigger preserves management/identity state and omits release fence. SQL, audit and events share the locked unit of work. |
| Existing released SCIM guard and accepted-managed transfer predicate remain | PASS | Released-management deactivation refusal remains. Native deletion, lifecycle and SCIM retain active/nondeleted same-team membership, accepted management and matching managed_by recipient checks. Final SCIM regressions pass; prior recipient-specific evidence is retained in `p17-managed-transfer-recipients.md`, not rerun. |
| Owned cleanup is scoped and completed | PASS | Original receipts show named database/root/container/image cleanup. Auditor independently found the owned PostgreSQL container, LDAP image and PostgreSQL root absent and inspected awaited server/provider/runtime/sandbox disposal. No broad prune or installation process action was taken. |
| Configuration/data limits are honestly exposed; no backend-to-UI acceptance leap | PASS | FINAL explicitly names all restrictions below and reserves UI acceptance to the parent. |

## Exact remaining limits

**FAIL as an unrestricted historic-identity release capability:** migrated links lack trustworthy personal-versus-organization provenance. They remain `legacy`; release returns `IDENTITY_PROVENANCE_REQUIRED`. This is the correct preservation boundary, but no legacy ownership-remediation workflow is delivered.

**FAIL as passwordless or globally forced-SSO independent recovery parity:** release requires a pre-existing password, verified primary email, and permission from existing `passwordAllowed`. Unsafe accounts receive `RECOVERY_REQUIRED` or `SSO_REQUIRED` before mutation. The operator-readable local mail outbox is not independent mail delivery. Global requireSso is not relaxed; existing enrolled break-glass rules remain their own authority.

An owning adapter must be loaded when organization authority or an unattributed federation ceiling remains; unavailable authority fails `RELEASE_AUTHORITY_UNAVAILABLE`, and conflicting federation ownership fails safely. Federation claims/ceilings remain deployment-wide rather than a newly proven multi-provider ownership model.

The durable organization-release fence survives a new management invitation. No automatic fence reset or federation re-enrollment workflow is supplied. Release retains its existing non-idempotent contract: a later repeated mutation is not a successful replay.

Fresh PostgreSQL evidence covers native accounts/core, migrations, rollback, password login and restart. Full federation cleanup uses the SQLite protocol assembly. Real local OIDC release and callback interleaving are directly tested; passing SAML/LDAP/consumer OAuth regressions do not prove every protocol-specific release interleaving or live vendor behavior. Retained personal links are inspected and preserved; no separate post-release login was performed for every personal third-party link.

Management readers and user-visible management UI are **not adjudicated here**. No backend test is treated as their acceptance.

## Findings and disposition

The release-caused historical migration selector failure is **closed** by the parent's exact baseline-ID selection. Both original hashes, benefits hashes and every-migration PostgreSQL checks remain; the correction is not a weakened failure assertion.

One unrelated supplementary failure remains: `tests/adapters/federation/policy.test.ts:50` expects compile seconds 420 where the current project-owner benefits model yields 180. Its broader receipt contains 108 pass / 1 fail. The test performs no release; that test and policy/benefits implementation were unchanged. The bounded native PASS does not mean the entire repository suite is green.

The auditor wrote only this report and its bounded verification evidence paths. Source/tests, parent readers/UI, installations, original HTML/ZIP, FastShort and commits were not modified by this audit.
