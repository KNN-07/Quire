# FINAL: P18 native managed release

October 28, 2026. Task `st_01a180e8`. This handoff was written after implementation, verification, evidence capture, and owned-resource cleanup, as the task's last file write.

## Delivered result

A55a release now removes the releasing team's membership and license rather than retaining an unlicensed member. It clears management, suspension, and lapse state without deleting the account, transferring projects, or removing independent benefits. The existing `POST /api/organizations/:o/managed/:u/release` body and response are unchanged: `expectedVersion` is the account version, the account increments once, and the management record increments separately.

Before changing release state, the transaction checks the expected version, accepted lifecycle state, the team's sole-administrator constraint, a password and verified primary email, the deployment's existing `passwordAllowed` decision, and identity provenance. A sole administrator, unsafe recovery configuration, ambiguous legacy identity, or unavailable owning adapter fails without a partial release.

Successful release:

- Deletes only the releasing team's membership and its organization-owned identities.
- Revokes all existing account sessions and outstanding one-time tokens.
- Clears the matching federation adapter's account ownership, claims, and `federation-user` ceiling.
- Removes the user from local SCIM group membership rows and group resource documents, incrementing affected group versions while retaining other members.
- Preserves personal OAuth links, links and membership/licensing belonging to other organizations, personal provider grants, unrelated policies/benefits, and owned/shared projects.
- Leaves ordinary independent password login usable under the existing deployment policy.
- Persists an account/organization release fence. SCIM profile writes, deactivation, group reprovisioning, and federation admission cannot silently regain authority, including after reinvitation or an overlapping OIDC token exchange.

The original account lock, unit of work, audit actor, policy events, and session-revocation events remain in use. Failure of the final audit insertion rolls back membership, identity, session, federation, release-fence, and account changes together. Release remains non-idempotent under its existing contract; a second mutation does not manufacture a successful replay.

## Design and ownership

`services/accounts/identity/identity-provenance-migration.ts` adds migration `013-a-identity-provenance` in SQLite and PostgreSQL. It records `authority_kind` (`personal`, `organization`, or `legacy`), an exact organization reference where applicable, and persistent organization-release fences. CHECK constraints prohibit contradictory provenance.

Only new identities receive provenance from the trusted admission path: consumer OAuth creates personal links; OIDC/SAML/LDAP federation and SCIM use their assembly organization. Existing links stay `legacy`; neither issuer equality nor a current federation configuration is used to seize or delete personal identity ownership. Known personal identities cannot be admitted as organization-owned merely because the issuer matches.

`services/accounts/identity/managed-release.ts` follows the existing services-keyed WeakMap extension pattern. Governance does not query optional federation tables or invent a system principal. The actual federation adapter registers transactional cleanup for its assembly organization. A core-only installation still releases ordinary password accounts safely; stored organization authority or an unattributed federation ceiling requires the corresponding adapter.

The alternative rejected was deleting all identities matching the configured issuer or rewriting old migration data to infer ownership. Both could destroy personal OAuth links. A local password-reset outbox was also rejected as proof of independently delivered recovery: the current implementation requires operator filesystem retrieval.

Existing accepted managed-transfer recipient guards were preserved. The parent owns contracts, `governance/index.ts`, `management-reads.ts`, and UI verification; this task did not edit them. The parent's new read endpoints can continue passing their current account and acceptance counters to the unchanged mutations.

## Verification

Evidence directory: `docs/evidence/p18-managed-release/`.

| Check | Observed result |
| --- | --- |
| Native release, impacted governance, SCIM/group reconciliation, OIDC, SAML, real TLS LDAP, consumer OAuth/identity | 108 tests passed, 381 assertions, 16 files; exit 0 |
| Existing account migration compatibility after the parent's selector correction | 2 tests passed, 29 assertions; exit 0 |
| Fresh real PostgreSQL migration, legacy/unloaded-adapter gates, release, rollback, independent login, and restart | `P18_RELEASE_POSTGRES_PASS`; exit 0 |
| Strict `tsc -p tests/accounts/tsconfig.json --noEmit` | Exit 0 |
| Strict `tsc -p tests/adapters/federation/tsconfig.json --noEmit` | Exit 0 |
| Touched-file `oxlint --type-aware --deny-warnings` | Exit 0 |
| Source hash verification and `git diff --check` | Passed |

`README.md` gives exact commands and monitor receipts. `native-tests.log`, `postgres.log`, `static-checks.log`, `migration-compatibility.log`, and `cleanup.log` retain bounded output. `sources.sha256` identifies the 17 files changed by this child; `artifacts.sha256` identifies evidence artifacts and the parent-corrected migration test.

The migration's SQL digests are:

- SQLite: `083325d95d3479ac1a4889011da67b45b9c18cefb05f40f0ef8ea5d476469eb8`.
- PostgreSQL: `e334826b245ce377f864b0ecbe53ad354eee9aa6365d39ce3e5dd7697cb23ed5`.

The parent corrected the historical migration-test selector in its own scope. Both immutable baseline hashes and the existing benefits hashes remain unchanged, and every migration still enters the PostgreSQL-variant check. This child did not modify that out-of-scope test.

The disposable PostgreSQL container/database and test directories were removed. The previously missing LDAP fixture image was built from the unchanged repository Dockerfile, used for real TLS tests, then removed. No live installation, original HTML/ZIP, FastShort5173, or unrelated container was modified. No commit was created.

## Acceptance boundaries

This is a verified, gated native release implementation, not unrestricted lifecycle or vendor parity.

1. Passwordless accounts or accounts without a verified primary email receive `RECOVERY_REQUIRED`. There is no claim that the current operator-readable local mail outbox independently delivers recovery.
2. Global `requireSso` is never disabled or bypassed for release. An account that cannot independently use its password under that policy is rejected; existing enrolled break-glass policy remains the authority for its own exception.
3. Any ambiguous legacy link blocks release with `IDENTITY_PROVENANCE_REQUIRED`, preserving the link. A legacy ownership-remediation workflow is not supplied.
4. Missing owning adapters or conflicting federation ownership fail safely. The adapter's claims/ceiling model is deployment-wide rather than a new multi-provider ownership model.
5. The release fence survives reinvitation. Automatically restoring previously released federation authority, resetting the fence, and a new re-enrollment workflow are outside this operation.
6. Independent personal or other-organization grants remain effective. Free/default benefits apply only when no independent grant remains; release does not forcibly erase them to produce a Free label.
7. Protocol success was observed against real local fixtures, not live vendor accounts. PostgreSQL verification uses the real core/account assembly; protocol cleanup is covered by the SQLite protocol suite. The parent owns actual management UI checks.

One unrelated supplementary test remains a reported pre-existing failure: `tests/adapters/federation/policy.test.ts:50` expects compile seconds 420 from a user ceiling, while the accepted project-owner benefits model yields 180. Its broader run reported 108 pass / 1 fail; no release occurs in that test, and its file and the policy/benefits implementation were confirmed unchanged. It was not weakened or edited to make the release checks green.
