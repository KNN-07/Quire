# P73 institutional template curation

November 6, 2026. Status: scoped implementation and verification complete.
This packet supersedes the initial contract escalation.

## Elected requirement and source

The retained `research.zip` is present. `unzip -l research.zip` located its
contents. `unzip -p research.zip research/waves/projects/expand-17.md` concerns
dashboard search/tags; the relevant source is `expand-12.md`, `harvest-12.md`
and `verify-12.md` under `research/waves/projects/`. Those distinguish curated
submission/resubmission, Commons featured public-gallery selections, and local
self-hosted publication roles. `docs/handoffs/p60-remaining-goal.md:169-183`
explicitly elects a featured selection consumed by the institution portal.
Organization visibility alone does not satisfy that requirement.

The lead selected explicit institution-admin/operator curation of immutable
published, approved versions. Existing catalog curator/publisher authority
remains unchanged. No role-provisioning system or license default was added.
Withdrawal must remove availability. Re-publication of the institution selection
requires explicit selection of a valid published version; withdrawn approval
is not resurrected.

## Implementation

`services/core/catalog/institution-templates.ts` owns institution selection.
The paired SQLite/PostgreSQL migration stores institution, template and pinned
version IDs, with foreign keys and one selected version per template/institution.
Mutation checks run under the existing accounts/catalog locks, check active
operator or institution-admin authority, and compare the template aggregate
version before selecting or removing. Both commands increment that aggregate
version transactionally and return the successor, so intervening curation
invalidates stale selection/removal requests. The portal refreshes both its
featured rows and candidate versions after each command. A selected version must be the current
published version. Public source can be selected across institutions; organization
source must belong to that institution. Private source is not selectable.

The three additive core contracts are `institutionTemplates` (GET),
`institutionTemplateSelect` (PUT) and `institutionTemplateRemove` (DELETE), under
`/api/organizations/:o/templates`. Existing registry spread exports carry them;
no shared port or account route changes were necessary.

Portal reads expose only selected, still-published versions. Public picks are
publicly visible; organization picks require institution membership. Later drafts
and approval never move the pin. A replacement publication makes the old pin
unavailable until an admin explicitly selects the replacement.

`apps/web/src/features/projects/InstitutionTemplates.tsx` shows featured picks,
license/visibility, native independent-copy actions, and administration controls
for existing institution admins/operators. It reuses the native new-project
dialog and loads all template pages. The existing institution page has one mount
of this template-specific component. The original enrollment behavior remains.

The initial direct-republish experiment and ordinary organization-catalogue
filter were removed following the clarified design. Existing publication still
requires approved status; an unpublished version cannot bypass resubmission.

## Verification

Before implementation, the targeted existing lifecycle, roles, administration,
copy-policy and template cases passed: 22 tests, 38 assertions, exit 0.

Verification commands:

```sh
./node_modules/.bin/bun test --timeout 30000 ./tests/core/catalog
./node_modules/.bin/tsc --noEmit -p tests/ui-product/admin/templates/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  services/core/catalog/institution-templates.ts services/core/catalog/index.ts \
  services/core/catalog/migrations.ts packages/contracts/src/routes-core.ts \
  apps/web/src/features/projects/InstitutionTemplates.tsx \
  apps/web/src/features/marketing/institution.tsx \
  tests/core/catalog/institution-templates.test.ts \
  tests/ui-product/admin/templates/browser.test.ts
./node_modules/.bin/bun test --timeout 180000 \
  ./tests/ui-product/admin/templates/browser.test.ts
```

New service coverage exercises explicit selection, authority and scope denials,
stale versions, frozen pins through drafts/approval, publication replacement,
restart persistence, removal/reselection, withdrawal, and rejection of withdrawn
approval resurrection. New native browser coverage uses actual CLI bootstrap,
application composition, browser cookies and HTTP mutations for draft creation,
submission, approval, publication, institution-admin selection, portal copying,
withdrawal, changed-source resubmission, publication and explicit reselection.
No canned template API handles the composed workflow.

No production user data or publication is used. Fixtures own their temporary
storage and OS-assigned listeners and dispose their browsers, application, worker,
web/API servers and root. Final results and cleanup receipts follow.
No commit was created.

## Historical migration assertion correction

The first full catalogue invocation was:

```sh
./node_modules/.bin/bun test --timeout 30000 ./tests/core/catalog
```

It returned 46 passing cases and one failure: the historical migration test
expected the entire current migration ledger, except portable initialization,
to equal the twelve-row retained baseline. The new additive selection migration
correctly introduced a thirteenth domain ledger entry. No historical migration
SQL or digest was changed. The test still compares all twelve historical rows
including their digests and timestamps byte-for-byte, and now independently
requires the new migration entry and an empty initialized selection table.
The foreign-key check and both dialect checks remain.

Exact diff in `tests/core/catalog/migrations.test.ts`:

```diff
       expect(original).toHaveLength(12);
-      expect(await runtime.db.all("SELECT * FROM schema_migrations WHERE id <> '006-f-portable' ORDER BY id")).toEqual(original);
+      expect(await runtime.db.all(`SELECT * FROM schema_migrations
+        WHERE id NOT IN ('006-f-portable','025-k-institution-template-selection') ORDER BY id`)).toEqual(original);
+      expect(await runtime.db.all("SELECT id FROM schema_migrations WHERE id='025-k-institution-template-selection'"))
+        .toEqual([{ id: "025-k-institution-template-selection" }]);
+      expect(await runtime.db.all("SELECT * FROM institution_templates")).toEqual([]);
       expect(await runtime.db.all("PRAGMA foreign_key_check")).toEqual([]);
```

The corrected invocation
`./node_modules/.bin/bun test --timeout 30000 ./tests/core/catalog/migrations.test.ts`
passed: one case, nine assertions, exit 0. Previously passing catalogue cases were
not rerun merely to duplicate their result.

The initial native browser run failed on the test request's missing Origin
header ("Same-origin request required"), then cleaned its owned root and both
listeners. The fixture now supplies its actual web origin on direct mutations.
The initial post-migration typecheck reported an out-of-scope concurrent account
error in `services/accounts/governance/institution.ts:53` (inferred string rather
than the enrollment-state union). No suppression or accounts edit was made here.
The owned-path typed lint invocation completed with exit 0.

## Curation concurrency review correction

The lead identified that the initial select/remove compared template aggregate
version without advancing it. Lock serialization alone did not make an
intervening curation write visible to a later stale administrator request.
Both commands now increment `templates.version` within their existing SQL
transaction, consistently with other template authority mutations. This changes
the concurrency token, not the approved snapshot, metadata, license or visibility.
It deliberately serializes curation of the same template across institutions.

The new regression retains explicit assertions that a successful selection
advances the token, stale select and stale administrator remove fail with 409
after that selection, removal advances the token, and stale select fails after
removal. Existing restart, immutable pin, audience, withdrawal, and authority
assertions remain. Final invocations retain output in
`docs/evidence/p73-institutional-templates/curation-final.log`,
`browser-final.log`, and `static-final.log`.

## Terminal results and visual inspection

Final curation regression invocation:

```sh
./node_modules/.bin/bun test --timeout 30000 \
  ./tests/core/catalog/institution-templates.test.ts
```

`curation-final.log`: 3 pass, 0 fail, 33 assertions, exit 0. Final strict
TypeScript invocation and owned-path typed lint completed with exit 0;
`static-final.log` contains no diagnostics. The owned-path whitespace check also
exited 0. The earlier out-of-scope account type errors were corrected by their
owner before these final checks.

Final native invocation:

```sh
./node_modules/.bin/bun test --timeout 180000 \
  ./tests/ui-product/admin/templates/browser.test.ts
```

`browser-final.log`: 1 pass, 0 fail, 28 assertions, 102.98 seconds. The lead
observed its successful terminal exit; the monitor session had expired by this
child's final status read, so the retained log is the final local receipt.
No rerun was performed after the lead reported success.

The actual composed workflow created a draft from an institution source project,
submitted, approved and published it; an institution administrator explicitly
featured the published version in the real portal, created an independent project
through the native template dialog, removed/reselected the still-valid published
version, withdrew global publication, verified withdrawal hides the selection,
and rejected direct resurrection of the withdrawn approval. It then created a
new draft, changed real native source, resubmitted, approved, published, and
explicitly selected the replacement. The copied project retained its original
source bytes. An outsider could neither publish nor read organization source.
An institution administrator managed featuring without being an operator.

The initial and replacement version IDs were
`6d1333ad-31df-4a5e-863c-d2511da4acda` and
`828de29e-67f8-4955-aae2-61c6122855ee`; their snapshot IDs differ. Final aggregate
version was 13. The independently owned copied project was
`363450b1-22b6-47bd-a656-bccc05d8469a`.

All eight captures under
`docs/evidence/p73-institutional-templates/d51f2526-04cf-447f-80f5-cbec408df0a1/`
were opened and inspected:

- `organization-1440.png`, `organization-390.png`: selected institutional report,
  explicit MIT license and organization visibility, usable copy/removal actions,
  and administrator selection controls. Mobile wraps its controls within the card.
- `unfeatured-portal.png`: honest empty featured state after removal.
- `republished-portal.png`: the still-published version explicitly selected again.
- `published-1440.png`, `published-390.png`: actual admin publication outcome,
  status, license and visibility, with responsive table/card presentation.
- `reselected-portal-1440.png`, `reselected-portal-390.png`: final portal after
  explicit replacement selection. Desktop shows the selected report and controls.
  The mobile viewport capture is framed above the card contents and shows only
  the featured heading at its bottom; it is not claimed as a full final-state
  mobile control capture. The earlier mobile organization capture shows those
  controls, and exact replacement identity is asserted through the live endpoint.
  The bounded correction below supplies the missing complete mobile surface.

No inspected frame was blank or had overlapping controls. The browser asserts
no horizontal page overflow at both widths. These are light-mode captures;
this packet does not claim dark-mode visual acceptance.

## Cleanup and scope limits

`browser-final.log` records `BOOTSTRAP_ROOT_CLEANED`,
`BOOTSTRAP_NATIVE_CLOSED`, and `TEMPLATES_ROOT_ABSENT` for
`/tmp/quire-p40-bootstrap-template-ls7f4Z`, with web/API ports 40917 and 40157.
The final independent cleanup check confirmed ENOENT for that root and both
earlier failed-run roots:
`/tmp/quire-p40-bootstrap-template-mLZ7Si` and
`/tmp/quire-p40-bootstrap-template-igkpnR`.
Connections to all six owned ports (40917, 40157, 33245, 43321, 35257, 46753)
failed with ECONNREFUSED. The obsolete registry file watcher was explicitly
stopped. No owned application/browser work remains pending.

The new service tests establish public selection, audience limits, stale curation
writes, permission denial, restart persistence, and frozen selection through
later draft/approval/publication. The composed browser case uses existing
operator authority for submission/review/publication and a separate non-operator
institution administrator for selection. Separate curator/publisher grants are
covered by existing passing service tests, not separate browser administration
sessions. No grant-provisioning product surface was introduced.

PostgreSQL migration SQL is explicit and covered by the retained dialect
assertions; no live PostgreSQL fixture was run for this packet. No full production
build or whole-product acceptance run is claimed. Renewal eligibility UI changes
by the other child are preserved beside the template component mount; this
packet's browser fixture uses deliberate administrative/membership grants and
does not establish institutional renewal behavior.

## Bounded mobile visual correction

The lead requested a complete mobile view of the changed featured actions after
noticing the final 390px viewport crop. The passing 28-assertion lifecycle receipt
above was preserved and was not rerun. No production code or styling changed.

A separate owned native fixture ran only:

```sh
./node_modules/.bin/bun test --timeout 180000 \
  ./tests/ui-product/admin/templates/capture.test.ts
```

`mobile-correction.log`: 1 pass, 0 fail, 6 assertions, exit 0, 37.92 seconds.
The bounded setup published a real public `Institutional report` from the
owned bootstrap source and selected it as a separate non-operator institution
administrator. Its public visibility differs from the original organization
lifecycle fixture; this is a visual control capture, not replacement lifecycle
or organization-audience evidence.

Both images under
`docs/evidence/p73-institutional-templates/mobile-correction-a6b53dff-9467-4796-94d6-e59d174a490c/`
were opened and inspected:

- `featured-actions-390.png`: complete featured card at the 390px viewport,
  showing Use template, Remove featured, published-version select,
  Feature selected version and Refresh templates.
- `portal-full-390.png`: full page including that complete card and the
  preserved institution eligibility/enrollment surface.

All controls are visible, wrap within the card and do not overlap. The test
asserts both page-level and featured-card horizontal overflow are absent.
The screenshot framing issue is corrected without changing the application.

The capture test's scoped TypeScript and typed lint passed with exit 0;
`mobile-static.log` has no diagnostics. Cleanup records root
`/tmp/quire-p40-bootstrap-template-ArJ8JR` removed with
`TEMPLATE_CAPTURE_ROOT_ABSENT`, and awaited closure of web/API ports 36327 and
41995. All owned capture work reached terminal success.
The independent final cleanup check also confirmed ENOENT for that root and
ECONNREFUSED on both ports.
