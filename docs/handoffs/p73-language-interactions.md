# P73: contextual language interactions

Date: November 6, 2026.

Status: the elected contextual I49a language behavior passes adapter and
composed browser acceptance. Production source is settled. This is bounded to
the elected semantics below; no live inference or universal translation
guarantee is claimed.

## Superseding requirement election

The original research is in repository-root `research.zip`. The earlier
conclusion that evidence was unavailable was incomplete: only its old temporary
extraction had expired. Recovered and read:

- `research/OVERLEAF-FUNCTIONALITY.md`, section 49.
- `research/waves/integrations/{harvest,expand,verify}-49.md`.
- Language/control rows of `research/waves/integrations/slice.md` and the
  angle-50 settings matches.

The originals establish selection-dependent actions and separate controls,
without exact segmentation rules. The user subsequently elected contextual
actions: completion at a caret; synonyms for one word; rewriting for nonempty
selected text; split for one sentence; join for multiple sentences. Unicode
segmentation replaces numerical thresholds. This election supersedes the
earlier contract blocker. Translation guarantees and retired standalone tools
remain outside this acceptance.

Recovery used `unzip -l research.zip`, `unzip -p research.zip` for the three
angle-49 reports, and owned extraction:

```sh
mktemp -d /tmp/quire-p73.XXXXXX
unzip -q research.zip "research/*.md" "research/waves/integrations/*.md" -d /tmp/quire-p73.qftUid
rm -r /tmp/quire-p73.qftUid
```

The first pattern matched nested markdown too; the redundant second pattern
reported no additional match. Requested files were recovered and read. The
owned extraction was removed.

## Implementation

`packages/contracts/src/accounts.ts` supplies shared ICU word/sentence
eligibility with explicit `en` locale, plus `languageEnabled` and
`languageFloatingMenu`, defaulting true when old preference JSON omits them.
The existing `inlineCompletion` preference remains the completion opt-in.
`routes-accounts.ts` explicitly keeps the new PATCH properties optional without
defaults, so an unrelated patch cannot reset a disabled preference.

`source/LanguageActions.tsx` renders a viewport-clamped wrapping toolbar next
to the selection. Source captures the exact file, UTF-16 range and selected text.
Ctrl/Cmd+Alt+L opens language actions explicitly, including at a caret when
automatic floating menus are disabled. The inspected source keymap has
Vim/Emacs presets, not a configurable arbitrary shortcut mechanism. The chord
does not collide with the inspected authoring and assembly bindings. Escape
returns focus to Source. Tracking, read-only and offline source block actions.

Assembly opens the Assistant, including its mobile drawer. Actions fill its
Agent composer; they never send a request or apply source changes. The composer
rechecks captured source before sending, requires eligible context, and uses
the existing proposal/acceptance flow. Range-only panel options and starter
actions are disabled without eligible text. A required context range cannot be
unchecked while the corresponding tool requires it.

The AI adapter rejects ineligible selections before reservation/provider
dispatch and rechecks the language-enabled preference through its existing
authorization path. Existing UTF-16 validation and 256-KiB context cap remain.
Caret completion permits insertion only at the zero-length selected range.
Its separate read-only sentence prefix is disclosed in the composer, included
in the provider envelope and counted against the existing context cap before
reservation; it does not widen edit authority.

P71 bibliography and P72 authorized search were preserved. Legacy paraphrase
and grammar proposal fixtures now supply explicit selections; their review,
conflict and undo assertions are retained.

## Verification ledger

- `./node_modules/.bin/bun run build`: exited 0. Existing Vite large-chunk
  warning remains.
- Lead integrated static run: typecheck, build and matrix exited 0, reported
  by the lead; `/tmp/quire-p73-integrated-static.log` records typecheck and
  matrix results.
- Lead typed lint identified three causes: missing explicit rewrite switch
  cases, inconsistent effect return, and a broad `ReactNode[]` whose type also
  permits promises. Fixed with exhaustive cases/`assertNever`, explicit
  undefined guard return, and inferred JSX element array respectively.
- Touched-file `oxlint --type-aware --deny-warnings`: exited 0 after those fixes.
- Initial adapter regression run caught the old no-selection paraphrase
  fixture, followed by that denied fixture's leaked terminal waiter. The
  fixture now provides its intended whole-source selection. The lead's full
  AI regression run supersedes that initial run: **132 tests, 651 assertions,
  24 files, zero failures, exit 0**, retained in
  `/tmp/quire-p73-ai-regressions.log`. This receipt is reused without rerunning.
- New adapter coverage checks Unicode words (including decomposed accents and
  CJK), sentence categories, pre-dispatch rejection, default preference
  compatibility, persistence across unrelated PATCHes, and no charge on
  rejection.
- Initial composed browser run reached real settings, native selection menu
  and HTTP 202 creation, then timed out waiting for obsolete terminal UI text.
  Diagnosis: its assertion expected `Agent run · succeeded`, while the current
  `RunProgress.tsx` displays heading `Agent run` and status `Result ready`.
  The retained backend receipt is succeeded version 4, with a pending
  `naïve` -> `refined` proposal and no page errors:
  `docs/evidence/p73-language-interactions/ff0d9f85-aa2a-46ff-873b-80b427e32c27/requests.json`.
  No provider failure or product stream regression was established.
  Explicit Refresh was removed from acceptance rather than used to bypass
  live behavior. The revised runner gates the real provider, observes the
  run's `running` state before release, and requires `succeeded` / `Result ready`
  afterward without Refresh. That live-progress sequence passed in the next
  run, which subsequently exposed the fixture-source mismatch described below.
  Failed runs remain failed evidence.
- Screenshot inspection also found two fixture issues: Playwright
  contenteditable `fill` replaced only rendered CodeMirror content, and
  resizing from desktop exposed the existing Project tools drawer over the
  mobile menu capture. Native Select All / Backspace / insertText now supplies
  the complete fixture source, and menu captures close existing drawers.
  Captures await fonts and compositing frames and disable screenshot-time
  animation. These are test setup/capture corrections, not product fallbacks.

## Final composed acceptance and cleanup

The final focused browser invocation below exited **0**: **1 test, 43
assertions, zero failures**, 46.86 seconds. Passing evidence:

`docs/evidence/p73-language-interactions/6f1d89d0-dfac-4102-a76e-2e98ed027026/`

- `receipts.json` retains both actual succeeded Agent runs and exact provider
  context: Synonyms sends UTF-16 `0..5`, `naïve`; completion sends `33..33`,
  empty selected text. Both runs first produced pending proposals. Source
  stayed unchanged until explicit acceptance, and accepted text persisted.
- The provider gate proves live `running` -> `succeeded` / `Result ready`
  transitions for both requests without Refresh. Normal UI updates work.
- Native source selections also distinguish one sentence from multiple
  sentences in the contextual menu. Disabled language settings persist across
  reload; selection and the explicit shortcut offer no actions afterward.
- `settings-{1440,390}-{light,dark}.png`,
  `word-menu-{1440,390}-{light,dark}.png`, and
  `review-{1440,390}-{light,dark}.png`: all **12** actual composed captures were
  opened and visually inspected. Menus wrap on mobile, review remains separate
  from source, both themes render, and no blank or overlapping changed surface
  was observed. Settings and review retain their existing bounded body scroll.
  Mobile captures use touch/mobile CDP emulation at DPR 3. The runner also
  asserts no document horizontal overflow for each capture.
- `errors.json`: empty page-error list.
- `cleanup.json`: task-owned `/tmp/quire-assembly-HGuJKG` removed. Async disposal
  completed for the application, context/browser and loopback provider.
  Subsequent bounded connection checks confirmed both application listeners
  closed: web `127.0.0.1:38739`, API `127.0.0.1:33619`.

One additional failed fixture run reached 39 assertions and both reviewed
operations, then raced settings reopening against reload. The helper now waits
for the real source surface and Assistant header before opening settings. Its
owned root was removed. This was a test readiness defect, not a product update
failure; the final passing run supersedes it.

The root's final typecheck, typed lint, build and matrix green receipts are
reused as instructed, alongside the passing full 132-test AI suite. No passing
check was rerun. No temporary data root, browser, listener or further work
remains owned by this task. Earlier failed captures remain diagnostic evidence
and are not represented as passing acceptance.

Exact focused browser invocation:

```sh
./node_modules/.bin/bun test --timeout 300000 ./tests/ui-editor/assistant/language-composed.test.ts
```

Exact initial adapter invocation:

```sh
./node_modules/.bin/bun test --timeout 120000 ./tests/adapters/ai
```

Touched typed lint covers accounts/preferences routes, AI context/store/provider,
Assistant files, SourcePanel/LanguageActions, editor assembly/shared contracts,
and language/conflict/review/tools/composed-browser tests. No warnings or errors
were suppressed. No commit was created.
