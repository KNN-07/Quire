# P68 persisted AI run steps: frontend

FINAL bounded frontend acceptance, October 29, 2026. The parent corrected
the failure-guidance gap and added actual retry, hover/focus, natural Tab
order and explicit overlay keyboard evidence. The independent follow-ups in
`p68-visual-qa-a.md` and `p68-visual-qa-b.md` accept those targeted fixes.
Inherited typography/spacing/target deviations and unproved physical-device,
broader motion and whole-panel checklist items remain qualified, not waived
or represented as strict whole-surface PASS. Producer receipts below retain
their original input set; the appended parent follow-up is the latest state.

## Implemented

The native Assistant consumes actual `AiRun.steps` from the existing hook.
Only recorded stages appear, in their persisted order. An ordinary successful
run has context/provider/validation/publication, not a decorative five-step
script. Failed and canceled requests retain only reached stages. Every step
has an explicit status word and shared glyph; no percentage, timer, invented
success, or provider reasoning is displayed.

The run summary is a polite atomic status region. Actual start/finish
timestamps are available through the keyboard-operable Recorded times
disclosure, localized for display and preserved as UTC `time.dateTime`
values. A run without step records explicitly reports missing history.
Existing timeout receipts also have a distinct summary.

Result ready describes generation, not acceptance. Existing review decisions,
metadata, messages, composer, privacy/settings, and controls remain. The
`review:`/`claims:` key separation is preserved. Progress uses existing
identity tokens and the existing bounded `.qa-assistant__body` scroller.
The touched stylesheet's pre-existing accent blockquote stripe was changed
to its neutral hairline equivalent to meet the draft guard.

Product edits are limited to `AssistantPanel.tsx`, `assistant.css`,
`DESIGN.md`, and the focused `RunProgress.tsx` component in the Assistant
directory. Tests live only in `tests/ui-product/ai-steps/`. The hook, events,
backend, contracts, other tests, settings, and dependencies were not edited.

## Native verification

`docs/handoffs/p68-ai-steps-backend.md` was read first and is FINAL.
The verification uses the real assembled application and repository native
browser fixture with an owned deterministic HTTP provider, not live inference.
The gate is armed before Send. While its response is held, the authorized
current DTO and rendered UI show context completed and provider running.
Releasing that response delivers the actual terminal history through the
existing event/GET path without manual Refresh or polling.

Success is version 4 with four completed steps. HTTP failure and explicit
Cancel are version 2 with completed context and failed/canceled provider,
respectively. No later stages appear. The successful proposed edit remains
pending until the native Reject all action, and source stays unchanged.

The focused run passes 9 tests, 0 failures, 244 assertions, with Bun 1.4.4:

```sh
node_modules/.bin/bun test tests/ui-product/ai-steps
node_modules/.bin/bun node_modules/typescript/bin/tsc --noEmit -p tests/ui-product/ai-steps/tsconfig.json
node_modules/.bin/bun x --no-install oxlint --type-aware --deny-warnings apps/web/src/features/editor/assistant/AssistantPanel.tsx apps/web/src/features/editor/assistant/RunProgress.tsx tests/ui-product/ai-steps
```

Scoped typecheck and deny-warning lint exit 0. The frontend draft guard
passes all three touched rendered files; scoped whitespace check exits 0.
No broad passing suite was rerun and no production performance claim is made.
The hard file boundary excludes root dev-tooling installation.

## Retained evidence

All paths below are under `docs/evidence/p68-ai-steps-frontend/`.

- `final-focused.log`: exact test command, UTC 23:37:10Z–23:38:10Z, raw exit 0.
- `final-static.log`, `whitespace.log`: scoped checks and raw exits.
- `final-hashes.json`: exact product fingerprints and unchanged hook/event/
  contract inputs.
- `before-33877253-f834-4747-b91d-9f0f23c6ba6d/`: successful pre-edit baseline.
- `after-509068ec-8998-4a0e-91b7-c82dc2383a79/`: current native evidence.
- `image-diffs.log`: all 40 before/after comparisons, matching dimensions and
  intact alpha throughout, raw exit 0.
- `review-input.md`: complete 40-frame manifest, brief, source paths and
  outstanding independent review instructions.

Each capture root contains five states (empty, provider running, successful,
failed, canceled), two widths (1440/390), two themes, and top/end frames:
40 native PNGs. The current root adds all 40 side-by-side pairs and five
eight-frame contact sheets. Every current frame was inspected for readable
progress, overlap, and horizontal overflow. These are viewport checks using
the existing native fixture, not a hardware mobile-emulation claim.

Actual HTTP/DTO/action receipts, persisted native operation events, authorized
browser event-stream response receipts, provider requests, runtime/origins,
browser errors, and cleanup are retained in the current root's JSON files.
Native keyboard checks expand/collapse the timestamp disclosure and compare
every original UTC value. Unit tests cover every stage/state, legacy history,
timeout, and zero-duration records through machine fields, not pinned prose.

The pre/post source hash is identical:
`392c2b10d1f883ac1a73ca0f77efe11c044a71a8e979877ca8df405d8b0f12ab`.
Browser page and console error lists are empty. Exact owned cleanup removed
`/tmp/quire-assembly-wzLrss`, closed web/API/provider origins
`127.0.0.1:40761`, `127.0.0.1:45627`, and `127.0.0.1:43373`, and disconnected
the owned browser.

Two pre-edit fixture attempts are retained in `baseline.log` and
`baseline-corrected.log`: responsive remount reset the local mode/context,
then a browser response-body read raced that remount. The successful baseline
selects fresh context after remount and subscribes to native authorized GET
completion instead. `static.log` retains the initial unused-fixture-variable
lint failure; it was fixed, not suppressed. `focused.log` is the earlier
successful native run before the final keyboard assertions and token adjustment.
No test was skipped or weakened.

No commit was created, port 5173 was not contacted, and no shared process or
non-owned data root was cleaned up.

## Parent follow-up: recovery and transient interaction evidence

Current packet:
`docs/evidence/p68-ai-steps-frontend/after-e2b5f8e3-31c8-4f10-b2c9-8d88b3eeab8b/`.
`parent-final.log` records Bun 1.4.4, October 29 01:06:16Z-01:07:27Z,
**9 pass, 0 fail, 288 assertions**, scoped TypeScript and type-aware
deny-warning lint exit 0, `P68_PARENT_FINAL_EXIT=0`, and matching before/after
hashes of the changed progress view, stylesheet and two native fixture files.
The packet additionally fingerprints its broader owned source dependencies.

Failed/timed-out runs now explain that no result/edits were applied, direct
the user to Run details and their current message/context, and name the
actual **Regenerate (new use)** control. The test explicitly switches the
owned provider from HTTP 500 to 200, selects current Agent/source context,
and clicks that existing button. Its real project-run POST and subsequent
authorized GET identify a new successful run. Proposed edits remain pending
until explicit rejection; source bytes remain unchanged.

`interactions.json` and the fresh focus/hover/overlay captures prove recorded
time disclosure via Enter, natural Tab to the next rendered control, a
visible 2px focus outline and actual token-based hover backgrounds in both
widths/themes. Explicit Assistant keyboard opening, Tab containment, Escape
and trigger-focus restoration pass in the narrow layout. An already open
Project tools dialog from the responsive two-panel stack is closed before
that explicit opening; the test does not pretend Escape closes every layer.

The packet retains the refreshed 40 functional captures, additional
interaction captures, retry control/source screenshot, actual four-run DTOs,
HTTP/event/provider receipts and cleanup. The parent opened representative
current failure, focus, restored-trigger and retry captures; the two
independent follow-ups inspected the relevant new states and retained their
unaffected earlier visual evidence.

Earlier parent attempts remain failed historical runs: one assumed the
Assistant was the only open dialog; another selected a nonexistent exact
`Regenerate` label and the wrong `/regenerate` endpoint. The actual button
uses the current message/choices and POSTs a new project run. No failed
attempt was counted green, no provider result fabricated, and no assertion
was weakened.

## Initial independent review (targeted gaps superseded above)

Round 1 is complete on the current build. Both reviewers independently
inspected all 40 frames and verify real recorded stages, actual authorized
event refresh, no fabricated retrieval/future stages, unchanged source,
publication separate from pending review, correct layout/scroll ownership,
and preserved identity. Neither demonstrates a new progress-specific
functional defect.

The strict findings are:

- Pass A: missing targeted expanded-times/Tab/focus/hover evidence; unexecuted
  inherited first-load/offline/settings/sheet coverage; viewport-only rather
  than hardware-phone captures. It also notes the new component is absent
  from `owned.json.inputs`, although `final-hashes.json` fingerprints it and
  both reviewers establish current capture freshness.
- Both passes: failure is explained only by its labeled diagnostic code and
  generic Failed state. Pass A explicitly classifies this as inherited and
  recommends a separate failure-copy improvement. Pass B requests nearby
  plain-language cause/recovery in the new leading summary while preserving
  metadata and existing retry controls.
- Pass B: inherited 13px retained body text, low-contrast input edges, and
  missing selected-mode glyph. The last would require the forbidden
  `Composer.tsx` edit. These are not P68 regressions and do not authorize an
  unrelated redesign.

The parent must decide the requested P68 acceptance boundary: explicitly
accept the bounded inherited/evidence qualifications, or require a targeted
failure-guidance/disclosure-evidence increment and fresh independent review.
No product source or runtime check has been changed since these findings.
The exact per-item verdicts remain in the two independent reports; this
handoff does not convert their strict FAIL into a self-certified PASS.
