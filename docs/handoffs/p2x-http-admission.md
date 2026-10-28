# Adapter HTTP admission follow-up

The parent closed the typed endpoint gaps reported by independent recovered
adapter verification, without changing migrations or adding competing routes.

- `connectionCredentials`: authenticated, CSRF-checked POST
  `/api/connections/zotero/credentials`, body `{accessToken,label}`. References
  invokes the existing upstream-validated Zotero grant admission logic and returns
  only `AdapterGrant`, never the submitted key. The provider parameter is
  schema-restricted to Zotero; this does not pretend to implement OAuth 1.0a.
- `dropboxPolicyGet` / `dropboxPolicyPut`: GET/PUT
  `/api/dropbox/policies/:scopeKind/:id`, where scopeKind is organization or
  project. PUT takes `{enabled,expectedVersion}`. Both return
  `{enabled,effectiveEnabled,version}`. Reads and writes require the existing
  organization-administrator/project-owner authority. Project effective state
  reflects organization deny-wins. Writes retain the existing transactional audit
  and policy events.
- `aiConsentGet`: GET `/api/me/ai/consent` returns configured
  `requiredTermsVersion`, stored nullable `acceptedTermsVersion`, `accepted`,
  `current`, and `userVersion`. The assistant uses this metadata with the existing
  versioned consent POST, rather than asking users to invent a terms version.

Receipt `bash_147`: seven real AI HTTP tests passed, touched-file type-aware lint
and complete repository TypeScript passed, exit 0. Consent checks cover missing
and obsolete terms, configured non-date terms, versioned acceptance and restart
without model dispatch.

Receipt `bash_148`: nine real credential/policy tests passed; touched-file
type-aware lint passed. Zotero tests validate upstream keys, encrypted persistence,
restart, session/CSRF denial and no key echo. Dropbox tests validate authority,
stale-version denial, persisted organization denial and no downstream dispatch.
Complete TypeScript reached one concurrent assistant WIP missing import in
`Composer.tsx`; its owner was notified. This is not a clean global-typecheck claim.

Application mounting, account/admin UI and composed PostgreSQL business-flow
acceptance remain separate integration gates. No live provider credential was
used; the protocol tests use their owned real HTTP fixtures.

## Current adapter cursor discovery

`connectionCursor` adds authenticated GET `/api/connections/:id/cursor` with
`action` and optional `projectId`, returning `{cursor,grantVersion}`. It checks
current grant ownership, installed action and the action's actual project
authority before reading persisted cursor state. It performs no external I/O.
Clients use this opaque value for subsequent `connectionAction.expectedCursor`
instead of guessing after reload.

Receipt `bash_155`: eight real cursor/operation tests passed, touched-file
type-aware lint passed, full repository TypeScript passed, exit code 0.
The new test reads after restart and successfully performs the next action;
existing stale cursor, receipt replay, transaction rollback, parameter validation,
credential leak and project-authority cases remain green.
