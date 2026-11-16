# P74 implementation verification

November 13, 2026. Parent verification of publisher contract/enrollment and
installed Pandoc conversion. This is bounded implementation evidence, not
whole-product or live-vendor acceptance.

## Scope

Publisher typed configuration, per-action enforcement, bearer enrollment and
account connection controls are implemented alongside legacy OAuth support.
Installed Pandoc uses signed fixed controller recipes and immutable images.
The user elected to retain ReadCube and Dimensions as explicitly unavailable.
Generic cluster updates and fresh institutional ownership proof remain outside
the previously elected supported contracts.

Dedicated publisher administration and project submission screens were not
part of these two implementation units. Operator configuration and submission
remain available through their existing HTTP interfaces.

## Independent publisher proof

The parent used omowright against an owned native application at
`http://127.0.0.1:46117/settings/git`. A synthetic destination-issued bearer
token was entered in the masked form, saved, tested and explicitly forgotten.
The submitted field cleared. The test reported success. Removal reported that
the upstream credential was not revoked, and the grant became disconnected.
Desktop 1440 and mobile 390 captures showed no horizontal overflow; both
light and dark removal controls were inspected.

Parent review found a configuration-switch defect: an OAuth grant could be
silently forgotten after the operator changed the provider to bearer mode.
The new real HTTP regression first failed with expected 422 versus actual 200.
The fix binds local forgetting to the stored grant marker, including UI copy.
Seven configuration/enrollment cases then passed. The updated browser case
also passed and preserved remote-revocation wording for the old OAuth grant.

The earlier child regression receipt remains 72 passing shared/publisher tests.
It is not added to the overlapping seven-case follow-up as a unique test count.
Publisher receipts are retained under `.omo/evidence/p74/publisher/`.

## Independent installed HTTP proof

The parent ran `installed-qa.ts` against a fresh signed supervisor fixture,
independent controller ledger and real Docker execution. Markdown import
returned 202, HTML export returned 202 and ZIP download returned 200.
The downloaded archive contained actual HTML with `Parent installed proof`.
Its SHA-256 was
`a5e20de85aa9c4ee13a096e01e4d98f207443e3d4f04978ccfa538f3efab16a9`.
All three probe/conversion launches recorded code 0 and released state.

The fixture root was absent after disposal. Docker listed no containers for
installation `p9be7868541422`; systemd listed no remaining units for it.
Parent application, control, installed API and browser ports 46117, 42225,
43453 and 32965 were closed.

## Validation status

Integrated typecheck, type-aware deny-warning lint and production build passed.
The existing Vite large-chunk warning remains. Final conversion lifecycle
delivery passed three real installed HTTP/cancellation/output-limit cases with
95 assertions. Its final helper correction bounds Docker client runtime workers
within the unchanged signed process limit. The earlier parent HTTP proof
predates that helper correction; the final installed suite validates it.
Final integrated typecheck and build exited 0. Lint initially scanned copied
temporary QA scripts in the evidence directory; those archived scripts were
moved outside the repository, and the unchanged lint gate then exited 0.
No suppression, exclusion or test removal was used. Shared endpoint contract
regressions passed 73 tests.
Parent LSP checks were clean for publisher contribution, account connections
and the browser test. Enrollment-test LSP diagnostics timed out; integrated
TypeScript passed without errors.

Parent raw commands, action transcript, captures and downloaded ZIP are retained
under `.omo/evidence/p74/parent/`, including `integrated-gates.log`,
`publisher-mode-switch-red.log`, `publisher-mode-switch-green.log`,
`publisher-final-browser.log` and `parent-installed.log`.

No live publisher, PostgreSQL migration execution, generic cluster lifecycle,
screen-reader or whole-product acceptance is claimed.

The conversion lane's unrelated TeX submission-export regression was not
completed in its broad run. The publisher lane separately passed its real
compiled submission archive lifecycle; those are distinct receipts.

## Cleanup and review

Publisher and conversion run roots were removed after retaining their receipts.
The task-owned Pandoc image was removed without touching unrelated images.
The parent inspected the production diff and new tests, verified authority,
grant ownership, publication fencing, bounded execution and actual output, and
corrected the OAuth mode-switch defect. All seven changed conversion production
files had clean LSP diagnostics.
The work remained HEAVY because it changed credentials and execution authority.
This bare ultrawork run used self-review, not a separate plan-reviewer gate.

Publisher implementation is committed as `fde4d11`.
Final gate receipts are `final-gates.log`, `final-lint.log` and `contracts.log`
under `.omo/evidence/p74/parent/`. Disposable QA script source is retained in
the session artifact directory `p74-qa-scripts`, outside the lint-scanned tree.
