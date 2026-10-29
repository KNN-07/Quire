# Installation privacy and browser storage

Source inventory dated October 28, 2026. This describes the inspected Quire
implementation, not a legal compliance certification or a review of an
operator's deployed reverse proxy, extensions or external providers.

## Browser state

| Mechanism | Stored value and purpose | Scope and lifetime |
| --- | --- | --- |
| `quire_session` cookie | Opaque sign-in token; server stores its hash and session record | HttpOnly, SameSite=Lax, Path=/, seven-day Max-Age. Secure is added when the configured public URL uses HTTPS. Server expiry, suspension, deletion and session revocation independently gate use. Logout clears the cookie. |
| `quire.editor.sizes.<userId>` local storage | Editor panel widths and split proportions | Account-keyed on this browser origin; no explicit expiry. |
| `quire.python.installation` local storage | Browser Python enabled flag, same-origin runtime directory and pinned version | Browser-origin preference, not account-keyed; no explicit expiry. No source code or credentials are stored in this setting. |
| `quire:dropbox:scope:<userId>` local storage | Last selected project or organization policy scope | Account-keyed on this origin; selection is checked against currently accessible choices. No explicit expiry. |
| `quire:dropbox:operation:<projectId>` local storage | Last synchronization operation ID | Project-keyed, not account-keyed. Reopening fetches the actual operation under current server authorization; the ID is not an access grant. No explicit expiry. |
| `quire.onboarding.billing-return.v1` local storage | Public plan/period return path and expiry | Browser-origin intent, not account credentials. Expires after 24 hours and is removed when read expired/invalid or explicitly cleared. Expiry is not an independent background erasure timer. |
| `quire.onboarding.screen.v1` session storage | Anonymous create/verify/sign-in screen hint | Browser session storage; not authentication or verification evidence. |
| `quire:assistant:<actor>:<project>:<branch>…` session storage | Current AI run ID, with a separate suffix for diagnostic/thread intent | Actor and project scoped; server rechecks access when loading the run. This entry is an ID, not the conversation payload. |
| `quire.source-proposal.<actor>.<project>.<branch>.<file>` session storage | Track Changes draft, base source, epoch and pending submission identity | Contains document text. Also retained in memory. Account/scope keys isolate recovery; no explicit TTL. Browser session restoration can preserve session storage, so closing a tab is not a secure-erasure guarantee. |

Local/session storage is readable by JavaScript running on the same origin.
Do not treat the account component of a key as encryption. Clearing browser
site data removes local recovery/preferences and may discard unsubmitted
drafts; it does not delete server projects, histories or provider copies.
Sign-out is not represented as a purge of all browser storage.

Source locations:

- `services/accounts/identity/authentication.ts`
- `apps/web/src/features/editor/workspace.tsx`
- `apps/web/src/features/editor/tools/PythonPanel.tsx`
- `apps/web/src/features/account/dropbox-policy.tsx`
- `apps/web/src/features/account/onboarding-return.ts`
- `apps/web/src/features/account/onboarding-progress.ts`
- `apps/web/src/features/editor/assistant/use-assistant.ts`
- `apps/web/src/features/editor/source/tracking.ts`

## Optional tracking boundary

Inspection of `apps/web/index.html`, the application source and workspace
package source found no application-owned analytics beacon, third-party
analytics SDK integration, advertising cookie or IndexedDB storage use.
The HTML entrypoint loads the local application module. The package manifest
does not declare an analytics SDK.

This is a source inventory, not a network capture of every page or proof
about a customized deployment. No analytics-consent switch is implemented;
one must not be advertised as disabling collection that the application does
not perform. An operator who adds analytics, a proxy logger or an extension
must separately identify its payloads, retention, recipients and applicable
choices. The existing source-draft “Track changes” feature is document review,
not website analytics.

Browser Python is explicitly enabled and run by the user. Its UI states that
selected scripts can use browser networking. Same-origin runtime assets do not
make arbitrary user scripts network-isolated.

## Configured processors and server retention

Identity, mail, AI, Git, references, Dropbox, billing and publisher adapters
have distinct configuration and authorization contracts. Configuration
readiness is not live provider approval or a guarantee about the provider's
retention, training, location or subprocessors. The operator must supply its
actual installation-specific processor list and policies.

AI requests require the current configured consent version, with the actual
accepted/current state exposed by the authenticated consent endpoint.
Operator request logging defaults to `off`; its policy is independently
versioned. See `services/adapters/ai/routes.ts`,
`services/adapters/shared/provider-policy.ts` and the bounded logging
acceptance in `docs/handoffs/p28-policy-dashboard-verification.md`.
Do not describe this setting as disabling security/audit records, clearing
existing conversations or imposing a universal provider retention limit.

The account metadata export includes user/profile preferences, verified
emails, consent, memberships, project metadata, identities, notifications and
Library records. It omits password hashes, session secrets, reset tokens and
provider credentials. It is not a complete project/history backup.
`services/accounts/identity/account.ts` is the authoritative export shape;
project export and operator backup remain separate mechanisms.

## Remaining acceptance

The public `/privacy` page explains the default cookie, browser storage and
private-draft retention, optional extension networking, provider boundaries
and account-export limits. It explicitly states that an installation-specific
processor list and policy are not published there.

A56a still requires the operator's actual policy and selected-processor review,
plus a network/storage check for its deployed configuration. A clean local
fixture does not establish what a production proxy or extension collects.
This inventory does not authorize optional tracking or make a regulatory
compliance claim.
