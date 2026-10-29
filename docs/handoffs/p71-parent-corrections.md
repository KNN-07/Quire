# P71 parent corrections after first independent review

October 29, 2026. This supersedes the implementation and capture descriptions
in the initial producer handoff, not the retained first-round FAIL reports.
Independent second-round acceptance remains pending.

The complete corrected suite passed in one frozen run: 21 tests, 0 failures,
276 assertions, 142.49 seconds, exit 0 (`bash_541`).
`docs/evidence/p71-parent-privacy/round2-native.log` retains output;
`round2-before.sha256` and `round2-after.sha256` retain identical fingerprints
of 1,705 source, test, configuration, and original-input files.

Corrections address cancellation feedback ownership, actual Escape interception,
friendly provider/error/empty guidance, provider withdrawal while blocked,
explicit configuration dismissal instead of focus-driven collapse, mobile
in-flow results with a Close button, metadata hierarchy and selected glyph,
readable compact text and touch targets, and independent scrolling.
The new measured layout plugin keeps the caret and selected key visible when
the compact sheet resizes the editor without resetting manual result scrolling.
Reopening configuration resets its own scroll position.

Native tests cover cancellation via Off and Escape, accepted copies, stale
committed-copy disclosure, session isolation, inert TeX syntax, permission and
destination boundaries, and keyboard selection. They subscribe to actual events
before actions; no sleep-based synchronization was added. Temporary debugging
instrumentation was removed.

The full-suite presentation root is
`docs/evidence/p71-inline-references/0a70f691-cbd1-452d-adc4-616901d32c49`.
It contains 78 PNGs with geometry and ARIA snapshots: 13 states at 390, 1440,
and 1920 widths in both themes. Mobile uses Chromium touch/mobile emulation
and DPR 3, not a physical-device or human screen-reader acceptance claim.
Cleanup reports the unique root absent, browser closed, all three owned
listeners closed, and no errors.

One subsequent CSS-only change strengthens P71 button borders from muted to
tertiary. Calculated light resting/hover/pressed edge contrasts are
6.20/5.43/4.92; dark values are 8.25/6.56/5.57. The earlier muted border failed
the light hover threshold. The final presentation recapture and scoped/root
typecheck, lint, matrix, and production build all passed on this color revision.
The completed functional suite is retained rather than replayed for a color.

Final validation (`bash_542`, exit 0) retained 1,705 identical before/after input
fingerprints in `docs/evidence/p71-parent-privacy/final-validation-{before,after}.sha256`
and full output in `final-validation.log`. The presentation run passed
1 test with 159 assertions. Its 78 current frames and geometry/ARIA snapshots
are `docs/evidence/p71-inline-references/0c2ba8f3-639d-4721-9d6f-23f4233b7022`.
All three fixture listeners and the browser closed, the temporary root is
absent, and cleanup recorded no errors. Expected cancellation/unconfigured
provider errors exercise the deliberately captured failure states.
The existing Vite chunk-size warning remains; mapping verification reports
164/164 mapped and explicitly does not establish behavioral acceptance.

The unchanged backend lifecycle tests remain accepted from
`p71-reference-lifecycle.md`. Exact original D06 whole-shell fidelity, physical
mobile, live providers, and port 5173 acceptance are not claimed. FastShort on
5173 and the unrelated root file `1` remain untouched. The broader AI run's
two consent-guard failures are not repaired or relabeled by this phase.
