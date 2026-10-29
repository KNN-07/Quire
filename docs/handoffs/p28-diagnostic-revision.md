# P28 diagnostic revision binding

October 28, 2026. FINAL scoped parent-owned fix and verification.

## Boundary

P27's UI preflight could not prevent a collaborator update before the server
collected diagnostic context. `services/adapters/ai/context.ts` now collects
diagnostic context in a unit-of-work transaction holding `quire:accounts`,
the same lock acquired by core source finalization before advancing a branch.
Authorization, selected document reads, diagnostic lookup and branch revision
comparison use that transaction. A mismatch returns HTTP 409
`AI_DIAGNOSTIC_STALE` before reserving usage or calling the provider.

The diagnostic ID already identifies an immutable compile snapshot and its
revision. That revision supplies the precondition; no client-provided duplicate
revision or endpoint change is necessary. A subsequent source edit does not
change the already-collected context. Existing proposal acceptance checks and
P27 late-result discard remain separate protections. This does not claim the
branch cannot change after context collection or while a provider is running.

Non-diagnostic requests retain their existing behavior. No application signing,
provider policy, account policy, consent, or automatic-edit authority changes.

## Evidence

All receipts are under `docs/evidence/p28-diagnostic-revision/`.

- `red.log`: the new test initially expected file creation HTTP 201, but the
  existing endpoint returns 200. Corrected only that new assertion.
- `red-stale.log`: unchanged context succeeds; stale diagnostic receives 202
  when the regression expects 409. Exit 1 establishes the reported gap.
- `green.log`: eight tests across `tests/adapters/ai/tools.test.ts` and
  `tests/adapters/ai/diagnostic-context.test.ts` pass with 51 assertions in
  7.87 seconds. The sequential command then runs scoped strict TypeScript and
  typed deny-warning lint. Monitor `mon_EF03722H1EN0TQPY`, session `bash_384`,
  completed with exit 0. LSP reported no errors in the changed production file.
- `browser.log`: actual diagnostic-to-reviewed-fix-to-native-PDF workflow passed:
  one test, 33 assertions, 62.25 seconds. Monitor `mon_H7RZFKGP9VZ4DQRF`,
  session `bash_385`, completed with exit 0. This rerun is justified by the
  changed server context boundary, not a blanket replay of P27.

The new native regression uses a real persisted compile snapshot/log fixture
and the actual source mutation endpoint. It proves stale rejection before any
provider request or usage reservation, and exact selected source/log delivery
for a matching revision. It is not a new compiler integration proof or a
timing-based concurrency stress test. Atomicity follows the shared transaction
and writer-lock contract; no test sleep is used.

The original P27 real compilation, consent, Viewer denial, reviewed acceptance,
source-link persistence, late discard, captures and cleanup remain in
`docs/handoffs/p27-diagnostic-ai.md`. P27's original absent-atomic-binding finding
is historical evidence, superseded by this parent verification.

## Observed output and cleanup

The affected browser packet is
`docs/evidence/p27-diagnostic-ai/85195bc5-2cdc-49b9-b430-32b4364a9b6d/`.
Parent opened `accepted-real-pdf.png`: the actual PDF is rendered alongside the
accepted replacement and saved source, with compilation succeeded. The fixture
used web port 40933 and API port 34869, not the still-occupied required port 5173.
Both owned listeners independently refused connections after disposal.

The browser root `/tmp/quire-assembly-nBrtaA` and the two targeted regression
roots `/tmp/quire-p2x-ai-QIbalj` and `/tmp/quire-p2x-ai-v6Hm46` were independently
checked absent. The earlier handoff-file watcher timed out after the handoff
had already been read directly; it is not a failed product check.

No whole-product build or final goal completion is claimed. Other implementation
lanes remain active, and effective AI policy is still enforced by the server
at generation rather than exposed as a local diagnostic-button capability.

## Follow-up: selected-card consistency

The independent P27 auditor found that changing the generic diagnostic selector
could leave the card-specific message/job/excerpt unchanged while transmitting a
different diagnostic ID. Parent changed `assistant/Context.tsx` to disable that
selector while a card-specific fix is active, with a visible instruction to
clear the context before selecting another diagnostic. Normal composer selection
remains enabled after Clear.

The existing actual-browser workflow now asserts both disabled and restored
enabled states. It passed one test with 35 assertions in 80.72 seconds, followed
by scoped strict TypeScript and typed lint. Monitor `mon_DEDJ470MRNR034TF`,
session `bash_386`, completed with exit 0; receipt `selector.log` is in the P28
evidence directory. Its root `/tmp/quire-assembly-hx4nRD` is independently absent.

Parent inspected the mobile light and desktop dark context captures in packet
`c09febe5-1ef1-4731-b269-543a6a172b4f`. They show the selected-card summary but
not the below-fold selector. A capture-only native test now scrolls that control
into view at both widths/themes without calling the AI provider or repeating
the accepted review/PDF scenario. That correction passed one test with 19
assertions in 59.11 seconds, then scoped strict TypeScript and typed lint passed.
Monitor `mon_7N0A36YQZBQ6FC20`, session `bash_387`, completed with exit 0;
receipt `selector-capture.log` retains the output.

Parent opened all four `selector-{1440,390}-{light,dark}.png` captures in
packet `eda5947b-db1f-4245-aa37-19ec1c64056c`. The disabled selected diagnostic,
clear-context instruction and separate consent controls are visible and do not
overlap at either width. The owned root `/tmp/quire-assembly-KJeSlc` is absent,
and ports 39357 and 34255 refuse connections. The selected-card consistency
follow-up is now verified; backend revision-binding proof is unchanged.
