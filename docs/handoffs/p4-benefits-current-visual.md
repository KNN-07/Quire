# Current benefits visual matrix

Status: FINAL historical producer evidence, October 27, 2026. Independent
review subsequently FAILED visual consistency: `limited-share-1440-light.png`
shows one writable place while its benefits summary still reports Unlimited
and 180 seconds. Hash freshness and behavioral acceptance passed. This packet
does not establish a consistent settled benefits summary. A bounded capture
barrier is being checked against the actual summary update; no persistence
or production-cause claim is made from the single frame.

The complete current packet is
`docs/evidence/p4-benefits-current/162904f6-8c6e-412e-8087-f0dbcc2c1fa7/`.
It contains 84 inspected PNG captures, `captures.sha256`, and `source.sha256`.
All 14 source/test hashes matched before and after the run. The original seven
benefit-control source hashes also match the earlier controls producer manifest.

Command:

```sh
QUIRE_BENEFITS_EVIDENCE_DIR=docs/evidence/p4-benefits-current/162904f6-8c6e-412e-8087-f0dbcc2c1fa7 \
  bun run test tests/ui-benefits/visual.browser.test.ts
./node_modules/.bin/oxlint --type-aware tests/ui-benefits/visual.browser.test.ts
```

`mon_XG4TA4Q138A4WQGG` completed exit 0 on Bun 1.4.4:
1 browser case passed, 72 assertions, 105.02 seconds. The chained type-aware
lint command also exited 0. Existing root TypeScript and affected production
lint receipts are in `p4-review-subscriptions.md` and `p4-git-status-read.md`.

## Coverage and inspection

Each 390, 1440 and 1920 CSS-pixel width has light and dark captures of:

- Administration overview and grant editor, including end-scroll controls.
- Standalone and actual mounted Share, including end-scroll controls.
- Restricted capacity with a required explicit selection.
- A named collaborator's effective read-only state.
- Selected Reviewer and selected Editor states on both Share surfaces.

The 390 configuration uses mobile/touch emulation and device scale factor 3.
Real native grant and membership endpoints produce the states. Selection saves
must return 200; all six cases also restore automatic selection successfully.
Horizontal overflow assertions cover standalone Share, mounted Share and grants.

The parent opened every image through the image-read tool and inspected six
in-memory contact sheets containing all 84 frames. No blank principal surfaces,
overlapping principal controls, horizontal clipping, or unfinished selection-save
indicators were found. Narrow dialogs scroll to their lower controls. Assigned
roles remain visible alongside effective roles; restricted capacity and successful
selection feedback are distinguishable in both themes.

The capture driver waits for saved source before opening mounted Share and for
the completed selection-save feedback before capturing selected states. These
are observable-state barriers, not fixed delays or retries.

## Historical runs and root cause

Earlier failed matrices remain in their original UUID directories. Their 409s
were caused by Git status reads committing checkpoints and advancing the project
version during access reloads, not by a missing paid tier or weakened backend
authorization. `p4-git-status-read.md` records the failing regression and the
36-case passing Git correction.

The preceding packet
`docs/evidence/p4-benefits-current/ee4fdc2c-be04-4124-b6b1-44b0a97c76a1/`
passed all behavior but captured some selected-state save spinners. It remains
preserved; the settled packet above supersedes it for visual acceptance.
The old mixed-age `p4-benefits-controls` packet is not relabeled current.

The final fixture reported root `/tmp/quire-ui-editor-WOzA76` and web listener
`127.0.0.1:42915`. Awaited disposal completed, and the parent independently
confirmed that exact root absent. The preceding passing run's exact root
`/tmp/quire-ui-editor-UL5NjY` was also confirmed absent. No claim is made here
about unrelated sessions or the separate whole-task resource audit.
