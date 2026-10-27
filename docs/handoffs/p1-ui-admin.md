# Admin UI handoff

## Lead correction supersedes the original implementation below

The original schema-generated API forms were rejected in visual review and
removed. `ActionForm.tsx`, `Resource.tsx`, `schema-fields.ts`, `catalog.ts` and
their generator-specific tests no longer exist. The historical sections below
describe the original child delivery, not the accepted current UI.

The current UI has dedicated overview, users/groups, workers, environments,
provider, templates, backups, updates, support, audit and identity controls.
Versions and ETags come from typed reads, not manual fields. Mobile navigation
is a section selector. The template modal keeps actions visible while its body
scrolls. Additional native reads and ownership are documented in
`p1-contract-deltas.md`.

The corrected browser matrix passed 61 states at 1440/390 in light/dark,
including all three identity protocols, canceled worker creation, actual
worker payload/CSRF/idempotency, PEM preservation, successive identity ETags,
queued handshake status, and 403/501/503 boundaries. This uses explicit HTTP
fixtures, not native operations or federation service acceptance. The lead
also drove individual template, environment/font, provider, backup, audit,
support and identity interactions; evidence is in `docs/evidence/lead-admin`.

Current strict TypeScript checks omit `skipLibCheck`; native Bun tests for
credential write/read boundaries and type-aware lint pass. Earlier LSP
freshness timeouts remain disclosed. Browser/profile/fixture cleanup completed
for the full corrected matrix.

Maintenance read/control verification and contextual operator project transfer
are now implemented and exercised. A final native core project-discovery
regression is running. Native O/X integration remains required.

## Brief

Operator administration follows the existing IBM Plex primitives and tokens.
Primary action: refresh live state on overview, save configuration on identity,
and the named create/configure action on each operations panel.
Priorities: actual state, resource detail, consequential actions.
Required content: overview, authentication (SAML/OIDC/LDAP, attributes, domains,
break-glass, enrollment, mappings, metadata, SCIM), architecture, Users & groups,
Compile workers, TeX Live images, AI provider, Templates, Storage & backups,
Updates, Support, Audit log. Every action uses the declared registry schema.
Left out on purpose: invented users, replicas, uptime, queue entries, storage
figures, provider readiness, plan badges, and simulated successful handshakes.

Layout: Admin - stable navigation beside long configuration forms -> fixed-sidenav-shell (https://raw.githubusercontent.com/changeroa/StyleGallery/main/patterns/viewport-shell/fixed-sidenav-shell.md); scroll owner: .admin-main; anti-patterns: unbounded main height, competing page scroll, visual order differing from focus order. At narrow widths the navigation becomes an ordinary wrapping region and the document owns scroll.

## Ownership

This is a client-only lane. No server endpoint or migration is registered here:
the authorized paths do not include services. O/A/X/K retain handler ownership.
The page receives the router-owned client; it never constructs another client.
Root dependency/tooling configuration belongs to foundation.

## Verification

Status: owned client implementation and focused checks pass. Real service
integration is **pending**, not an admin backend acceptance claim.

### Integration export

`apps/web/src/features/admin/index.tsx` exports `AdminPage` and
`AdminPageProps`. Props are exactly `{path, client, navigate, onSessionChange}`.
The page does not initiate authentication transitions, so it does not call
`onSessionChange`. The router must supply its existing client and wire:

| Path | View |
| --- | --- |
| `/admin` | Overview / authorization gate |
| `/admin/identity` | Authentication |
| `/admin/architecture` | Architecture |
| `/admin/users` | Users & groups |
| `/admin/workers` | Compile workers |
| `/admin/tex` | TeX Live images |
| `/admin/ai` | AI provider |
| `/admin/templates` | Templates |
| `/admin/storage` | Storage & backups |
| `/admin/updates` | Updates |
| `/admin/support` | Support |
| `/admin/audit` | Audit log |

Unrecognized sections display an explicit unknown-section view. The overview
request authorizes the shell before privileged forms mount. A 403 hides every
form; a 501 or transport failure shows administration unavailable, never an
invented healthy instance. Every subsequent request remains server-authorized.

There is no `register(context)` here: this lane owns no service path and registers
**zero server endpoints**. Do not compose this UI module as a runtime service.

### Declared endpoints consumed

Names below are properties of the frozen `@quire/contracts.endpoints`, not
parallel DTOs or handwritten fetch routes. `catalog.ts` is the executable action
inventory. Request fields derive from each endpoint's schema and are parsed by
that same schema before sending.

| View | Endpoint exports |
| --- | --- |
| Entry / architecture | `adminOverview` |
| Identity | `identityConfigGet`, `identityConfigPut`, `identityTest`, `identityMetadata`, `scimToken` |
| Users / organizations | `adminUserGet`, `adminUserInvite`, `adminUserPatch`, `adminUserTransfer`, `adminUserRevoke`, `adminUserRestore`, `membersList`, `membersCsv`, `memberCreate`, `memberPatch`, `memberDelete`, `adminProjects`, `adminEditorState` |
| Workers | `workersList`, `workersCreate`, `workerPolicy`, `workerDrain`, `workerDelete` |
| Environments | `adminEnvironments`, `environmentCreate`, `environmentBuild`, `environmentDefault`, `environmentRetire` |
| AI provider | `providerGet`, `providerPut`, `providerTest` |
| Templates | `templatesList`, `templateCreate`, `templatePatch`, `templateSubmit`, `templateApprove`, `templatePublish`, `templateUnpublish` |
| Backups | `backupsList`, `backupPolicyGet`, `backupPolicyPut`, `backupCreate`, `backupVerify`, `backupRestore` |
| Updates | `releasesList`, `updateCreate` |
| Support | `diagnosticsCreate`, `operationGet` |
| Audit | `auditList`, `auditExport`, `auditSiem` |

All mutations first open a confirmation dialog; Enter on a form only prepares
the review. Escape/cancel sends no mutation. Creates/operations receive a UUID
idempotency key when the review is prepared, retained for retries of that review.
The injected client owns CSRF. Identity saves use the fetched version and ETag
and then the returned version/ETag. Other operational forms require the observed
version/ETag explicitly; they never default a missing version to zero. Resource
and action reads expose returned ETags. Worker/environment collection counters
follow foundation's documented aggregate-version convention.

Operation results remain their returned status, including `queued`; no test
handshake or worker-create response is relabeled successful authentication or
a running worker. Operators can inspect an operation by ID in Support.
Credentials are hidden by default and revealed only by an explicit action.
No credentials or operational state are persisted in browser storage.

### Checks actually run

Runtime for application bundling, fixtures, tests and real HTTP probe:
**native Bun 1.3.14**. Browser transport: the browser-enabled eval kernel and
omowright-owned Chromium headless-shell 1248. No live user browser was attached.

1. LSP: the six-file admin TSX directory, three admin TS modules, fixture server
   and backend probe reported zero diagnostics. The last Identity-only requests
   after the certificate correction timed out at 3000 ms; the final strict
   compiler covers that change and passes. An earlier directory-level test
   request selected an unavailable Biome hook; no package changes were made.
2. Owned strict TypeScript: **exit 0**, command below. The existing SQL declaration
   is required because the HTTP probe imports the real runtime.
3. Owned type-aware Oxlint: **exit 0**, no warnings.
4. `bun test tests/ui-product/admin/forms.test.ts`: **exit 0**, 3 pass,
   0 fail, 3 assertions, final run 124 ms. These cover numeric request parsing,
   refusal of a missing observed version, and schema renderability for every
   registered operations action.
5. Browser: **61 states, 122 top/end PNGs**, all nine operations panels,
   SAML/OIDC/LDAP and architecture/overview in light/dark at 1440 and 390.
   Phone runs assert DPR 3, touch enabled and a coarse pointer; every capture
   asserts its actual width and no horizontal page overflow. Assertions cover
   panel unmounting, canceled mutations, actual worker payload/CSRF/idempotency,
   multiline PEM preservation, identity ETags `"v7"`, `"v8"` and `"v9"`,
   queued handshake status, 503, 403 and 501.
6. Real HTTP: `bun tests/ui-product/admin/backend-smoke.ts`: **exit 0**.
   Actual SQLite foundation health succeeds. With service modules explicitly
   uncomposed, overview, identity, workers, backups and providers return
   **501 / NOT_IMPLEMENTED**. This is evidence of missing integration, not proof
   that O/A/X admin handlers work.
7. Draft guard: **exit 0**, 16 files clean.
8. Source size measurement: maximum **195** nonblank/non-comment lines
   (`browser-checks.mjs`); largest application module is Identity, **152**.

Exact compiler/linter commands, from the repository root:

```sh
./node_modules/.bin/tsc --noEmit --strict \
  --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
  --noPropertyAccessFromIndexSignature --moduleResolution Bundler \
  --module ESNext --target ESNext --jsx react-jsx --skipLibCheck \
  --allowImportingTsExtensions packages/runtime/src/assets.d.ts \
  apps/web/src/features/admin/*.ts apps/web/src/features/admin/*.tsx \
  tests/ui-product/admin/*.ts tests/ui-product/admin/*.tsx
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  apps/web/src/features/admin tests/ui-product/admin
bun test tests/ui-product/admin/forms.test.ts
bun tests/ui-product/admin/backend-smoke.ts
bun /home/norman/.omo/binary-runtime/5.1.48/plugin/skills/frontend/scripts/perfection/check-draft-guard.ts \
  apps/web/src/features/admin tests/ui-product/admin
```

### Browser reproduction

Start the native, isolated fixture host:

```sh
TMPDIR="$(mktemp -d /tmp/quire-ui-admin.XXXXXX)" \
  bun tests/ui-product/admin/fixture-server.ts
```

It prints `ADMIN_FIXTURE_URL` with its ephemeral port. In a browser-enabled JS
eval kernel, substitute that exact printed URL:

```js
const checks = await import("/home/norman/Repos/Quire/tests/ui-product/admin/browser-checks.mjs");
const { loadOmowright } = await import("/home/norman/.omo/binary-runtime/5.1.48/plugin/skills/browser/scripts/omowright.mjs");
await checks.runAdminBrowserChecks({
  fixture: checks.remoteFixture("http://127.0.0.1:PORT/"),
  runtime: await loadOmowright(),
});
```

The driver's `finally` closes its browser, native API host and unique browser
profile. Remove the command's own `mktemp` directory after retaining evidence.
The fixture host is test-only; its `/__fixture/*` controls are never part of
production code. The tests use explicit HTTP fixtures and the actual React
page/client, not screenshots substituted for components.

### Preserved failures and corrections

See `docs/evidence/p1-ui-admin/checks.md`. Early failures are not hidden:
readonly-schema access and branded fixture assertions were corrected; initial
lint findings were corrected; direct compiler invocation initially omitted the
repository's SQL declaration; the first Vite fixture and native 1.3 browser
transport stalled; early role locators timed out despite a rendered heading.
The final fixture uses native `Bun.build`/`Bun.serve` and the supported eval
browser transport. The final browser checks use grounded DOM locators.

Visual inspection found actual duplicate-key panel retention and a header
specificity problem; both were corrected. It also caught phone filenames
initially representing desktop viewports; the final run asserts actual width,
DPR and touch and retains new, correctly emulated captures.
Certificate editing preserves multiline PEM blocks instead of splitting every
line into a separate certificate; LDAP CA certificates use a multiline control.
The final browser mutation assertion proves a multiline SAML value reaches HTTP
as one certificate. The fixture string is not a real X.509 credential and no
cryptographic validation is claimed.

### Integration dependencies / concrete contract gaps

- F must mount `AdminPage` in the router and compose A/O/X/K handlers. Those
  files are deliberately untouched. Operator authorization must remain enforced
  by every handler; the UI gate is not a permission implementation.
- O's `adminOverview` must work before any privileged page is exposed. Missing
  overview blocks the whole shell honestly, even if one other handler exists.
- There is **no global admin user-list endpoint**, user role filter or global
  user CSV endpoint. The view exposes supported UUID lookup, organization
  membership and organization CSV, and states this limitation visibly.
- Identity's writable schema exposes no OIDC client secret or LDAP bind-secret
  field. It cannot securely configure those credentials from this UI without
  a contract delta. Existing secret-presence flags are only reported. Real
  SAML/OIDC/LDAP handshake and provisioning checks require A/X plus configured
  providers and a break-glass account.
- Worker policy and editor maintenance state have writes but no corresponding
  dedicated reads in the registry. The UI offers no guessed current policy.
  Mutable services must return the resource/collection ETag convention documented
  by foundation. SIEM writes likewise need an observed version/ETag from its
  owning operations aggregate.
- The provider `Policy` supports AI mode/budget and sharing ceilings. Prompt
  retention, confidential-tag rules and citation-provider configuration have no
  fields here. The view says so rather than accepting undispatched controls.
- Lists show the returned page and cursor; generic action forms expose declared
  query inputs where available. There is no invented all-record export or
  client-side authorization/filtering over unseen records.
- Scale-profile topology is shown only when the real overview reports it.
  The diagram is explicitly the **default local profile reference**, not
  a statement that the diagram's optional workers/providers are installed.
- Full real-backend workflows, provider secrets, worker provisioning,
  restore drills, signed release updates, real organization CSV and SIEM delivery
  remain integration checks for A/O/X/K/F. No backend handler was faked here.
- Lighthouse, react-doctor/react-scan instrumentation and independent oracle
  reviews were not run. Dependency and entry-point changes belong to foundation;
  nested agents were expressly prohibited. No Lighthouse score or full
  visual-qa oracle PASS is claimed. Objective browser evidence and direct
  visual inspection are retained.

### Architectural review

Modules own page composition, protocol editing, schema-derived actions,
structured output, live reads, diagram, or catalog separately. Input is parsed
by shared schemas; there is no speculative DTO replacement. Protocol visibility
uses the three declared protocol values. No `any`, non-null/type assertions,
suppression comments, global client, fabricated fallback state or production
logging was introduced. Single-use layout remains inline; shared form logic
has many real actions. Tests observe request behavior rather than prose.
No new function has more than three positional arguments. No destructive
action is followed by a verification read. Names describe positive states.

### Cleanup receipt

Every browser run's `finally` reports browser/API/profile closure. Stalled
native runs were terminated using only their owned session IDs. The final
real-backend smoke closes its listener and SQLite and removes its unique data
directory through async disposal. The owned root
`/tmp/quire-ui-admin.oVf9bI` (including Vite cache and abandoned native profiles)
was removed after retaining evidence. The final certificate check used
`/tmp/quire-ui-admin.YdEfMo`, also removed after its final checks. The three owned evidence subscriptions
were stopped or had already completed. Original IPv4 5173/3001 listeners were
not stopped. No root/package/primitives/original-input file was edited and
no commit or push was made.
