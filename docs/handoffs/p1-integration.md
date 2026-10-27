# P1 application integration

Lead follow-up: `p1-acceptance.md` records the independent findings and their
verified fixes after this original integration report. Current composition
includes the real native overview as a ninth module; 176 handlers are
registered and 69 remain explicitly deferred. Native operator user edits and
audit visibility now pass browser checks, and successful PDFs no longer carry
metadata-derived false error diagnostics.

Owner: F integration, October 27, 2026. Native CLI: Bun 1.3.14.
Status: P1 assembly and assigned verification pass. No unresolved P1 producer
blocker remains; the explicitly listed P2 surfaces remain unimplemented.
No producer service/feature, baseline migration, package dependency, original
input or discovery file was edited by this lane. No commit or push was made.

## Runnable composition

`apps/server/src/composition.ts` now exports the application's actual ordered
module list, used by default by `createApplication` and by the P1 test harness:

| Module | Lane | Order |
| --- | --- | ---: |
| `010-a-identity` | A | 10 |
| `011-a-governance` | A | 11 |
| `021-k-base` | K | 21 |
| `023-k-review` | K | 23 |
| `024-k-catalog` | K | 24 |
| `024-k-git` | K | 24 |
| `025-a-git-credentials` | A | 25 |
| `030-c-compiler` | C | 30 |

Catalog and Git retain their distinct lane-prefixed migration IDs. Git
credentials use the real A registration rather than bypassing route ownership.
Identity/governance precede all core consumers; compiler follows core.
Foundation health remains F-owned.

`await app.start()` starts the actual local compiler consumer after assembly.
`await app.close()` stops compiler jobs/reaping, disposes review transports and
then closes SQLite. Every caller must await close. The lead corrected the
out-of-scope migration, identity-test and admin-smoke callers after integration
lint exposed the old synchronous call sites. This is an application lifecycle
change, not a new shared DTO or service-port contract.

`main.ts` delegates WebSocket handlers through the registered realtime service.
The HTTP handler disables Bun idle timeout for `/api/events`. Shutdown uses
Bun's synchronous listener disposer before awaiting application cleanup because
Bun 1.3.14 retains a stale WebSocket counter after server-initiated policy close.
It does not wait indefinitely on that known native counter.

Compiler startup performs a real cold readiness/content probe, approximately
45 seconds on this workstation. The e2e server gate now waits for proxied API
health, with a 120-second startup deadline, rather than accepting Vite alone.

## Browser routes and session ownership

The real `MarketingPage`, `AccountPage`, `ProjectsPage` and `AdminPage` exports
replace the P0 shell. All receive the same router-owned typed client, current
path including search/hash, navigation callback and async session-refresh hook.
Browser back/forward and hash navigation update the route. `/verify-email`
consumes the actual local-mail token route. Institution and policy routes are
also mounted. `/admin/providers` remains the producer's AI-view alias.

`apps/web/src/session.ts` owns the `/me` snapshot and CSRF callback. Initial
anonymous sessions are valid; unexpected session errors stay visible. Login,
logout and settings producers refresh this same snapshot, so mutations use
the current session's real CSRF token. Persisted theme and interface language
are applied by the router. No browser-local authority or replacement DTO was
introduced.

The editor subtree is P2 and has no page export yet. Its advertised project
paths explicitly identify that missing workspace and preserve navigation back
to the persisted dashboard. They are not represented as completed editor pages.
No artificial editor, PDF viewer, provider, admin overview or operations success
was added.

## Regression and browser evidence

`tests/integration/p1/application.test.ts` uses the default application modules,
real SQLite/blob/Git services, actual Argon2 login/cookies/CSRF, a new project,
Unicode file persistence across application restart, an isolated native TeX
compile, downloaded PDF magic and a genuine Viewer's `403 FORBIDDEN`.
It also probes every actual registry entry without a session and reports the
remaining `501` endpoint names. Mutation probes have invalid empty bodies and
cannot write business records.

`tests/integration/p1/browser.ts` serves the built production assets with the
same composed native application on an ephemeral loopback port. At 1440 and
390 CSS pixels it checks the real landing, sign-in, project list, profile,
verification token and honest admin-unavailable screen, with no browser errors.
Desktop additionally creates a real project through the router-owned CSRF
client and returns from the P2 editor boundary to its persisted dashboard row.
The ten PNGs in `docs/evidence/p1-integration/` were generated from that actual
application, not wire fixtures. Desktop/mobile captures were inspected for
blank output, framing, overlap and horizontal overflow.

The stale foundation HTTP test explicitly requests `modules:[]` when testing
unimplemented foundation behavior. The stale shell browser test now follows
the actual marketing-to-account route. Assertions were updated to the shipped
behavior, not removed or weakened.

The projects producer links connection setup to `/settings/connections`,
while account's implemented tab is `/settings/git`. Router composition maps
that incoming alias to the real Git/integrations page without dropping query
or hash values; the browser regression checks the linked route at both widths.
Neither producer needed a competing settings implementation.

Native receipts retained under `docs/evidence/p1-integration/`:

| Command | Observed result |
| --- | --- |
| `bun run typecheck` | Exit 0 after lead producer/caller corrections |
| `bun run lint` | Exit 0, no warning suppression |
| `bun run build` | Exit 0; 200 web modules, 258 server modules |
| Final `bun test tests/contract tests/core tests/accounts tests/compiler tests/integration` | Exit 0; 331 pass, 0 fail, 1,025 assertions, 83 files, 296.86 seconds |
| Initial `bun test tests/contract tests/core tests/accounts tests/compiler tests/integration` | 328 pass, 1 fail, 1,016 assertions, 83 files, 283.23 seconds; exposed the subsequently fixed default-example defect below |
| Final `bun test tests/integration/p1` | Exit 0; 3 pass, 0 fail, 15 assertions, 44.60 seconds; new-project PDF, seeded PDF, persistence, Viewer denial and exact registry set pass |
| `bun tests/integration/p1/browser.ts` | Exit 0; both 1440/390 matrices and real project creation pass |

After the final connections-route correction, the combined typecheck, lint,
production build and real browser command also exited 0. The final full native
suite completed with exit code 0, not merely passing output from a partial run.
The broad `test:e2e` matrix was not run: it includes later P2 editor/product
acceptance. The assigned P1 native browser harness instead drives the actual
production assets and composed services described above.

The corrected default-composition new project produced a real 41,496-byte PDF
with SHA-256
`9e0e1ec3c774ea076b9baea20ed6598c616dc7281b7a6dafa9ab82d7e7f92abf`.
The seeded paper separately produced a 90,004-byte PDF with SHA-256
`70a7f78d1b61a17a5f71afd1de5af79e9d9a8810affefec29e0ea54b84848240`.
These are successful jobs, distinct from the earlier failed example whose
partial PDF was correctly not treated as success.
Initial wrong 201 test expectations were corrected to
the actual registry's success statuses, and that initial test-only failure is
retained. The original strict/lint failures are retained beside the passing
receipts. One final LSP freshness request timed out at 3,000 milliseconds;
the real strict compiler and type-aware lint include the changed tests.

## Measured remaining 501 registry set

The actual application probe found 245 registry entries: 175 implemented and
exactly these 70 unregistered contracts,
all assigned to P2 rather than missing P1 module exports. The regression's
`p2-surface.ts` records the explicit set and rejects any extra missing native
handler. Names below refer to the shared endpoint registry, not guessed URLs.

| P2 boundary | Actual remaining endpoint names |
| --- | --- |
| Federation, identity configuration and SCIM token | `identityStart`, `identityCallback`, `samlCallback`, `identityLink`, `identityUnlink`, `identityConfigGet`, `identityConfigPut`, `identityTest`, `identityMetadata`, `scimToken` |
| Configured billing | `billingPortal`, `billingPreview`, `billingCheckout`, `billingCancel`, `invoiceDownload`, `billingWebhook` |
| Imports, connections and retrieval | `importCreate`, `libraryDoi`, `referencesSearch`, `connectionsList`, `connectionStart`, `connectionCallback`, `connectionTest`, `connectionDelete`, `connectionAction` |
| Reviewed AI | `aiRunCreate`, `aiRunGet`, `aiRunCancel`, `aiRunDecide`, `aiRunUndo`, `aiConversationDelete` |
| Operations and overview | `operationsList`, `operationGet`, `adminOverview` |
| Worker administration | `workersList`, `workerPolicyGet`, `workersCreate`, `workerPolicy`, `workerDrain`, `workerDelete` |
| Environment administration | `adminEnvironments`, `environmentCreate`, `environmentDefault`, `environmentRetire`, `environmentBuild` |
| Providers and SIEM | `providerGet`, `providerPut`, `providerTest`, `auditSiem`, `auditSiemGet` |
| Recovery, updates and support | `backupPolicyGet`, `backupPolicyPut`, `backupCreate`, `backupsList`, `backupVerify`, `backupRestore`, `releasesList`, `updateCreate`, `diagnosticsCreate`, `supportInquiry` |
| SCIM resources | `scimUsersList`, `scimUserCreate`, `scimUserGet`, `scimUserPatch`, `scimUserDelete`, `scimGroupsList`, `scimGroupCreate`, `scimGroupGet`, `scimGroupPatch`, `scimGroupDelete` |

## Resolved native producer defect

Before the lead correction, `services/core/base/projects.ts:24` put a U+1F600 emoji in the example's
`sections/introduction.tex`; `createFromFiles` selects `pdflatex` by default.
The real new-project compile log reports:

```text
/src/sections/introduction.tex:2: LaTeX Error: Unicode character [U+1F600]
not set up for use with LaTeX.
pdflatex: Command for 'pdflatex' gave return code 1
Main processes terminated with: code=exited, status=12/n/a
```

The resulting job was `failed` with `COMPILE_FAILED`. This was a producer
example/engine mismatch, not a missing compiler, a mock or a permissions
failure. The lead removed the incompatible emoji from the default example,
and the unchanged successful-new-example assertion now passes through the
real combined application.
The Unicode persistence assertion uses a separate non-included file and passes;
removing non-BMP storage coverage is not a remedy. No producer file was edited.

## Remaining P2 boundaries

U owns the absent editor workspace, source/visual/PDF/Git/review/history/log/
agent screens and citation insertion. X owns external auth/provider linking,
AI, connection grants, imports/converters, DOI/retrieval and configured billing.
O owns overview, operation reads/listing, worker/environment administration,
provider administration, backups/updates/diagnostics/SIEM/support and deployment.
In particular, `AdminPage` deliberately gates all its forms on P2
`adminOverview`; it displays an actual unavailable response even though native
governance/catalog handlers are wired. Removing that gate or faking overview
would misrepresent P2 completion.

Resolved producer follow-up: the account onboarding import action navigates to
`/projects?new=import` (`features/account/starting-point.tsx`), but
`features/projects/ProjectsPage.tsx` originally did not consume that query.
The lead now opens the existing upload dialog and removes only the consumed
query action when closing it. Actual import execution is still X/P2.
Starting-point template choices now use the approved/published policy too.
This lane did not edit either producer.
The lead also fixed `features/admin/Audit.tsx` index-signature accesses exposed
by whole-repository strict checking; no diagnostic was suppressed.

Portable-storage conversion remains the lead's required phase before P2
adapters, as specified in `docs/architecture/storage-portability.md`.
No scale-profile or full-product acceptance is claimed.

## Cleanup receipt

After the final logs and screenshots were retained, recursive removal of the
owned `/tmp/quire-p1-integration.M4KtoM` root completed with exit 0 and emitted
`P1_OWNED_QA_CLEANED`. This removed the isolated TMPDIR, Bun cache and any
test-created child paths. Native test and browser commands had already exited
0; fixture/browser `finally` blocks stopped their listeners, compiler workers,
review subscriptions, browsers and SQLite connections. The one-shot producer
watch had completed; explicit stop reported no live session. No unrelated
listener or process was stopped, and no post-delete polling was used.
