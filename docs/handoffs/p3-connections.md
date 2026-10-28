# P3 account Git and connections

Owner: `st_01a17d04`. October 27, 2026. Status: FINAL (producer).

## Acceptance

`bun run test tests/ui-integrations` passes on project-local Bun 1.4.4:
**6 tests, 0 failures, 163 assertions, 102.97 seconds**, exit 0.
The actual OAuth grant is revoked upstream; no provider parser was weakened.
Owned strict TypeScript, type-aware oxlint and the five-file draft guard also
pass: `static-project-local-b.log`, `CHECK_EXITS types=0 lint=0 guard=0`.

Final packet:
`tests/ui-integrations/evidence/project-local-1.4.4-acceptance-b/`.
`native-local.log` SHA-256:
`749b05c0a723c2ade5e847ec30f4a8b0f6f4c637156deb4379f138d61e430940`.
`../static-project-local-b.log` SHA-256:
`c1a3d3fe01277e52836d8c879b588fbad6dfd44ed50ee8576836197c6d373951`.
The local binary's measured SHA-256 remains
`10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235`.
Bare global `bun test` is obsolete; the parent owns the project-local pin.

The 565-entry source manifests have aggregate hashes
`7e484bb12d54959754de8b6a08e64a8d60fac14ccf4eb81a211d5848b649f3b0`
before and
`ef5bc64bce1baf074b4efa97bba3785451088d3e3531f99ffc4bd225b9ad6f47`
after. Entry-by-entry comparison finds exactly one concurrent change:
`services/operations/backups/restore.ts`, outside these account cases.
Account UI, shared HTTP transport and runtime source entries are unchanged.

The parent corrected body framing in `services/adapters/shared/http.ts`
and added real UTF-8/binary DELETE regressions in
`tests/adapters/shared/http.test.ts`. Parent-reported `bash_176` passes all
33 shared HTTP/remote-Git tests and scoped lint; these are not rerun here.
The preserved `project-local-delete-body-probe.log` records the prior
26-byte request arriving empty without explicit length and intact with it.
The earlier five-pass/one-fail receipt remains in
`project-local-1.4.4-acceptance-a/`. No blanket Bun root-cause claim is made.

All three passing-run roots reach `CONNECTIONS_CLEANED`; the final artifact
audit independently confirms their exact temporary directories are absent.
Browser page errors are empty. Console errors are retained and confined to
the intentional invalid-credential 503 and policy/cursor 409 cases.
No live external writes, out-of-bound producer edits or commits were made.

## Visual review packet

`captures/` contains 26 fresh full-page browser frames, four original-baseline
before/after pairs and four diff JSON reports. `capture-inventory.txt` records
their decoded PNG dimensions; its SHA-256 is
`af302bf67d6410a201c84aa565de5e96b685029f2e91c7a0034923acc21acc5a`.
Desktop frames are 1440 pixels wide; 390x844 mobile contexts use DPR 3 and
produce 1170-pixel-wide images. Paired images double those widths.
The four original `*-before.png` frames remain preserved in the earlier
`bun-frozen-comparison-20261027-a/baseline-captures/` directory.

Review `connections-unconfigured-*` pairs in both widths/themes;
`zotero-form-*`, `generic-form-*` and `connections-offline-*` matrices;
`zotero-invalid-*`, `zotero-saved-*`, `generic-removal-*` and
`connections-paged-*`; and the denied/stale, cursor-conflict and four
`dropbox-synced-*` frames. The added required content changes page height;
pixel diffs are review aids, not a claimed pixel-identical acceptance score.
The producer inspected rendered desktop/mobile and light/dark states,
including fresh passing-run generic removal and mobile Dropbox success.
Labels, focus, masked fields, 44-pixel controls and document-only scrolling
are exercised without horizontal clipping.

Per the parent's explicit assignment, independent UI acceptance belongs to
the downstream verifier in `dag_b6969fd4` after producer completion. This
FINAL packet is ready for that review; it does not invent an independent
account UI sign-off. The parent's separate 22/22 assistant receipt supports
shared native-descriptor recovery, not these account visual claims.

## Implementation brief

Existing reference: `docs/discovery/design-source/16-settings.source.html`,
Git section, and `docs/discovery/design.md`. Original board and research remain
untouched. Existing `account.css`, `styles/tokens.css`, `Panel`, `Button`, and
`Field` supply the reusable design system; no new brand or palette.

Primary action: Save changes in the existing Git preferences section.
Connection admission, tests and policy actions use neutral peer controls.
Information priorities: provider availability and exact requirements; saved
connections and actions; scoped Dropbox policy and synchronization.
Required content: GitHub, GitLab, Zotero, Mendeley, Dropbox, generic Git;
provider reason/state, connection label/state/version, paging, test and removal;
Zotero label/access token; generic label/repository URL/username/secret;
project and organization policy scope, enabled/effective state/version;
project sync selection and durable result; existing Git tokens, SSH keys,
compile-before-commit preference and Save changes.
Left out on purpose: illustrative connected counts, saved-secret previews,
decorative badges, invented readiness or synchronization, arbitrary ID inputs.

Layout: account connections - ordered provider, grant and policy tasks -> stack
(https://github.com/changeroa/StyleGallery/blob/main/patterns/stacking/stack.md);
scroll owner: document; anti-patterns: internal vertical scrollers, reordered
focus flow, fixed-width controls that overflow, pattern-owned brand styling.

Baseline cases fixed before production edits: unconfigured/empty at
1440x900 and 390x844, both light and dark, full page. New credential/policy/
operation states are independently verified after implementation.

The hard write boundary excludes shared account files, entrypoint and manifests.
The frontend skill's automatic React tooling installation would modify those
files, so that instruction is explicitly inapplicable within this assignment.
No tools are added to the production bundle.

## Owned exports and assembly

`git.tsx` retains `GitSettings(SettingsProps)` and mounts `Connections`,
`DropboxSettings`, existing `Credentials`, and existing `PreferenceForm`.
`connections.tsx` exports `Connections` and the complete paged
`currentConnections` reader. `connection-forms.tsx` exports `ConnectionForm`
and `CredentialProvider`; `dropbox-policy.tsx` exports `DropboxSettings`.
`integrations.css` uses existing `--q-*` tokens only.
The existing account route imports `GitSettings`; no router or shared account
file changes are required.

Capabilities addressed: **D16**, account grant portion of **I42a**, **I43**,
**I44a/I44b**, **A52c**, and the explicit **Q07** GitLab/dark-theme addition.
This does not claim the editor's remote-Git UI, complete reference-library
workflows, new commercial parity, or live external service acceptance.

## Actual contracts

- `connectionAvailability`: each provider's current enabled/state/reason.
  Missing registrations, credentials, base URLs or tools are shown verbatim.
  There is no assumed readiness or illustrative connected-project count.
- `connectionStart`: configured GitHub, GitLab, Mendeley and Dropbox only,
  with `/settings/git` as the return destination.
- `connectionCredentials`: dedicated Zotero `{accessToken,label}` admission.
  `gitCredentials`: verified `{label,url,username,secret}` admission.
  Secret controls are password fields with `new-password`, disabled while
  submitting, and reset before any post-admission reload.
- `connectionsList`: 20-item progressive paging. Version-sensitive test/delete
  first reads all current pages, rather than reusing an old displayed version.
  Generic Git removal explicitly forgets the local encrypted credential and
  does not revoke the independently managed upstream credential. Zotero
  explains its manual upstream key revocation requirement before disconnect;
  OAuth removal requires the adapter's actual provider revocation.
- `projectList` (owned active projects) and `organizationsList` (accessible
  organizations) supply paged scope choices. No arbitrary ID field is used.
  `dropboxPolicyGet/Put` alone determine current authority, version and
  effective deny-wins state. Scope selection persists per account.
- `connectionCursor`: read the actual action/project cursor and current
  grant version immediately before `connectionAction`. Initial sync, repeat
  sync, and project disconnect use actual durable operations. Operation IDs
  persist per project and reload through `operationGet`; typed result parsing
  displays completed sync/conflicts or disconnect, never raw result JSON.
  Disconnecting project sync is explicitly distinct from revoking the account
  provider grant.
  Cursor/version 409 responses trigger a fresh typed cursor read and an
  explicit-retry notice; no mutation is retried automatically. A real
  competing authorized HTTP writer exercises this fence without editing
  cursor SQL or replacing a server response.

The parent closed cursor discovery during startup. There is no remaining
missing-cursor placeholder or no-op synchronization control.

## External configuration requirements

The UI displays the current adapter's exact requirement string, not a fixed
parallel inventory. The production requirements remain:

- GitHub/GitLab: operator provider configuration, registered OAuth client ID
  in `model`, encrypted OAuth client secret, appropriate provider base URL,
  exact public callback registration, repository consent and any required
  organization approval. Generic Git additionally needs a reachable allowed
  repository and its independently managed credential; credentials are bound
  to the canonical repository URL.
- Zotero: operator configuration with provider API base URL and a dedicated
  user API key with the required library access. It is not OAuth 2.
- Mendeley: operator configuration/base URL, registered application client ID
  and secret, exact callback registration and user grant. The application does
  not invent a usable Mendeley connection without these prerequisites.
- Dropbox: operator configuration, encrypted app secret,
  `QUIRE_DROPBOX_APP_KEY`, `QUIRE_DROPBOX_APP_FOLDER=Apps/Quire`, a Quire-owned
  scoped App Folder registration named Quire, exact callback registration,
  applicable production approval and explicit user consent. Git CLI is
  required for source checkpoints; the runtime supplies encrypted secret
  storage. Organization denial wins over project allowance.

No live credentials were provided or live external writes attempted.
All browser provider traffic uses owned loopback protocol providers.
The accepted provider receipts in `p2x-launch-recovery.md`,
`p2x-generic-credentials.md`, `p2x-dropbox.md` and
`p2x-http-admission.md` remain the native protocol evidence; unrelated 201-test
adapter verification is not rerun or relabeled as new account evidence.

## Fixture and verification history

`tests/ui-integrations/application.ts` uses the canonical same-origin
`startEditorWeb` and `authenticateApi` fixtures, real application native
modules and the actual aggregate adapter factory. It owns factory start/close.
All three owned browser launchers use `startEditorBrowser` and dispose its
wrapper. The parent attempted, then reverted a Node-owned browser-host
experiment because `chromium.connect` timed out under Bun 1.3 despite host
readiness. The canonical helper currently uses `chromium.launch`; wrapper
reuse is lifecycle ownership, **not an FD fix**.
Its scheduler subscriptions use a controlled event source, so unrelated
wall-clock delivery/synchronization ticks do not race account UI assertions.
The accepted scheduler integration receipts remain the scheduler proof.
Browser contexts are isolated, mobile contexts use touch/mobile emulation
and DPR 3, and desktop contexts use 1440x900.

The following failed checkpoints remain retained, not filtered or overwritten:

- `initial-run.log`: exact native EBADF request/stack plus the first OAuth
  harness navigation race. No retrospective whole-input fingerprint is
  invented for this initial run. The shared runtime owner received the stack.
- `native-second.log`: pre-run input digest and the implicit select-label
  mismatch. Scope data was present; explicit label/for associations fixed the
  actual control rather than weakening its locator.
- `dropbox-diagnostic.log`: rendered text and failed-frame evidence proving
  the scope list existed.
- `native-current.log`: the UI policy workflow reached deny-wins correctly;
  a direct test mutation omitted Origin and was correctly denied. Test
  mutation headers were corrected, including the repository-binding
  negative case, which now asserts `GIT_CREDENTIAL_SCOPE` rather than merely
  accepting an unrelated 403.
- `native-final.log`: Dropbox passed and all unconfigured matrix captures
  completed, but fixture teardown exceeded the test deadline. The test then
  lost its shared browser. The isolated root
  `/tmp/quire-ui-integrations-QUph44` was explicitly removed. Controlled
  scheduler events now avoid unrelated timed work. The parent separately
  identified direct Playwright launch under Bun 1.3 as an FD-corruption
  candidate; its subsequent Node-host experiment was reverted. This checkpoint
  alone does not prove which of those concerns caused the teardown failure.

No failing assertion was removed, skipped or softened.
The unconfigured matrix is now an independent `availability.test.ts`, owning
its application before its browser and disposing the browser first. It no
longer creates a second application inside a shared live-browser suite.
`native-isolated.log` closes every root and reports five passing tests; its
remaining generic connection test returned HTTP 500. The unchanged workflow
passes in `generic-diagnostic.log` (one pass, 13 assertions), including actual
upstream revocation. This is not claimed as a fix for an intermittent native
failure. Complete API response logging is retained for the next full run.
The standalone no-excuse skill checker could not resolve TypeScript from its
external skill directory despite the installed project compiler. The owned
strict TypeScript and type-aware oxlint checks are the actual static gates.

## Retained recovery history

### Frozen runtime comparison

Packet: `tests/ui-integrations/evidence/bun-frozen-comparison-20261027-a/`.
The supplied official Bun 1.4.4 binary was checksum-verified as
`10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235`.
No global binary, PATH, manifest or runtime pin was changed. The exact command
was `bun test tests/ui-integrations` for the default 1.3.14 control, then
`/tmp/quire-bun-comparison-eNdWJg/bun-linux-x64/bun test tests/ui-integrations`
once for the conditional 1.4.4 comparison.

`source-before.sha256`, `source-after-baseline.sha256`, and
`source-after-comparison.sha256` compare byte-for-byte equal. Each has aggregate
SHA-256 `4f052cd0ee679cb5bddbb0f28fab70654ceb5c8d1e22188e5a1525ae9c157eee`.
The manifests cover owned inputs and shared application/runtime source.
The sequential runs have distinct `bun-1.3.14.log` and `bun-1.4.4.log`, with
`baseline-captures/` and `comparison-captures/`; no suites wrote concurrently.

- **1.3.14:** five passing tests, two failures, 155 assertions, exit 1.
  Zotero's native admission failed with `EBADF: bad file descriptor, close`
  at `native-admission.ts:39:26`; generic Git, including upstream revocation,
  passed. The configured suite's cleanup hook then hit its 30-second deadline
  before application cleanup. Dropbox and unconfigured roots closed normally.
- **1.4.4:** five passing tests, one failure and one unhandled error,
  161 assertions, exit 1. No EBADF appeared in this receipt. Generic admission,
  repository-scope rejection, testing and local forgetting succeeded. The
  subsequent GitHub revocation failed when the existing loopback provider's
  `request.json()` rejected `Unexpected end of JSON input` at
  `tests/adapters/remote-git/provider-fixture.ts:86:81`; the application returned
  `PROVIDER_REVOCATION_FAILED`/502. This does not establish what bytes were
  present on the wire or prove a Bun root cause. All three roots closed.

The 1.3.14 process had exited and its web port 45717 had no listener before the
exact owned `/tmp/quire-ui-integrations-NkwkCK` root was explicitly removed.
That manual resource cleanup is not a passing test receipt. Other agents'
web processes were left untouched. No second 1.4.4 comparison was attempted.

Owned strict TypeScript, type-aware oxlint and the five-file draft guard all
pass in `static-current.log` (`CHECK_EXITS types=0 lint=0 guard=0`).
The corrected mobile saved-label regression passes in
`mobile-label-current.log`: one test, 34 assertions, normal cleanup.
Producer inspection of the frozen comparison's desktop dark Zotero form,
mobile light generic form, desktop light Dropbox success and mobile dark
unconfigured page confirms the corrected labels, masked controls and
document-owned scroll without horizontal clipping. Independent acceptance
remains the parent's gate; neither failed native suite is relabeled green.

`native-socket-cleanup.log` runs against the parent's actual upgraded-socket
shutdown fix (parent receipts bash159/b160, regression and scoped lint).
Its pre-run input SHA-256 is
`8a4702bd854334167ac4ce15a8ab78465996fbb657d69efd4463ac4e055b66df`.
The generic admission browser request to `/api/connections/git/credentials`
returns **HTTP 500 with an empty body**, no result envelope or request ID,
and no corresponding native `request.failed` entry. Other runs reached the
same untyped failure later during list/test. All browser error messages and
the empty HTTP response are retained, not filtered.

The canonical `startEditorWeb` drains Node/Vite stderr into a private
`diagnostic` buffer and surfaces it only when startup fails. Retaining that
runtime proxy diagnostic was considered before the native error stack became
available; it is no longer the next requested diagnostic. This lane does not
edit the shared fixture or guess the original empty response's cause.
These failed checkpoints were not treated as FINAL acceptance; the passing
project-local receipt above supersedes them without removing their evidence.

`native-boundary-current.log` subsequently resolves the uncertainty: generic
connection testing returns typed `INTERNAL_ERROR` with request ID
`9b127c0b-7075-4d40-98ff-980aeb5bad06`. Its preserved server stack is
`EBADF: bad file descriptor, epoll_ctl` at
`packages/runtime/src/native-admission.ts:19:61`, through `acquire`, `writer`
and `router.ts:118:45`. This is a native admission failure, not evidence of a
provider rejection. All three application roots reach `CONNECTIONS_CLEANED`.
The run reports four passing and two failing tests: native Git admission and
the producer's new mobile label geometry check. The latter exposed shared
CSS overriding the first compact rule; its selector specificity is corrected,
with a focused real-browser verification retained in `mobile-label-current.log`.

The owned API listener now logs unexpected response bodies and unhandled
`handle()` rejections, then rethrows unchanged. This distinguishes Bun's
default empty 500 from the Vite proxy without modifying either shared layer.
`native-api-boundary.log` stopped before native execution because concurrent
`services/core/base/access-routes.ts` edits produced four TS2345 errors;
the subsequent native-only diagnostic is retained separately.

Producer capture inspection also caught compact saved labels compressed
beside two action buttons. `.connection-grants` now gives labels a full row
at the existing 650px breakpoint, and the mobile Dropbox capture checks that
the real label receives at least 80% of its row width. Default evidence
contexts explicitly use 1440x900/light; mobile captures override that with
390x844, touch/mobile emulation and DPR 3. Historical 1280-wide failure frames
are not relabeled as new acceptance evidence.

## Post-write review

Production TSX files have 15/14, 122/119, 54/53 and 184/180
physical/nonblank lines for composition, connection lifecycle, credential
admission and Dropbox settings, respectively.
Each has one responsibility. Typed client schemas parse API boundaries and
typed Dropbox result schemas parse operation metadata. No type escapes,
suppression comments, new logging framework, defensive provider-success
fallbacks or one-use helper layers were introduced. Provider dispatch is
exhaustive; current-page readers have multiple actual consumers. Function
signatures remain within three parameters apart from ordinary component
props. Mutation responses are trusted; reloads update the displayed grant
list, not a redundant deletion assertion. Names express positive state.
Tests drive real HTTP, OAuth and React rather than pinning copy.

The largest test file has 207 physical and 202 nonblank lines, including its
BDD comments. The unconfigured matrix has its own 38-line fixture/test file.
No production file exceeds 200 nonblank lines.
All four production TSX files have zero LSP errors. The CSS language server
would require installing Biome, outside the hard manifest boundary; no install
was attempted. CSS is checked by the draft guard and real rendered captures.
