# P69 visual QA A: interaction and evidence integrity

Date: 2026-10-29. Final assigned leaf pass; sections G-J only.

## Verdict

**REVISE**, bounded to one source-confirmed remote-choice state defect and incomplete interaction evidence. The recorded happy paths work: template, ZIP, GitHub snapshot, and connected Git creation persist the chosen compiler, environment, main file, and actual source. The responsive footer is visible in every current creation capture. This is not a whole-application accessibility, physical-device, live-GitHub, or animation certification.

The actual requirement is working responsive creation/import controls, not a full-app redesign to match every inherited platform guideline. The inherited checklist failures below are reported separately and must not be presented as newly introduced P69 defects.

## New finding

**P2 [product][defect], source-confirmed, not separately reproduced: remote history and connection choices remain editable after submission.** `apps/web/src/features/projects/NewProjectDialog.tsx:200-206` disables the two new checkboxes only for `importLocked` and, for connection retention, `!preserveHistory`. Neither considers `busy` or `operation`. In an ordinary remote import, these stay false/truthy respectively as follows: `importLocked` remains false, `busy` is true during the request, and `operation` becomes populated after it returns. The tabs and compiler fieldset do lock for these states, but the history controls do not.

Consequently, after submitting full history plus a connection, the user can uncheck full history in the still-open operation view. The UI then describes an independent snapshot and clears the connection checkbox, although the already submitted request and persisted binding retain the original choices. During submission the same editable choices can diverge from the request in flight. The ready-state screenshot cannot reveal this mismatch. Lock the remote choices for `busy || Boolean(operation)` as well as frozen onboarding, or replace them with an explicitly immutable submitted summary. The same remote block leaves URL, branch, saved connection, and Connection settings editable (`:189-199`); include those in the coherent submitted-state treatment. Do not change backend snapshot/history semantics.

## Evidence reviewed

Packet prefix `E` means:

`docs/evidence/p69-import-choices/b492f986-801f-45d9-8af6-59c28b98c131/`

All 32 current PNGs were opened individually at their original displayed resolution, not assessed from contact sheets. For **each** of `template`, `zip`, `github`, and `git`, all eight exact suffixes below were opened:

| Suffix after mode | Frame |
| --- | --- |
| `-top-1440-light.png` | Desktop, top, light |
| `-top-1440-dark.png` | Desktop, top, dark |
| `-settings-1440-light.png` | Desktop, settings, light |
| `-settings-1440-dark.png` | Desktop, settings, dark |
| `-top-390-light.png` | Narrow, top, light |
| `-top-390-dark.png` | Narrow, top, dark |
| `-settings-390-light.png` | Narrow, settings, light |
| `-settings-390-dark.png` | Narrow, settings, dark |

The frames are 1440 x 900 or 390 x 900 page captures, with no browser chrome or missing compositor region. All show a real rendered dialog, controls, and underlying application. Desktop top/settings pairs can legitimately be identical when the selected control is already visible.

`E/terminal.png` is the final **browser editor** frame, not a terminal/TUI rendering. It shows `Explicit git choices`, `main.tex`, and actual `Remote initial` source. Relevant `terminal.html` DOM content independently names `Source: main.tex`, contains that source, and identifies the editor surface. Its "No successful PDF available" state belongs to the last, uncompiled Git project; it does not contradict the separate ZIP compile.

`E/selected-main.pdf` was rendered in memory with `pdftoppm` and visually opened. `pdfinfo` reports one letter-size page, 3048 bytes. The sole page reads `RIGHTIMPORT` and page number 1, with no clipped text. Its SHA-256 is `e0981ce9244ee32d7d16a3d9e6b6ea7b8ff0b47bab42326a6d59a404a941e5b7`, matching the receipt's real compile artifact. It is an intentionally minimal fixture, not a document-design reference.

Current source hashes were checked against both ends of `final.log`; all four match:

| Source | SHA-256 |
| --- | --- |
| `NewProjectDialog.tsx` | `535784487f075caa9e40c27cd12dfc2262cb9a42d748341499cf77382f1f1b96` |
| `CreationSettings.tsx` | `dcbfd31767f247e2aff9e0449a05107c2c5db201023b2caa214fda16ad0e049f` |
| `projects.css` | `9371d605eb6f1a23fe6e91e44f8e44af70bbead60498c463580276fede769705` |
| `tests/ui-product/creation-choices/native.test.ts` | `c6c5809737bff238c58b399b067123e476385732bda180c7fabf31c857af6268` |

The first three are under `apps/web/src/features/projects/`. This ties the current capture-producing test and rendered creation sources to the final run; it is not a hash certification of every application dependency.

### Run receipts, without combining failures into a green run

All logs below are under `docs/evidence/p69-import-choices/`.

- `final.log`: October 29, 00:52:35-00:53:52 UTC; current native creation test **1 pass, 0 fail, 57 assertions**. Creation-test TypeScript and scoped type-aware lint complete with `P69_FINAL_EXIT=0`. Owned application closes and `/tmp/quire-assembly-8zqWkH` is reported absent.
- `backend-final.log`: October 28, 23:39 UTC; **17 pass, 0 fail, 154 assertions** across seven files, followed by remote-Git TypeScript success and exit 0. Covers three valid history/connection combinations, invalid choices, real Git object counts, replay/recovery, credential ownership, template settings, and frozen onboarding.
- `native-discovery.log`: historical creation run 1/57, then the actual blank/template/ZIP/source-export regression **1 pass, 5 assertions**, exit 0. Its CSS/test hashes differ from the current final packet, so it is supporting regression history, not the final visual capture set.
- `native-ready.log`: historical **1 pass, 2 fail**, exit 1. Saved-default-engine creation/reopen/real compilation passes; the creation case times out selecting a template, and recovered onboarding footer bounds fail at mobile width. It is not wholly green.
- `native-layout.log`: historical **1 pass, 1 fail**, exit 1. Recovered import footer passes at desktop and 390 x 844 in light/dark; the separate creation case fails with an application-event subscription timeout. Its onboarding footer success is useful but not a new current full-suite run.
- `static-final.log`: historical lint failure, exit 1 (`no-unsafe-finally` in the native test). The later `final.log` runs the corrected test and scoped lint successfully; do not report the historical file as passing.

No application, browser, test, or port 5173 rerun was performed in this pass. Only existing sources/artifacts were inspected, hashes/PDF metadata checked, and the PDF rendered without writing another artifact.

## Required behavior and permission boundaries

| Requirement | Result and exact support |
| --- | --- |
| Template choices are actual controls | PASS. `CreationSettings.tsx` renders named native selects and a labelled path field. `NewProjectDialog.tsx` sends the selection through `projectCreate`; `routes-core.ts:40` accepts it. Current template desktop/settings and phone/settings pairs visibly show XeLaTeX, environment, and `main.tex`. Receipt records those settings and starter source. |
| ZIP settings select the real main | PASS for recorded creation; phone visual evidence incomplete as noted below. Multipart permits and forwards `mainPath`, `engine`, and `environmentId`; interchange passes them into core creation. Current ZIP desktop captures show `z-selected.tex`. Receipt records XeLaTeX, the chosen environment, successful compilation, and `RIGHTIMPORT` source; the actual PDF proves the selected file, rather than the competing `WRONGIMPORT` main, compiled. |
| Remote imports use the same explicit settings | PASS for recorded happy paths. Both remote settings phone pairs show the compiler/environment/path controls. Receipt persists XeLaTeX and the same environment for GitHub and Git; native test opens their actual main source. The new finding concerns subsequent mutability, not loss of the recorded initial selections. |
| Full history versus independent snapshot | PASS. `remote-git/import-project.ts` imports the pack and publishes branches/tags only for preserved history; snapshot uses the newly prepared single source commit. Backend tests check two versus one reachable main commits, branch/tag lists, and restart replay. Current receipt shows snapshot GitHub `branches:["main"]`, no tags, no binding; connected Git retains `main`, `protected/release`, `v1.0.0`, and a binding. |
| Snapshot cannot keep pull/push binding | PASS. Current GitHub captures show both unchecked and retention disabled with explanatory copy. Native test asserts unchecked/disabled. Backend rejects false-history/true-connection with `REMOTE_HISTORY_REQUIRED` before project publication; `store.ts` omits binding insertion for `connected:false`, including recovery. |
| Saved connection, including public repositories | PASS. Remote captures explicitly state this requirement. Current native test first verifies disabled import with no ready grant, then creates actual owned OAuth and repository-bound Git connections. Interchange reads the actor-owned grant and checks provider. Credentials are selected by label, not typed or exposed in this dialog. |
| No invented automatic two-way synchronization | PASS. Both remote modes explicitly say pull and push are manual actions; retained binding does not claim automatic synchronization. |
| Frozen onboarding and legacy omissions | PASS at source/backend level, with historical UI support only. `onboarding-import.ts` queues actor/version-guarded draft saves, fingerprints the original upload, and replays the frozen attempt. Dialog disables frozen fields and resumes the original operation. If saved engine/environment are incomplete, it says service defaults remain unchanged and directs review after import; it does not manufacture an asserted saved choice. Backend restart tests pass. |
| Real implementation, privacy, cleanup | PASS within owned fixture scope. Core validates workspace membership and template visibility; interchange checks grants for the acting user. Backend log includes denial of another user's grant and encrypted/repository-bound credential tests. Native fixture uses an actual owned HTTP Git/OAuth provider, not live GitHub or a screenshot-only mock. Final log closes owned services/browser and proves its temporary root absent. Public template metadata does not make the created personal project public. No new privacy leak is visible in the packet. |

Sources also reviewed: `services/core/base/projects.ts`, `services/adapters/interchange/{imports,remote}.ts`, `services/adapters/remote-git/{import-project,store,migrations}.ts`, `packages/contracts/src/multipart.ts`, account onboarding continuation, shared UI controls/modal, `OperationStatus.tsx`, and global CSS. The migration resets legacy unscoped remote-import cursors; disconnected recovery does not recreate a binding.

## G-J checklist

PASS is limited to the stated evidence. FAIL tagged **evidence** means the criterion is not proved by this packet, not that an unseen interaction was observed failing. N/A means no applicable instance. Shared/inherited failures are not newly attributed to P69.

| Item | Result | Evidence and boundary |
| --- | --- | --- |
| G1 Caused motion | PASS, source-limited | Shared spinner is conditional on busy/loading state. No decorative moving region appears in any of the 32 frames; no unconditional creation animation is defined in inspected styles. |
| G2 Geometric continuity | N/A | No animated geometry transition is implemented on the changed creation region; static scroll positions are not transition proof. |
| G3 Interruptible motion | N/A | No creation entrance/exit/resize motion to interrupt. Request busy locking is not animation. |
| G4 Reduced motion preserves progress | FAIL, inherited product | `apps/web/src/styles/global.css` disables `.q-spinner` animation under reduced motion and changes to dotted borders. Progress motion does not remain. No reduced-motion frames were supplied. |
| G5 Same-frame acknowledgement and delayed spinner | FAIL, inherited product/evidence | Shared `Button` inserts a spinner immediately on `busy`; no approximately one-second threshold exists. No press/mid/settled frames establish same-frame timing. |
| G6 First paint/no layout shift | FAIL, evidence | All32 are settled, populated views. No first-paint/loading sequence or shift measurement. No branded splash is evidenced. |
| G7 No flashing/reading obstruction | PASS, source-limited | All32 remain readable; inspected creation/global styles define no flash, strobe, or viewport-filling oscillation. No temporal capture certification claimed. |
| H1 Empty/loading/error/offline | FAIL, evidence/inherited | Source has loading/error/retry and no-ready-connection handling; current matrix captures populated ready forms only. Distinct offline behavior is not proved. |
| H2 Immediate specific loading | FAIL, inherited product/evidence | Generic shared "Working" spinner is immediate and stops under reduced motion; no long-operation loading capture establishes timing or continued progress. |
| H3 Local errors and visible success | FAIL, inherited product | New dialog uses inline alerts and native tests prove successful state/opening. Shared `OperationStatus.tsx` exposes raw `operation.errorCode` rather than a cause/action explanation; failure-state rendering is not captured here. |
| H4 Alert design | N/A | No alert dialog in the reviewed flow; `role="alert"` paragraphs are not alert windows. |
| H5 Hover/press/focus/disabled states | FAIL, new product + evidence | New finding above: submitted history controls stay editable. GitHub settings frames prove snapshot-dependent unchecked/disabled retention; all desktop settings pairs show main-path focus rings. Complete hover/pressed/disabled matrix is absent. |
| H6 Modal exit and unsaved changes | FAIL, inherited strict guideline | All32 show one dialog with close and footer Cancel; footer remains available at 390 and 1440. Shared Modal traps/wraps Tab and uses native modality. Ordinary dialog unmount explicitly discards unsubmitted values without unsaved-change confirmation. This inherited dismissal policy is not evidence that responsive controls fail. Busy temporarily blocks dismissal rather than cancelling a dispatched import. |
| H7 Safe long-operation cancellation | FAIL, evidence | A pending operation has Check status, not cancellation. The reviewed contract does not establish whether in-flight import is safely cancellable, so no cancellation capability or safe-cancellation defect is invented. |
| H8 Contextual permission | PASS, bounded | Remote top pairs put saved-connection purpose beside the control and offer Connection settings. No unrelated permission prompt at dialog launch. Actual OAuth consent screen/system prompt is outside this packet. |
| H9 Deferred/named sign-in | PASS, bounded | Remote imports require a connection when needed and name GitHub or the saved repository connection. No password field or prefilled secret in the creation form. Full account onboarding/auth UI is not certified. |
| H10 Search | FAIL, inherited strict guideline | Template top pairs show one active modal template search (underlying page is inert); shared template search supplies no evidenced recents/suggestions in this packet. Not a P69 import-choice regression. |
| H11 Settings semantics | PASS | Compiler/environment/main path labels match their controls. Remote checkbox labels say what enabled means; adjacent copy explains snapshot independence and explicit pull/push. No duplicated operating-system setting in this flow. |
| I1 Focus ring/order/default | FAIL, evidence | Visible path focus in template/remote settings pairs and source `:focus-visible` ring support. Native Modal has inert siblings, wrapping Tab handler, and focus restoration. There is no keyboard-only traversal/default-focus capture for every control; do not promote source intent to a measured keyboard pass. |
| I2 Escape/Enter/shortcuts | FAIL, evidence | Source handles native cancel/Escape and non-destructive form submit, with tab arrow/Home/End handling. Current native test uses automation clicks/fills, not Escape/Enter or system-shortcut assertions. No failure of those keys was observed. |
| I3 Names and accessible structure | PASS, source-limited | Shared `Field` associates labels and hints; selects/checkboxes are labelled, modal title is referenced, close icon has accessible label and title, tab/panel relationships exist. Native role/label locators resolve actual controls. No screen-reader or complete accessibility-tree audit supplied. |
| I4 Gesture alternatives | PASS | ZIP phone/top and desktop pairs expose Choose file as an alternative to drag/drop; close/Cancel are explicit controls. No gesture-only changed action. |
| I5 Autoplay controls | N/A | No autoplaying media in the creation flow. |
| J1 macOS chrome/menu specifics | N/A | Browser application, not a native macOS window/menu implementation. |
| J2 Compact UI/input type | PASS, bounded | All390 frames show a modal with no anchored popover. Remote URL input is `type="url"` and remains in one column; the browser can select its URL keyboard. No physical phone, virtual-keyboard, notch, or OS-sheet behavior was tested. |

## Evidence limitations and inherited deviations

1. **[evidence] ZIP mobile settings frames do not cover all settings.** `E/zip-settings-390-light.png` and `-dark.png` duplicate their top counterparts: compiler is visible, but TeX Live control and main path remain below the body viewport. The test scrolls only Compiler into view, not the final field/bottom. This is not proof of inaccessible content; it is a capture coverage gap. Template and both remote phone settings pairs do show the final main-path field and explanatory environment text. A ZIP end-of-body capture is needed to close that visual claim.
2. **[evidence] Desktop remote bottom content is not fully covered.** Git/GitHub top/settings pairs are identical and stop before the environment admission paragraph, although the three controls are visible. Phone settings captures supply that text for those modes. This does not justify claiming a full scrolled-to-end desktop matrix.
3. **[evidence] Narrow width is not mobile-device emulation.** The native test uses viewport resize to 390 x 900, not touch/DPR/mobile emulation. No physical device, virtual keyboard, 200% zoom, long labels/unbroken paths, reduced-motion, motion frames, or first-load/offline/error matrix is supplied. Width overflow is asserted in the passing test, but keyboard access and dynamic states are not.
4. **[inherited] Strict global guideline deviations remain separate.** Immediate generic spinner, reduced-motion spinner cessation, raw operation error codes, no ordinary draft-dismissal confirmation, and search suggestions are shared existing policies/components. They do not warrant unrelated redesign under this task.
5. **[evidence] Historical successes have bounded currency.** Default-engine and recovered-onboarding UI successes belong to older source hashes. Backend frozen-choice tests and current source support compatibility, but the current final log does not rerun every historical regression. The historical failed combined runs remain failed in this report.

The unresolved new product finding is submitted remote-choice mutability. The unresolved evidence gaps above prevent an unconditional G-J sign-off, despite strong recorded creation/source/history and current footer evidence. No product or test edits were made.

## Follow-up: submitted choices and complete body captures

Date: 2026-10-29, after the 01:40:49-01:42:03 UTC reviewer-fix run.

**Bounded feature verdict: PASS.** This follow-up supersedes the original REVISE verdict for the submitted-choice defect and the two missing lower-content capture findings. The P2 choice-mutability finding is **closed**. No new in-scope product defect was found in the reviewed follow-up. This is not an unconditional full G-J checklist pass: the inherited and unproved items below retain their original attribution.

Current packet prefix `F`:

`docs/evidence/p69-import-choices/0c26269b-0f25-4251-be73-4a39109a6498/`

### Submitted-state fix: PASS

Current `NewProjectDialog.tsx` defines `choicesLocked = busy || Boolean(created) || Boolean(operation) || importLocked`. Project name, workspace, repository URL/branch, saved connection, history/binding checkboxes, compiler/environment/main path, template selection, and blank example choice use that lock. ZIP selection and drop handling also reject changes while busy/created/operation; frozen onboarding still permits the required original-file reselection before dispatch. The upload fingerprint/recovery path reviewed above remains the authority for accepting the same file. This follow-up did not independently exercise that reselection path.

The current `native.test.ts` installs a gate on the actual application handler before triggering the click, waits for both request entry and observed disabled controls, asserts actual DOM disabled states, captures the pending view, and releases the gate in `finally`. The request then proceeds to the real handler; there is no fabricated successful response. For ZIP/GitHub/Git, it waits for the real response and the non-busy disabled submit state, asserts all relevant choices remain locked, then opens the imported project and checks persisted source/settings. Template success navigates directly to the editor, so no template-complete dialog capture is expected.

All seven new submitted PNGs were opened individually at 1440 x 900:

- `F/template-submitted-pending.png`
- `F/zip-submitted-pending.png`, `F/zip-submitted-complete.png`
- `F/github-submitted-pending.png`, `F/github-submitted-complete.png`
- `F/git-submitted-pending.png`, `F/git-submitted-complete.png`

They show dimmed submitted inputs, a busy primary action while held, and locked choices after actual import completion. Git retains its checked history/connection values; snapshot GitHub retains both unchecked. The test's `assertChoicesLocked` checks actual disabled semantics, not just dim styling. The remote complete screenshots do not expose the full operation panel below the body fold; actual succeeded status and subsequent Open action are established by the real response, receipt, and passing test, not by pretending that offscreen panel is visible in the PNG.

Connection settings remains an enabled navigation action and is not asserted disabled by the helper; it is not an editable submitted choice. This closes the identified history/binding mismatch, not a claim that every navigation or dismissal action is disabled. No navigation-during-request behavior was exercised.

### Lower content and scroll owner: PASS

Read all **16** `F/{template,zip,github,git}-layout-{1440,390}-{light,dark}.json` probes. Each records `.p-create-dialog > .q-modal__body` as owner with `overflowY:"auto"`, reaches the body end within rounding tolerance, keeps header/body/footer ordered without overlap, and records document width equal to viewport width. The only active dialog scroller is `q-modal__body`, except desktop ZIP, whose entire body fits and therefore has no active scroller.

| Mode | Desktop scrollTop / clientHeight / scrollHeight | Narrow scrollTop / clientHeight / scrollHeight |
| --- | --- | --- |
| Template | 46 / 724 / 770 | 400 / 685 / 1085 |
| ZIP | 0 / 616 / 616 | 251 / 685 / 936 |
| GitHub | 55 / 724 / 779 | 616 / 685 / 1301 |
| Git | 55 / 724 / 779 | 596 / 685 / 1281 |

Light/dark values agree for each row. All narrow footers end at y=883 in a 900-high viewport, inside dialogs ending at y=884. Desktop non-ZIP footers also end at y=883; desktop ZIP ends at y=828.75 inside its dialog ending at y=829.75.

Opened all **16 current settings captures**: `F/{template,zip,github,git}-settings-{1440,390}-{light,dark}.png`. ZIP narrow captures now show XeLaTeX, TeX Live version, `z-selected.tex`, the path hint, admission explanation, and visible footer actions. Both remote desktop settings pairs now show the full admission explanation above the footer. The two original lower-content evidence gaps are closed. No horizontal overlap or inaccessible footer is visible in these captures.

Also opened all four current template top captures because template selection gained a disabled fieldset. Its content remains readable at both widths/themes; the fieldset's resulting outline/inset is not a new functional defect. Other unchanged ready-state content and backend behavior reuse the original pass rather than claiming another full audit.

`docs/handoffs/p1-ui-projects.md:49-56` explicitly annotates the old `.q-modal` scroll contract as superseded for P69. `docs/handoffs/p69-project-choices.md` names the body owner and fixed header/footer structure, matching the probes and inspected CSS. This resolves the creation-region scroll-owner documentation discrepancy; it is not a separate A-F sign-off.

### Current run and source currency

Read `docs/evidence/p69-import-choices/review-fix.log`: **2 native cases pass, 0 fail, 248 assertions**, followed by scoped deny-warning type-aware lint, with TypeScript also successful and `P69_REVIEW_FIX_EXIT=0`. Both current creation and recovered-import footer cases pass in this run. It reports the owned creation root `/tmp/quire-assembly-WdzvGe` absent and onboarding root `/tmp/quire-ui-editor-WXNDuZ` removed after closure.

Computed current source hashes through read-only content inspection; all five match both ends of that log:

| Source | SHA-256 |
| --- | --- |
| `apps/web/src/features/projects/NewProjectDialog.tsx` | `634d57738a7966c054dd157bcfed4f3c2feaa987d9f7cf82d8708773b746b912` |
| `apps/web/src/features/projects/CreationSettings.tsx` | `dcbfd31767f247e2aff9e0449a05107c2c5db201023b2caa214fda16ad0e049f` |
| `apps/web/src/features/projects/projects.css` | `e2a70d405173a8e7562544b85c2c362d144de9c941256a3a59e52923e0d63b5e` |
| `tests/ui-product/creation-choices/native.test.ts` | `392a309678b24f1d2906c08727f1c663cb3d169fd9172800cb0546f8d9d2fbaf` |
| `tests/ui-product/creation-choices/presentation.ts` | `8917ef787f00274771968161949f08b5b111f6b4e7e76afe607a29af80ca7d76` |

Read the new receipt: all four projects persist XeLaTeX and the selected environment; ZIP source is `RIGHTIMPORT` and its real compile succeeded. Snapshot GitHub has no binding, only main, and no tags; connected Git has a binding, main plus protected/release, and v1.0.0. Browser errors are empty. The previous PDF visual inspection and backend history/security review are reused; the new PDF was not separately rendered in this bounded follow-up.

### Checklist delta and remaining limits

- **H5 submitted-state subcriterion: PASS, previously new product FAIL.** Pending and completed choices are now locked by source and real request-gated assertions. Full H5 remains unproved for every hover/pressed/focused/disabled variant; do not relabel that broad criterion fully passed.
- **H6 footer/exit availability subcriterion: PASS**, supported by current body probes/captures and the current recovered-onboarding native case. The inherited ordinary-draft dismissal policy and temporary busy dismissal behavior remain as described in the original checklist.
- **H3 success evidence improves** through actual completed responses, locked state, and project opening. The inherited raw error-code finding is unchanged.
- **All other G-J per-item dispositions remain unchanged.** No new keyboard-only traversal, Escape/Enter/system-shortcut, screen-reader, first-paint/layout-shift, reduced-motion, offline/error, long-operation cancellation, physical-device, virtual-keyboard, safe-area, or full motion-state evidence was added. Submitted captures cover desktop dark mode, not a complete submitted-state theme/viewport matrix.
- Some current template `top` captures are not at scrollTop zero: the field itself is in view but its label may be above the body edge. The deterministic end-of-body probes are unaffected. Reuse the original fully labelled top-state evidence for unchanged labels; do not claim every new `top` filename proves identical top alignment.
- Historical failed combined logs remain failed; the new two-case passing run does not retrospectively change them. Saved-default and export/backend receipts retain their separately stated scope.

Only this report was modified during the follow-up. No source edits, runtime/browser/test reruns, or physical-device/keyboard-only coverage were performed or claimed.
