# Lead-owned P1 contract corrections

## Project dashboard and bulk operations

The projects UI exposed two gaps in the P0 contracts. These changes supersede
the corresponding initial architecture examples:

- `ProjectSummarySchema` and `ProjectSummary` extend `Project` with required
  `ownerName: string`, `tagIds: readonly Id[]`, and `role: Role`.
  `projectList` returns a page of these summaries. Tag membership is private
  to the requesting user; role is that actor's effective project role.
  Other project endpoints still return the unchanged `Project` DTO.
- `projectBulk` accepts `{ items: [{ id, expectedVersion }], action }`.
  The previous single batch version could not represent selected projects
  at different versions. Duplicate project IDs and missing versions are
  rejected by the shared boundary. The core handler must authorize and check
  every selected project before changing any, returning 409 with no partial
  mutation if any version is stale. There is no project-list ETag contract.
- Git import authentication remains a connection `grantId`; no raw secret
  field is added to the new-project form.

The lead reproduced the bulk boundary defect with the new independent-version
case in `tests/contract/schemas.test.ts`: the old schema rejected the valid
batch (19 passing, one failing test). Core atomicity and visible UI behavior
remain part of P1 integration verification, not implied by parser tests.

Verification after the correction: `bun test tests/contract` passed 41 tests
with 67 assertions across eight files in one run. Strict TypeScript compilation
of `packages/contracts/src/index.ts` and targeted type-aware Oxlint of the two
changed schema files and regression tests both exited 0.

## Marketing configuration

`MarketingPage` may expose an optional, documented `operatorContact` prop.
Missing contact configuration must remain explicit. Billing and institutional
routes remain owned by A, and `supportInquiry` by O. Marketing must not register
duplicate service endpoints or fabricate a delivered inquiry.

## Account read models and session revocation

Native settings must not become unavailable merely because P0 omitted their
read endpoints. The following contracts are now exported:

- A identity owns `authOptions`, public `GET /api/auth/options`, returning
  `{passwordEnabled, registrationEnabled, providers:[{id,label,capability}]}`.
  Provider entries and availability derive from actual configuration.
- A identity owns `identitiesList`, authenticated `GET /api/me/identities`,
  returning `Page<LinkedIdentity>` with `{id,issuer,subject,createdAt}`.
  Unlink checks the user aggregate version exposed by the `/me` response ETag.
- `Session` now includes the persisted `sessions.version`, enabling checked
  individual session revocation rather than guessing a version.
- A governance owns `notificationPreferencesGet`, authenticated
  `GET /api/me/notification-preferences`, returning
  `{events,channels,projectOverrides,version}`. Its existing PATCH shares the
  same value fields with `expectedVersion`; override keys are project UUIDs.
- A governance owns `billingInvoices`, authorized
  `GET /api/organizations/:o/billing/invoices`, returning `Page<Invoice>`.
- X owns `billingPortal`, authorized and idempotent
  `POST /api/organizations/:o/billing/portal {expectedVersion}` returning a real
  provider-hosted `{url}`. This is the payment-management boundary; Quire does
  not collect raw card details. An unconfigured provider must return a truthful
  error, not a fabricated payment method or URL.

The session-list schema defect was reproduced by a failing regression case:
it rejected a valid persisted session carrying the version required by DELETE.
The lead also corrected a literal-widening TypeScript error in the earlier bulk
test fixture; this was a test typing defect, not a production behavior change.

After the account corrections, `bun test tests/contract` passed 42 tests with
69 assertions across eight files. Strict TypeScript compilation of both the
contract index and schema regression tests, and targeted type-aware Oxlint,
exited 0. Native UI/backend implementation acceptance remains the owners' and
combined phase's responsibility.

## Verification-email route

Identity's local mail links use `/verify-email?token=...`. The application
router must send `/verify-email` to `AccountPage`, alongside sign-in, sign-up,
reset-password and settings. Successful verification continues through
`/sign-in?onboarding=1`; after session refresh, onboarding navigates to
`/sign-up?step=start`.

## Secondary-email removal

`emailDelete` now takes `{email,expectedVersion}`. The original UUID input was
not discoverable from `User.verifiedEmails`, so the UI could not perform a
legitimate removal. Identity resolves the address case-insensitively within the
authenticated user's verified emails, preserving primary/managed-account
protections. No extra list endpoint or guessed identifier is needed.

## Avatar content and live session revocation

- A identity owns `avatarGet`, authenticated `GET /api/me/avatar`, returning
  actual image bytes with the correct MIME type and private caching. Missing
  avatar returns 404. This completes upload/read/delete without exposing an
  arbitrary content-addressed blob route.
- Durable event `session.revoked` has `{userId, sessionId: Id | null}`, with
  aggregateId equal to userId. Null revokes every session for that user.
  Identity records it in the same transaction as logout, explicit revocation,
  reset or account deletion, then dispatches after commit. Revoke-others emits
  each removed ID so the retained session is not closed.
- K realtime/SSE consumers must close matching authenticated transports upon
  committed revocation, without a polling timer; never expose this internal
  event to unrelated users. Governance/operations that revoke sessions must
  follow the same event contract. Request-time authentication checks still
  enforce persisted session validity independently.

## Administration must be a product UI

The lead's visual review rejected generic API forms with manually entered
versions, ETags and UUIDs. The lead now owns the completed admin UI subtree's
corrective work. Earlier admin screenshots are not final acceptance.

A governance is explicitly assigned the existing A-lane admin user operations
(`adminUserGet/Patch/Invite/Transfer/Revoke/Restore`, `adminEditorState`,
`auditList/Export`) and these added read contracts:

- `adminUsersList`: `GET /api/admin/users`, paginated with `q`,
  `role=all|operator|member|guest`, `state=all|active|suspended|deleted`.
  It returns `Page<AdminUserSummary>`, the User DTO plus actual operator/status,
  deletedAt, groups `{name,membership}`, projectCount, lastSeenAt and version.
  Member means non-operator with group membership; guest means non-operator
  without one. Searches match name/email case-insensitively.
- `adminUsersCsv`: `GET /api/admin/users.csv` with the same filters, without
  pagination, returning an authorized CSV. Escape cells correctly and neutralize
  spreadsheet formula injection; never export credential fields.

The users table uses selected records and their returned versions for edit and
session actions; group membership controls use actual organization/membership
IDs behind named choices. The operator never enters concurrency metadata.
All admin operations require server-side operator authorization.

O additionally owns `workerPolicyGet`, `GET /api/admin/workers/policy`, returning
the actual `{min,max,timeoutSeconds,sandbox,version,pools:[{id,name}]}`.
The worker UI chooses named pools rather than asking for UUIDs, and edits the
fetched policy using its own version. `workersList` must expose the worker
collection's ETag; drain/remove use that fetched aggregate version, not the
separate policy version or a guessed zero. Worker creation continues to return
an Operation, whose queued status must not be reported as an already running
worker.

`ProviderConfig` now includes the stored full `policy` and `version`, in addition
to redacted connection fields and capabilities. O's GET returns an authoritative
configuration and ETag even when the external provider is unconfigured, so an
operator can configure it without inventing policy values. PUT omits `secret`
to retain the saved credential and sends an explicit empty string to remove it;
reads never return the credential. The AI form edits the AI mode/allowance while
preserving the other fetched policy fields. `/admin/providers` is an alias of
the implemented `/admin/ai` view.

## Compiler preview response metadata

`createClient().callWithMetadata()` now preserves the actual response headers
in `metadata.headers: Readonly<Record<string,string>>`, alongside its existing
ETag and parsed version. The previous client discarded the compiler's stale
preview and partial-artifact headers.

U must consume `x-last-successful-artifact-id`, `x-preview-stale` and
`x-artifact-partial` from that record; boolean header values are `"true"` or
`"false"`. The compiler's checked DTO remains unchanged. Browser Fetch's normal
forbidden-header rules still apply; this is not an alternate cookie reader.
Real HTTP regressions reproduced the lost metadata on both byte and JSON
responses before the correction.
