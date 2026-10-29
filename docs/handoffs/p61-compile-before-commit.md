# P61 compile-before-commit

FINAL, October 28, 2026. P60 N10 is implemented and verified within the
explicit user-commit boundary. P59 remains the preceding integrated gate;
the parent owns the next global check refresh.

## Behavior and integration

`services/core/git/actions.ts` now uses the existing identity preference
reader after authorization and the committed-receipt lookup. A new explicit
commit compiles when either the saved `compileBeforeCommit` preference or
the request's `compileFirst` is true. A request containing explicit false
cannot bypass saved true. Saved false preserves per-commit opt-in.

The preference is sampled at admission of a new request, not continuously
through its compile. A preference change after that sample applies to later
new admissions. This is a user's mutable preference, not an immutable
organization security policy. An already committed idempotent receipt
returns before preference sampling and does not compile again.

The existing immutable staged-tree workspace, exact tree comparison,
source revision checks, branch fences, permission rechecks and atomic
receipt publication remain in the same execution path. Internal source
checkpoints/autosaves do not call this new preference gate.
`services/core/git/compile.ts` required no edit.

The local Git panel prop is:

```ts
type GitPanelProps = SharedGitPanelProps & {
  readonly preferences?: Pick<Preferences, "compileBeforeCommit">;
};
```

`GitPanel.tsx` shows a checked, disabled compile checkbox and a saved
preference explanation when required; submission explicitly includes the
effective true value rather than relying on a disabled form field.
With saved false, the checkbox remains an optional per-commit choice.
The sibling supplied `<GitPanel {...common} preferences={preferences} />`
in `editor/index.tsx`; this child did not edit that file or account preferences.

## Commands and results

All commands ran from `/home/norman/Repos/Quire` with
`export PATH="$PWD/node_modules/.bin:$PATH"` and repository Bun 1.4.4
(`38afee6c8`). Only the scoped commands below were run, not the broad root suite.

```sh
bun test tests/core/git/compile.test.ts tests/core/git/preference.test.ts tests/core/git/fences.test.ts
bun test tests/core/git/compile.test.ts -t "source changed after gate admission"
bun test tests/ui-product/commit-preference/native.test.ts
tsc --noEmit -p tests/core/git/tsconfig.json
tsc --noEmit -p tests/ui-product/commit-preference/tsconfig.json
oxlint --type-aware --deny-warnings services/core/git/actions.ts apps/web/src/features/editor/git/GitPanel.tsx apps/web/src/features/editor/git/types.ts tests/core/git/compile.test.ts tests/core/git/preference.test.ts tests/ui-product/commit-preference/native.test.ts
```

Evidence is under `docs/evidence/p61-commit-preference/`:

- `backend-verified.log`: 11 passed, zero failed, raw
  `P61_BACKEND_EXIT=0`, beginning 19:59:57Z. Covers saved true with explicit
  false for valid/invalid real TeX; saved false with explicit opt-in;
  default false without a compiler; receipt replay after enabling the
  preference; Viewer HTTP 403; exact staged tree despite invalid unstaged
  source; source revision race; fence expiry; permission revocation; and
  atomic receipt recovery.
- `race-verified.log`: the final branded-ID test correction passed alone,
  raw `P61_RACE_EXIT=0`, 20:01:51Z through 20:02:30Z. Actual successful
  compiler job `d8731d7e-693c-4dc5-95b0-aed99779f89a` compiled tree
  `sha1:c36f131fea97571dcbeeac98240b01b61e1e5a1f`; a completed concurrent
  live source write then caused HTTP 409 `STALE_VERSION`
  (`Expected 2, current 3`), with no named commit or receipt.
  The test wraps enqueue only to complete that real write before returning
  the real job; no compiler result is fabricated.
- `native-stable.log`: one passed, zero failed,
  `P61_NATIVE_EXIT=0`, 20:01:52Z through 20:02:47Z. Ten relevant
  source/test/config pre/post SHA-256 pairs all match.
- `static-clean.log`: final scoped core/UI types and touched-file lint
  each returned raw exit 0. Language-server diagnostics on the production action,
  Git panel and final native test were also clean. Scoped `git diff --check`
  returned zero.

Core Git fixtures intentionally use the existing frozen
`2026-10-26T12:00:00.000Z` service clock; actual execution UTC is recorded
separately. Native fixtures use actual application UTC.

## Actual native workflow

The full native application used web origin `http://127.0.0.1:41745` and API
origin `http://127.0.0.1:34917`, not port 5173. The user checked and saved
"Compile before every commit" in `/settings/git`, then opened the real
project Git panel. Source changes used the real editor, realtime save
acknowledgements, HTTP staging and HTTP commits. Job subscriptions were
armed before each action; DOM subscriptions were used instead of sleeps.

Invalid staged source contained `\MissingPreferenceCommand`. The commit
returned HTTP 409 `COMPILE_REQUIRED`, request
`74630489-cda9-4a88-9249-8e1f8bba31f1`, and real failed job
`cd333088-a84a-4397-8aae-335eb172137e`. Named head stayed
`sha1:dfae6e28f4cbdefbe3f2619f7722c92bcaa1a6f7`; its staged hunk remained
selected. The test explicitly unstaged those immutable failed bytes,
corrected the source, and staged the correction.

The corrected commit returned HTTP 202, request
`f527c803-5fad-4603-b4c4-037a43a3a2e1`, action
`96dee122-83ff-4482-9793-b5d5ed0dc266`, named commit
`sha1:a2d259a9edd275e45675e47a34894c9c38358d20`. Real successful compile job
`8db107ef-f0ee-4c65-bcb2-998ea42e0bef` covered tree
`sha1:e82161c26eac7abc2b3334b70d4b5ec5fa6b78df`, asserted equal to
`main^{tree}`. The working/staging areas were clean after success, and one
atomic committed receipt existed.

The raw native log retains complete source strings, source hashes, job and
artifact IDs, HTTP response bodies, request IDs and idempotency keys.
Playwright returned null for `request.postData()` in this environment;
the evidence leaves it null rather than inventing captured request bytes.
The independent backend requests explicitly send `compileFirst: false`
with saved true and retain that actual request choice in their receipts.

The four captures in
`a721bec0-cc99-4aea-91f4-2b0897dfddae/` were individually opened and inspected:
`1440-light.png`, `1440-dark.png`, `390-light.png`, and `390-dark.png`.
The checked disabled gate, explanation and commit button are visible in
both themes at both widths without overlapping controls. Mobile uses the
native Changes tab; desktop also shows the real diff and history.

## Hashes and cleanup

Initial pre-edit SHA-256 values:

```text
571e0c9eac8582fc7a9569ff5bbdbae1f97d12cc1abcbc421dd90ed439449768  services/core/git/actions.ts
4eb938420ccf0be2172550ce43fd82da7b8bb04eb9636319179d46f8483a8b3f  apps/web/src/features/editor/git/GitPanel.tsx
ee62a4f2cf89c8c1fbe265b7d6fc81429eb60421eb4ce102a09675a3b71003cb  apps/web/src/features/editor/git/types.ts
```

Final production hashes, matching every final runtime pre/post pair:

```text
6a2c6b2b97a6573472373d02bba4c1ba17d7a37e3ffbbf92d97f1dff851cb3d1  services/core/git/actions.ts
1db12c057adf42256fe6e48e91db3203d0202a52ad4d2c674df83988675da162  apps/web/src/features/editor/git/GitPanel.tsx
d611c2a17e4c7870a68c839c5fbde5bd49e40d660b8932879f28b821a6034823  apps/web/src/features/editor/git/types.ts
7912f6678f5877f9cbcf4b96fd199fc20c116c8580d608bce45d1869e0753f75  services/core/git/compile.ts (unchanged)
```

The final native fixture removed `/tmp/quire-ui-editor-YX6aMJ`, stopped its
web/API listeners and compiler/application resources, closed its browser
context and disconnected its browser; the exact cleanup receipt is at
20:02:47.642Z in `native-stable.log`. Recorded backend fixture roots were
independently checked absent after disposal; see `backend-cleanup.json`.
The diagnostic tail monitor `mon_QJ0W3HZP2TG72HZC` was explicitly killed.
The other completion monitors are one-shot and exit after their sentinel.
No project-repository history commit, deployment, live-service change or
original-input edit was made.

Earlier failed attempts are retained in `backend.log`, `backend-final.log`,
`native.log`, `race-diagnostic.log` and earlier static logs. They exposed
new test assertion/API mistakes, a comment-only blank-document race fixture
that produced no PDF, and a native retry that had not replaced immutable
failed staged bytes. The corrected final workflow explicitly unstages and
restages the correction. A test-only `IdSchema` typing correction occurred
during the 11-test run: production hashes stayed fixed, that race test then
passed separately, and the final native run has all ten pairs stable.
No failing existing test was weakened. The native sample's existing
bibliography warnings remain visible in successful job receipts.

Global typecheck/lint/build/matrix refresh, deployment and literal-origin
acceptance are outside this child handoff and remain with the parent.
