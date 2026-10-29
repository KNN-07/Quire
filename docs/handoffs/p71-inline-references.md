# P71 inline references: producer handoff

FINAL producer evidence, October 29, 2026. Parent takeover completed the
unfinished browser verification and privacy/layout corrections after the
initial UI producer returned a partial result. This is not the independent
visual or integrated verification verdict; those gates remain downstream.

## Implemented behavior

The mounted Source editor offers explicit Off/provider selection and real
asynchronous CodeMirror citation suggestions. Only the active citation query
is sent through the existing authenticated reference endpoint. Saved
autocomplete-off, readonly/Viewer, tracking, offline/recovery and destination
restrictions prevent automatic remote requests. Unsupported providers retain
their unavailable states; no private API or citation key is fabricated.

Candidate metadata includes actual title, authors, year, provider and key.
Acceptance copies the actual returned record through citationCreate, then
replaces only the current query range. Zero/one/multiple editable bibliography
destinations follow the existing service contract. Linked bibliographies remain
readonly and their stored keys are read through fileContent.

Requests and acceptance are fenced by generation, document, scope, provider,
destination, selection and session. Stale successful copies are disclosed
without inserting at a moved caret. Receipts survive same-session navigation
and reload in one tab-local slot, using an opaque authenticated-session
fingerprint rather than a stored credential. A new session of the same actor
does not display the old receipt.

Comments, recognized verbatim/listing/minted regions, inline verb and escaped
commands do not yield an external query. This is lexical handling of supported
syntax, not a general TeX macro interpreter.

The provider/destination disclosure collapses when the user focuses Source,
returning its height to the editor. A redundant raw-BibTeX floating tooltip was
removed after the parent observed it covering compact-view controls. The actual
record remains available in the project bibliography.

## Retained checks

The final frozen command was:

```sh
./node_modules/.bin/bun test tests/ui-editor/inline-references
```

`bash_526` / `mon_JR1F5VR94EKEDTF6`: exit 0, **18 pass, 0 fail,
107 assertions**, 99.69 seconds. It includes all seven native scenarios plus
eleven focused query/receipt regressions in one passing run.
Raw output: `docs/evidence/p71-parent-privacy/final-native.log`.

Native scenarios cover zero/one/multiple target persistence, occupied-path
protection and Viewer denial, truthful unavailable providers, cancellation and
Escape, stale-copy disclosure, saved-autocomplete-off, and actual Enter
acceptance followed by same-account session isolation. The timestamp guard test
uses Playwright setFixedTime: no sleep or frozen timer scheduling.

The privacy reproducer first failed 9 of 11 cases, then passed all 11 after the
correction. Earlier native failures are retained: the producer's HMR hook-shape
failure, guessed fixture revision/status, missing durable-save barrier, and
immediate Enter inside CodeMirror's interaction guard. The fixtures now use the
actual revision/status contract and subscribe to document.saved before typing.
No product assertion was removed to make those runs pass.

Scoped TypeScript and deny-warning lint passed under `bash_524` before the
last compact-layout change. That result is not claimed as final-input static
validation; the downstream verifier owns fresh scoped/root checks and build.
Several fresh LSP requests timed out, and the JSON LSP is unavailable.

## Captures and cleanup

Current populated-result captures (all four PNGs inspected by the parent):

`docs/evidence/p71-inline-references/01de63e9-bbad-474c-a443-de152e37c448/`

- `completion-1440-light.png`, `completion-1440-dark.png`
- `completion-390-light.png`, `completion-390-dark.png`

PNG signatures and 1440x900 / 390x900 dimensions were checked. The compact
capture now retains a usable source area and no competing BibTeX tooltip.
This is Chromium viewport resizing, not physical-mobile or comprehensive
accessibility acceptance. The available capture set is populated-state proof,
not a complete every-state visual checklist or exact D06 pixel-match claim.

`docs/evidence/p71-parent-privacy/captures.json` names the original D06 image,
the before-correction images, all current images and all seven native fixture
directories. Their cleanup JSON reports each unique root absent, browser
closed, all three owned listeners closed and no recorded page errors.
The parent inspected every cleanup receipt.

`final-source.sha256` in that parent evidence directory records post-run
fingerprints of 19 changed source/test/design files. It is a post-run snapshot,
not a retroactively captured before-run manifest.

No live provider, port 5173 takeover, production mutation, commit or push
occurred. Original HTML/research inputs and the unrelated root file `1` remain
untouched. The independent backend lifecycle handoff is
`p71-reference-lifecycle.md`; its unchanged passing tests were not repeated.
