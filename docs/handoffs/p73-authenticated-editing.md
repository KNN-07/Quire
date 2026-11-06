# P73 authenticated editing policy

Date: 2026-11-06.

PolicyEditor no longer offers Anonymous editing. It explains that all editing,
including Editor links, requires sign-in, and that anonymous reading requires a
valid share link plus an allowing policy. Every policy form submission explicitly
sets `anonymousEdit: false`, including when loaded from a legacy true value.
Anonymous reading and the remaining policy controls retain their existing behavior.
Core authorization is unchanged.

The composed organization browser regression seeds a legacy true policy, refreshes
the real settings page, enables anonymous reading, saves, checks the stored false
editing flag and true reading flag, then navigates away and reloads the policy.
It also retains stale-version rejection and member/manager/operator coverage.

Validation:

- Repository Bun 1.4.4: organization browser test plus core `effective-access` and
  `access` suites: 18 passed, 0 failed, 95 assertions. Log:
  `docs/evidence/p73-authenticated-editing/policy-tests.log`.
- A separate organization regression uses the existing `baseFixture` with a live
  Editor token and legacy `anonymousEdit: true`. A guest source mutation returns
  403 `FORBIDDEN` and leaves the source branch revision unchanged. The actual core
  contract rejects the guest in `AccessStore.authorizeRequest` before `fileActor`.
  This test passed with 3 assertions.
- Changed-file `oxlint --type-aware --deny-warnings` exited 0 after the final
  regression addition. Combined guest-test and lint log:
  `docs/evidence/p73-authenticated-editing/guest-test-and-lint.log`.

Actual page evidence is in `docs/evidence/p73-authenticated-editing/`.
`capture.json` records the four omowright captures: desktop 1440 and iPhone 14
390 CSS pixels at DPR 3, each light and dark. Each reports no horizontal overflow.
The two additional `policy-iphone-14-*-explanation.png` captures scroll to show the
entire explanation and Save organization policy button. The initial mobile frame
ends before the paragraph finishes because the form exceeds the viewport; the
additional frames show the complete changed content.

Layout: existing single-column policy fieldset; the document owns vertical
scrolling. Existing fields and checkboxes use the shared Field, Select and Check
controls. No styling or layout primitives changed.

All six captures were opened and inspected. The explanation wraps within the form,
the reading checkbox and save action remain visible in the relevant frames, and
both themes render legibly without overlap. Independent visual review was
attempted but the harness rejects child nesting beyond depth 1; these are direct
capture observations, not an independent QA certification. No pre-edit screenshot
comparison, Lighthouse audit, or full-product visual certification was performed.

Capture fixtures used only temporary seeded application storage. Owned browsers,
profiles, Vite servers and application adapters/runtime were disposed. Successful
capture storage roots `/tmp/quire-ui-integrations-pyxBkt` and
`/tmp/quire-ui-integrations-3OfE8h` and their browser profiles were removed.
An initial capture setup used an invalid cookie injection shape; its owned
resources were also disposed before the corrected run.

No production data, core authorization, contracts, or unrelated organization
components were changed by this task. No commit was created.
