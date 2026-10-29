# P27 native usability independent verification

October 28, 2026. Auditor: `st_01a181e1`. **INTERIM: producer watches pending; not a combined acceptance artifact.**

## Current bounded verdicts

| Lane | Verdict | Boundary |
| --- | --- | --- |
| Custom environment | FAIL / not accepted yet | Required producer handoff is absent. Retained native integration receipt fails before promotion; no completed signed worker PDF/revocation proof is accepted. Creation watch `mon_SWGD6D10ARGYMTQD` is armed. |
| Diagnostic AI | PASS for the original scoped UI delivery, P28 revision guard and selector follow-up | Separate settled receipts establish the backend guard and corrected selector; no historical receipt is represented as a combined current suite. |

## Prioritized findings

1. **P1, custom environment acceptance is incomplete.** `docs/handoffs/p27-custom-environment.md` did not exist at inspection. `docs/evidence/p27-custom-environment/installed-observed.xml` records 1 failure, 17 assertions, 206.53 seconds: `admissionBrowser` expected the not-admitted option to be disabled but observed false. The independently opened `6e1aaf11-98ce-40ce-95ef-b10edb41e63a/not-admitted-picker-first.png` shows the native create dialog; its observation JSON reports the custom option disabled and `selectable:false`. Current source also disables it. This inconsistency needs the producer's settled explanation and passing native receipt, not a guessed pass. No `proof.json`, custom PDF, or completed cleanup packet was available in this lane.
2. **Resolved by P28: diagnostic revision collection.** The separate FINAL parent receipt and raw regression/browser logs have now been inspected. Context collection and source finalization acquire the same `quire:accounts` transaction lock (`services/core/base/source-records.ts:55`), and context collection compares the current branch with the diagnostic's immutable compile snapshot revision. The diagnostic ID supplies the precondition; no duplicate client expectedRevision field is needed. This conclusion does not rely on old P27 UI receipts.
3. **P2, policy availability is enforced at Send, not reflected by the diagnostic card.** `CompileLogs` disables for edit capability, loading and editable file linkage, not effective AI policy. Actual unconfigured, policy-off and disabled responses prevent provider transmission. This is an honestly disclosed capability-read gap, not an authority bypass.
4. **Resolved P3, selector-summary divergence.** The original `AssistantContext` allowed changing the ID while retaining the original selected-card summary. Current source disables the selector while a diagnostic intent is active and explains clearing context to choose another. The separately settled functional and capture-only receipts below verify this change; the original P27 manifest remains historical for this file.

## Settled selector follow-up

Parent receipt `docs/evidence/p28-diagnostic-revision/selector.log` was read directly: one pass, 35 assertions, 80.72 seconds. The existing workflow explicitly asserts disabled selection during the card-specific intent and enabled selection after Clear. The parent records scoped strict TypeScript and typed lint and a settled exit 0 from `mon_DEDJ470MRNR034TF` / `bash_386`.

The subsequently settled capture-only correction is separate: `selector-capture.log` records one pass, 19 assertions, 59.11 seconds, with parent-recorded static checks and exit 0 from `mon_7N0A36YQZBQ6FC20` / `bash_387`. All four `eda5947b-db1f-4245-aa37-19ec1c64056c/selector-{1440,390}-{light,dark}.png` images were opened independently. The disabled diagnostic selector, clear-context instruction and separate unchecked consent controls are visible without overlap at both widths/themes. This capture-only test does not repeat accepted provider/PDF generation. Original context captures did not show the below-fold selector and are not used to prove it.

Exact owned roots `/tmp/quire-assembly-hx4nRD` and `/tmp/quire-assembly-KJeSlc` independently checked absent with exit 0. Latest hashes: Context `50dbbe40f266dfd86d3a71f414acd974f0054054d233f333ecf565c5ca6f143c`; workflow test `9b6248690cde55c16a7dd9af9c5fb06b18240b409e2f13cc94b2ee374c208f58`; selector log `bf16932db2e53c65a2d142c3118f952ee81e4fbe57b910ce21c1b7287b6f14d0`; capture log `fb6dfbd5d4c6099782f147e9aacb673955e55f159af49b1d8013911ebb9a6b46`. Parent handoff after this settled follow-up hashes to `bd7793fec01ae1d04da916d41c80d403beecbcd48cbf0d06ce5cb9672532c0e5`; the earlier P28 hash below is retained as earlier provenance, not its latest bytes.

Admission remains pending a FINAL producer packet. A watcher deadline is not an admission test failure; persistent artifact watch `mon_CH18VN6NA5EG5VPM` replaces the temporary watch for this audit. The live producer's installed/static runs are not duplicated.

## P28 separately accepted revision proof

`docs/handoffs/p28-diagnostic-revision.md` is FINAL. Its original `docs/evidence/p28-diagnostic-revision/red-stale.log` retains the real regression: stale context returned 202 instead of expected 409. `green.log` records eight passing tests, 51 assertions, 7.87 seconds. The new test exercises persisted snapshot/log state and the actual source mutation endpoint, asserting `AI_DIAGNOSTIC_STALE`, zero provider calls and zero reserved/used usage. The parent FINAL receipt supplies settled exit 0 for monitor `mon_EF03722H1EN0TQPY` / `bash_384`, including scoped TypeScript and typed deny-warning lint; the raw log itself does not print command exits.

`browser.log` records one actual diagnostic-to-reviewed-fix-to-native-PDF workflow pass, 33 assertions, 62.25 seconds. Parent monitor `mon_H7RZFKGP9VZ4DQRF` / `bash_385` supplies settled exit 0. Every affected image in `85195bc5-2cdc-49b9-b430-32b4364a9b6d/` was independently opened: the 12 diagnostic/context/proposal matrix images plus source-link/PDF images. The manuscript visibly renders alongside the accepted replacement. Exact roots `/tmp/quire-assembly-nBrtaA`, `/tmp/quire-p2x-ai-QIbalj`, and `/tmp/quire-p2x-ai-v6Hm46` independently checked absent with exit 0. Collection is revision-consistent under the transaction/writer lock; the branch may change afterward while the provider runs.

P28 handoff SHA-256: `d87fc1aa1e7cd9843865f2f72ee640a37625c4b2756bd653cf96cd886ce0cabb`. Receipt SHA-256 values: green `b39efe9b09b80842abe88cd491246ddc0d2b6a7877af55440554642672be521f`; red-stale `649b1dfb257d73af5dcaee0ed2d493f2413157589151983e2e52e52e4e24d082`; browser `8fe6750694b2be6f55a8a314e98ce79cda1bc87784f15aeed8359a208d50e204`.

## Diagnostic original receipt provenance

Producer: `st_01a181c7`, `docs/handoffs/p27-diagnostic-ai.md`, FINAL scoped handoff. Original receipts remain under `docs/evidence/p27-diagnostic-ai/`; they were read directly, not regenerated:

- `tests-reviewed.log`: project-local Bun 1.4.4 (`38afee6c8`), 3 pass, 0 fail, 53 assertions, 122.71 seconds, `RAW_TEST_EXIT=0`. Denial packet `434aef8f-494f-4c71-a47a-18a1383c44a7`; late-result packet `45286a48-cfe7-4eb3-b36c-14baca5abafc`; workflow packet `c89a2f20-1211-491a-aee0-947b2b158a0a`.
- `captures-settled.log`: changed workflow capture verifier only, 1 pass, 0 fail, 33 assertions, 70.91 seconds, `RAW_TEST_EXIT=0`. Packet `45709bfd-47c3-48a6-916e-0135d1095d18`, native origin `http://127.0.0.1:33601`.
- `types-settled.log` and `lint-settled.log`: raw exits 0 for the scoped TypeScript and typed deny-warning lint commands recorded by the producer. These are not root builds.
- `sources.sha256` matched producer-owned UI/test files and the handoff at first inspection. Later selector-lock work changed `Context.tsx`, making that manifest historical for this file. `evidence.sha256` was checked against retained artifacts. Initial tee recovery is explicitly a reconstruction, not an original complete log.

The native test inserts an undefined command through the actual mounted editor and compiles it. Opening the actual error card sends nothing; diagnostic consent defaults false. Missing diagnostic consent and missing independent provider terms consent send nothing. The provider receives precisely one selected `main.tex` and the compiler's recorded byte-sliced excerpt. Source stays byte-for-byte broken before approval, including after opening the source link. Accepting applies only the reviewed replacement, then actual native compilation succeeds and PDF.js renders the resulting page. The opened PDF capture contains the manuscript, not an empty canvas.

The denial test checks actual `AI_UNCONFIGURED`, `AI_POLICY_DENIED`, and `AI_DISABLED`, zero provider requests and unchanged source. Disabled-provider state is seeded directly in storage because the provider PUT contract does not expose disable; it proves that backend state, not an operator disable UI. Viewer actions are disabled. The gated late-result test changes source in another mounted editor, subscribes to its save event, releases the provider and observes proposal discard without applying source. The second stale send makes no second provider request.

The provider is an owned loopback protocol fixture. Nothing here proves live external vendor availability or deployment.

## Independently opened diagnostic images

All 12 selected `45709bfd-47c3-48a6-916e-0135d1095d18/{diagnostic,context,proposal}-{1440,390}-{light,dark}.png` files were opened individually, as were `source-linked-unaccepted.png` and `accepted-real-pdf.png`. The diagnostic action is visible at both widths, context wraps within the mobile viewport, and review before/after plus approval/source controls are visible at both widths. Long context forms extend below the captured viewport and require their existing scroll area; these images do not claim every lower consent control is visible simultaneously.

Also opened: `434aef8f-494f-4c71-a47a-18a1383c44a7/{disabled,viewer}.png` and `45286a48-cfe7-4eb3-b36c-14baca5abafc/late-proposal-discarded.png`. These visibly show the actual denial/read-only/discard states. No repeated-image ambiguity appeared in these reads.

## Cleanup and retained failures

The diagnostic fixture uses an awaited disposable stack for its own context/browser, provider, application/API and web server. The three suite roots `/tmp/quire-assembly-158rUI`, `/tmp/quire-assembly-MTx1QB`, `/tmp/quire-assembly-piQ5DF` and settled capture root `/tmp/quire-assembly-Ta1MZw` each have original `cleanup.json` receipts with `absent:true`. An independent exact-path absence check returned 0; no resource was deleted by the auditor.

Original diagnostic failures are retained and were read: `types-initial.log` exits 2 on nonexistent `version`; `lint-initial.log` exits 1 on two shadows; `tests-final.log` exits 1 on an invalid disable request; `tests-verified.log` exits 1 when the pending proposal failed to survive the source-link lifecycle. Later scoped successes do not erase these receipts. Custom `installed-observed.xml` remains a failed receipt.

## Source and validation limits

`docs/evidence/p27-native-usability-verification/current-sources.sha256` records the original audit snapshot. A later exact comparison reported changes to `Context.tsx`, `NewProjectDialog.tsx`, and `ProjectSettings.tsx`; `latest-observed-sources.sha256` records their latest observed hashes. Active producer edits are not silently covered by historical receipts. The backend context/test hashes remain unchanged. This audit changed no production/test source, committed nothing, and reran no passing tests.

Custom admission source inspection confirms an offline unsigned proposal, an operator-only Ed25519 packager and exact worker-role/image/profile checks rather than using probe availability as authority. The proposed profile clones existing worker kinds and limits, adds the exact environment only to the chosen controller/worker, and excludes build authority. The focused XML reports four passing tests, including real authenticated broker denials for an unbuilt image, wrong-role image and absent profile with zero launches. XML alone is not a raw command-exit receipt. Until the completed native packet arrives, actual signed promotion, successful custom-image worker consumption, downloaded PDF, revocation and exact owned cleanup remain unaccepted.

P25 parent validation predates these changes. No current global builds, broad route recertification or production deployment are inferred.

## Admission interim compatibility evidence

`docs/evidence/p27-custom-environment/compatibility-build.log` was read directly. It records four passing local-route/admission/packager tests, 18 assertions, successful web and installation/SSH bundles, and `P27_COMPATIBILITY_BUILD_EXIT=0`. The web build retains its large-chunk warning. This scoped settled receipt does not substitute for the still-pending installed worker sequence. Its SHA-256 is `791a4504a2e9164eaa1e943b994b0c881e0c398e2fb1e10a8c61f067bd64a708`.

Current browser verifier SHA-256 `179ec4ae4518547621badd2f1ccf668f3742100e00c207ce9c8d50ccbd28e054` scopes the option through the labeled native select and exact environment ID, then evaluates `node instanceof HTMLOptionElement && node.disabled`. That is the option property rather than locator disabled-state interpretation of an enclosing label/select. The retained original DOM has the custom option's `disabled=""` attribute and the API says `selectable:false`. The producer attributes the earlier assertion discrepancy to the old locator check; failed receipts remain retained.

The current positive path actually selects the admitted option in native selects and saves project settings, checking the returned environment ID. The negative path checks the actual option property but does not attempt a keyboard/pointer selection or assert selected-value stability after such an attempt. Therefore this interim evidence supports native disabled markup/property, not an independently observed negative selection attempt. Installed verdict and final provenance remain pending.

The installed fixture accepts explicit `apiPort` and `publicUrl` overrides, and its role manifest uses those overrides. The integration supplies its allocated API port and owned web origin. The fallback `localhost:5173` constant is not evidence that this overridden run used port 5173; final observed role/origin records remain to be checked.

### Subsequent fixture changes: not covered by the already-running process

The current browser harness routes operators to `/admin/tex` and closes an active Assistant before capturing project tools. `native-fixture.ts` now exposes `provisionNextNativeTargets()`: while open on SQLite it stops its exact owned controller, prepares two distinct new native roots using candidate migrations and current release binding, appends those targets to private controller configuration, then restarts that controller. The integration invokes this before sequence-3 revocation.

This is explicit host-operator provisioning in the fixture, not an application grant. The runbook now requires pristine unclaimed targets bound to the currently installed release/migration inventory before each update; old bootstrap targets cannot serve the next update. It says to stop/restart the exact controller when revising private inventory and forbids editing control SQL, reusing claimed targets or repointing generations. These instructions were read directly at `docs/runbooks/installation.md:114`.

Production `storage.ts` has no workspace diff. Its inspected `target()` still requires matching dialect and exact canonical prior release, an unretained generation and an unclaimed target, then verifies fresh roots and claims exclusively. `capabilities()` still checks two unclaimed roots, independent signer, shared secret authority, empty blobs/repositories and distinct identities. No storage-fence relaxation was found in that inspected path.

Observed source hashes at this step: native fixture `b0b52cb192f487baf1e0e4bedbb538f74471abeaebc3518e68e712e866911ee9`; installed integration `1698ecbc8287134f701df87e0030f61e89d51a4bdfbbe6b646d3022da52b6c97`; runbook `2349455f814f858ffd2e11d5ddb9ba95721f54ed460718c321d1080076d8f3e2`. The producer reports the still-pending installed process loaded source before this new method. Its eventual result cannot validate this method or current sequence-3 flow merely because these files now exist. Matching loaded-source provenance and a settled installed receipt remain required.
