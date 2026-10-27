# P1 marketing UI

Status: owned implementation, targeted verification, evidence retention and cleanup complete. Owner: marketing UI lane. Original discovery inputs remain read-only.

## Brief and reference contract

Sources: decoded D09, D15, D17 in `docs/discovery/design-source`.
Typography: shared IBM Plex Sans body, Source Serif 4 display, IBM Plex Mono commands.
Geometry: 1200px page track including 24px inline gutters; 1320px pricing track;
64px landing title, 56px pricing title, 58px server title, 42px section headings.
Mobile uses the same reading order with wrapped navigation and single-column sections.

Layout: marketing pages - bounded prose and full-width section bands -> page-grid (https://github.com/changeroa/StyleGallery/blob/main/patterns/grid-repetition/page-grid.md); scroll owner: document; anti-patterns: nested page scrolling, fixed columns that overflow the viewport.

Primary action: landing = Start writing; pricing = use local edition; self-hosting = open install guide; institution = enroll in the loaded institution.
Information priorities: purpose, working entry action, configuration or deployment constraints.
Required content: header/footer navigation; landing source/split/visual/PDF, Git, AI, organizations, pricing, FAQ; pricing period, live catalog, local edition, comparison, billing FAQ, support contact; self-host native commands, Compose/Helm artifact status, runtime requirements, topology, optional AI, air-gap constraints, support inquiry name/email/organization/users/runtime/airGapped/message; institution slug lookup, name/domains, enrollment result/error.
Left out on purpose: static promotional badge, popular-plan outline, unconfigured vendor prices/trials/discounts/SLAs, fabricated provider health, nonexistent release downloads, dead `href="#"` links.

## Exports and integration

- `apps/web/src/features/marketing/index.tsx`: `MarketingPage`, `MarketingPageProps`.
- Props follow the assigned shared-client contract: `path`, `client`, `navigate`, `onSessionChange`.
  Optional `operatorContact: { email, scope }` supplies installation-owned contact configuration;
  omission explicitly renders “not configured”. No competing global client is constructed.
- Mount for `/`, `/pricing`, `/self-hosting`, `/institutions`, `/institutions/:slug`,
  `/terms`, `/privacy`, `/security`. Hash links target real rendered sections.
- Navigation to `/sign-up`, `/sign-in`, `/projects?view=templates`, `/projects` and
  `/admin/providers` belongs to the account/projects/admin router integration.
  `/api/health` is the real status target, not invented service health.
- Registered backend endpoints: **none**, intentionally. This UI lane consumes
  `billingCatalog` (`GET /api/billing/catalog`, A),
  `institutionGet` (`GET /api/institutions/:slug`, A),
  `institutionEnroll` (`POST /api/institutions/:slug/enroll`, A), and
  `supportInquiry` (`POST /api/support/inquiries`, O).
  Do not register a duplicate or a no-op UI module. No migrations.
- All mutation calls include `params`, `query`, `body`, `headers` and an
  `idempotency-key`; receipt text is set only after a schema-validated success.
  Institution enrollment calls `onSessionChange` after success.
- Catalog display uses the actual operator plan names, currency, minor-unit amount
  and selected billing period. No trial, discount, hosted storage location,
  purchased entitlement or support deadline is fabricated.
- Support receipt uses the response envelope's `requestId`; `OkSchema.version`
  remains validated by the client. It is an acknowledgment, not a promised SLA.
- Contact configuration has no public endpoint in the frozen contract. Integration
  should source the optional prop from operator-owned configuration. No shared
  contract files were modified.

  Exact optional prop shape:

  ```ts
  readonly operatorContact?: {
    readonly email: string;
    readonly scope: string;
  };
  ```

  `email` is the operator-supplied contact address, rendered as a mail link;
  `scope` is operator-supplied support-scope copy. Integration omits the entire prop
  until configuration is available. There is no default address or implied
  support promise. The inquiry form remains bound to the real O-owned
  `supportInquiry` action whether or not contact configuration is present.

- Compose/Helm tabs intentionally explain future verified deployment artifacts.
  The operations lane must reconcile those descriptions once its release artifacts
  are actually available. No nonexistent release or Helm host is linked.
- Native commands match the source build: clone the public origin, frozen install,
  migrate, seed, doctor, dev. The server requires Bun 1.3.14; compilation additionally
  needs Git/TeX Live/latexmk and verified bwrap or Docker isolation. Hardware is
  explicitly unmeasured, not a guessed production recommendation.

## Owned verification harness

`tests/ui-product/marketing/harness.ts` launches isolated Vite and a Bun HTTP
wire-fixture server on ephemeral loopback ports. It validates fixture requests and
responses with the frozen endpoint schemas. It does **not** replace A/O services or
prove their durable delivery, identity policy or billing implementation.

Run from the repository root:

```sh
TMPDIR=<owned-temp-root> XDG_CACHE_HOME=<owned-temp-root>/cache \
  bun tests/ui-product/marketing/harness.ts
# Copy the MARKETING_READY origin printed by the harness:
TMPDIR=<owned-temp-root> MARKETING_ORIGIN=<printed-origin> \
  node tests/ui-product/marketing/run-browser.mjs
```

The browser script uses the installed Playwright Chromium. It checks landing route
targets, unconfigured/catalog-period states, native/Compose/Helm tabs, a real HTTP
support error with form retention, a schema-validated acknowledgment, an
idempotency header, missing-institution errors, successful institutional enrollment,
and no browser exceptions. It captures five page states at 1440 and 390 in both
themes; phone contexts have mobile/touch emulation and DPR 3.

## Checks and results

All commands ran from `/home/norman/Repos/Quire`, on native Bun 1.3.14.
The capture harness first used `http://127.0.0.1:34325`; after correcting
per-run Vite cache isolation, the final harness printed
`MARKETING_READY http://127.0.0.1:43573`.

| Check | Exact command / invocation | Result |
| --- | --- | --- |
| Owned source LSP | `lsp_diagnostics` on `apps/web/src/features/marketing`, severity all | 6 TSX files, 0 diagnostics |
| Owned test LSP | `lsp_diagnostics` on `tests/ui-product/marketing`, severity all | 2 MJS files, 0 diagnostics |
| Type-aware lint | `node_modules/.bin/oxlint --type-aware --deny-warnings apps/web/src/features/marketing tests/ui-product/marketing` | Exit 0 |
| Strict owned TS | Command below | Exit 0 |
| Draft guard | `bun /home/norman/.omo/binary-runtime/5.1.48/plugin/skills/frontend/scripts/perfection/check-draft-guard.ts apps/web/src/features/marketing` | Exit 0, `8 file(s), clean` |
| Browser bundle | `bun build tests/ui-product/marketing/preview.tsx --target=browser --outdir=/tmp/quire-marketing.galgph/build --loader .woff2:file` | Exit 0; 138 modules, 48 ms; unminified preview.js 1.65 MB, preview.css 246.39 KB |
| Browser | `TMPDIR=/tmp/quire-marketing.galgph MARKETING_ORIGIN=http://127.0.0.1:34325 node tests/ui-product/marketing/run-browser.mjs` | Exit 0; all assertions pass, no page errors; repeated with final cache-isolated harness as recorded below |
| Actual migration CLI | `QUIRE_DATA_DIR=/tmp/quire-marketing.galgph/data bun run db:migrate` | Exit 0; isolated SQLite migrated |
| Actual doctor CLI | `QUIRE_DATA_DIR=/tmp/quire-marketing.galgph/data bun run doctor` | Exit 0; Bun 1.3.14, tools listed, sandbox/providers unconfigured and environments empty |

```sh
node_modules/.bin/tsc --noEmit --strict --noUncheckedIndexedAccess \
  --exactOptionalPropertyTypes --verbatimModuleSyntax --target ESNext \
  --module ESNext --moduleResolution Bundler --jsx react-jsx --skipLibCheck \
  --types bun,vite/client apps/web/src/features/marketing/*.tsx \
  apps/web/src/features/marketing/types.ts \
  tests/ui-product/marketing/*.tsx tests/ui-product/marketing/harness.ts
```

The final combined static check ended with `STATIC_PASS`. The final browser check
ended with `PASS marketing browser assertions; 20 full-page, 20 top, 20 end and 8
deployment-tab captures; no page errors`. All 20 reflow measurements had document
width equal to viewport width (1440 or 390), Source Serif 4 headings and no nested
vertical scroll owners. Files are in `docs/evidence/p1-ui-marketing/`; see
`verification.md` there for the evidence naming contract and reviewed findings.

After the cache-isolation correction, owned lint/strict TS again exited 0 with
`STATIC_PASS`, and the following final browser run again exited 0 with all the same
behavior/reflow assertions and 68 regenerated screenshots:

```sh
TMPDIR=/tmp/quire-marketing-final.6q0kgf \
  MARKETING_ORIGIN=http://127.0.0.1:43573 \
  node tests/ui-product/marketing/run-browser.mjs
```

The final harness file's LSP check also reported no diagnostics.

Whole-repository typecheck/build/tests were deliberately not rerun while sibling
lanes were changing shared composition. These results cover the owned feature,
its actual React/browser surface and its HTTP contract handling, not P3 service
composition or production performance.

## Preserved failures and limitations

- First lint run failed on `no-base-to-string` in two FormData reads,
  `consistent-return` in the institution effect and asynchronous Connect middleware
  promise handling. These were fixed without suppressions.
- The first harness put middleware after Vite's 404 handler; `/` returned 404.
  The handler now installs through `configureServer` before Vite fallback.
- Initial Vite runs used its shared default `node_modules/.vite` cache despite
  TMPDIR/XDG isolation. The final harness creates a unique cache directory under
  the process temp root and removes it on shutdown. The existing shared cache
  was not deleted because other lanes may use it.
- The first accepted-inquiry browser assertion timed out after 30,000 ms because
  the wire fixture omitted required `OkSchema.version`; the client correctly
  rejected that invalid response. The fixture now parses its complete output.
- One one-shot diagnostic Node command failed because the shell removed its quotes;
  no code or state was changed by that command.
- The external no-excuse checker exits 2: `cannot resolve "typescript" from the
  caller project`. Its implementation imports `typescript/unstable/async` and
  `typescript/unstable/ast` (TypeScript 7); the foundation pins TypeScript 5.9.3.
  TypeScript is installed. No package upgrade was made to accommodate the checker.
- Two omowright launches lost their targets (`Session with given id not found`;
  `listTargets()` empty). Browser evidence therefore uses real Playwright Chromium,
  not a DOM-only renderer. This is a tool deviation, not a UI pass from omowright.
- Lighthouse/react-doctor/react-scan were not run: the required audit packages and
  dev-only injections are not in the foundation package graph; manifest, entry and
  build configuration are exclusively foundation-owned. No Lighthouse-100 or
  pixel-diff score is claimed. Shared tooling installation is an integration task.
- Reference fidelity follows the source fonts, gutters, widths, section order,
  display scale and dark server band. Commercial copy and plan geometry necessarily
  change with the real catalog; vendor plan promises and fake release instructions
  were intentionally not copied. There is no pre-existing marketing React surface,
  so there is no reconstructed “before” capture.

## Architectural review

Each module owns one responsibility: route shell, landing content, pricing catalog,
self-hosting content, inquiry form, or institutional entry. Data crosses the
boundary through the generated client schemas; no alternative DTOs, assertions,
type suppressions, redundant success guards or permissions bypasses were added.
No new function exceeds three independent parameters. Components are rendered once
per owning screen; no generalized helper framework was introduced. Logging was not
added. The regression checks observe route targets and real HTTP-client outcomes,
not implementation constants. Every owned source is below 200 pure LOC; CSS is
below 200 pure LOC.

## Cleanup receipts

- Closed both outstanding owned browser connections; both close promises fulfilled.
  The browser assertion runner closes its browser in `finally`.
- Stopped all three sequential harness sessions (`bash_6`, `bash_8`, `bash_12`)
  before replacing them; final harness `bash_18` was killed after verification.
  The cache-isolated final harness `bash_27` was killed after its passing run.
  No unrelated listeners were stopped. One-shot check/monitor processes exited.
- Removed `/tmp/quire-marketing.galgph`, including SQLite data, browser profiles,
  cache and compiled preview output; cleanup command exited 0.
  Removed `/tmp/quire-marketing-final.6q0kgf` after the final run; exit 0.
- Retained only the owned source/tests, this handoff and the evidence directory.
  `.gitignore` excludes `docs/evidence/`, so the lead must use an explicit
  force-add if screenshot evidence should be included in its authorized commit.
- No commits, pushes, shared package edits or root/router/composition edits were
  made by this lane.
