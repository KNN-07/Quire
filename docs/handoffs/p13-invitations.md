# Emailed project invitation acceptance: FINAL

October 28, 2026. Parent-owned native account route and recipient-read boundary.

The mail producer already emitted `/invitations/:id?token=...`, but the web
router did not handle that path. Acceptance also requires the exact invitation
version, which changes after resend and was not readable by its recipient.

The new authenticated `invitationGet` endpoint returns current invitation
metadata and the project name only to an account with the matching verified
email. It exposes no token/hash, uses private/no-store caching, and grants no
project access. Existing acceptance retains token, expiry, recipient, role,
capacity, policy and transaction-version checks.

The account route displays sign-in, pending invitation, wrong-account and
closed invitation states using existing account components. Acceptance is an
explicit action. Sign-in preserves the invitation path/query for password and
configured-provider navigation; return destinations must resolve to this
origin. The native password path and off-origin rejection were executed;
no new live federation-provider flow is claimed.

## Verification

- The new recipient-read test first failed with HTTP 404. After implementation,
  it and existing native sharing cases passed **5 cases/21 assertions**.
  Both scoped strict TypeScript targets passed. An effect-return lint error
  was corrected without repeating those passing native cases.
- All **23 contract schema cases** passed in the subsequent selection. That
  joined run retained a browser-test failure after actual successful acceptance:
  Playwright exposed null request-body metadata to the test.
- The corrected browser assertion reads the actual committed successor
  version 2. The native service requires the pending version 1 from the resend;
  passing a guessed initial version cannot produce that success. The
  browser-only rerun passed **1 case/28 assertions/58.61s**, exit 0 under
  `mon_BZ8YC6GY208Q1CJK`, followed by scoped strict types, test lint and the
  four-component draft guard, all exit 0. Changed production lint passed
  before that run. Failed receipts are retained, not summed into a single
  all-green run.

The actual mailed URL, signed-out sign-in return, explicit acceptance,
pre-acceptance project denial, persisted Reviewer membership, post-acceptance
read, reload state and malicious off-origin return target are exercised
against native services without successful-response interception.

All **16** current screenshots were opened and inspected: signed-out, pending,
wrong-account and accepted states at 1440/390 in light/dark. Mobile uses
touch/mobile emulation at DPR 3. No overlapping or clipped principal controls
was observed. Evidence:
`docs/evidence/p13-invitations/58eee652-4485-4f51-a683-2a495906126f/`.
Durable reports: `acceptance.xml` (historical joined failure) and
`acceptance-fixed.xml` (passing browser run) in `docs/evidence/p13-invitations/`.

## Cleanup and scope

Both exact browser fixture roots are absent:
`/tmp/quire-ui-integrations-8xPoYS` and
`/tmp/quire-ui-integrations-etllM6`. Their ports
44089/33291/44055/38297 independently returned `ECONNREFUSED`.
The passing test also asserts its root removal after awaited disposal.

This closes ordinary emailed project invitations for an authenticated verified
recipient. Managed-account acceptance, organization invitations, live email
transmission and complete external-provider onboarding remain separate
contracts. No token was added to reports or screenshots, no automatic
acceptance or cross-origin redirect was introduced, and original inputs were
unchanged.
