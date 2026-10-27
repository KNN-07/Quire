# Lead P1 acceptance after independent findings

October 27, 2026. P1 is accepted as the native services/product-page baseline,
not as the complete Quire product. The editor workspace, external adapters,
most operations workflows and scale storage remain explicit subsequent work.

## Evidence retained

The independent verifier's original report remains unchanged at
`p1-verification.md`. Its full native suite passed 331 tests with 1,025
assertions; global typecheck, lint and build passed. Its real HTTP/WebSocket
probe persisted edited source across restart and extracted the edited marker
from a genuine compiled PDF. It also identified two real defects.

The lead resolved both defects rather than relabeling them as passing:

1. `services/compiler/diagnostics.ts` no longer treats PDF metadata timestamps
   as source errors. Located warnings and box warnings retain their distinct
   severity. Four parser regressions initially produced one pass and three
   failures, then passed. The actual successful new-project and seeded-paper
   compilation tests now assert that no error diagnostics are reported.
2. `services/operations/overview/index.ts` implements the real operator-only
   overview. Counts come from persisted users, projects, blobs and compiler
   jobs; topology reports the actual native runtime/WAL/disk store and
   registered capabilities. Missing AI remains unconfigured. This is not a
   fabricated provider or a removed authorization gate.

The overview is composed as `040-o-overview`, the ninth module. The actual
registry now has 245 entries, 176 registered and 69 explicit later-phase 501
contracts. The registry regression was updated by removing only the newly
implemented overview from the deferred set.

## Follow-up checks

The changed-seam run passed **13 tests, zero failures**:

```sh
bun test tests/compiler/diagnostics.test.ts tests/compiler/jobs.test.ts \
  tests/operations/overview/overview.test.ts tests/integration/p1/application.test.ts
```

It includes real successful/failed/timeout compilation, stale-preview
protection, worker fencing, overview authorization and persisted totals, source
restart and Viewer denial. Global `bun run typecheck`, `bun run lint` and
`bun run build` then exited 0. Both changed production modules had clean LSP
diagnostics. The existing Vite chunk-size warning was retained, not suppressed.

The actual composed production-browser harness now proves ordinary-user admin
denial, operator user-list access, a saved user edit and its audit record at
1440 and 390 pixels. Both cases passed, and the lead inspected
`docs/evidence/p1-integration/admin-{1440,390}.png`. The earlier two browser
failures were selector defects: hidden accessible-name text on Manage buttons
and the responsive audit-cell label. Their fixes retained the same actual
mutation and visible audit assertions. No business assertion was skipped.

The final browser command and targeted lint exited 0. All three browser
attempts closed their browsers/listeners/compiler lifecycle and removed their
unique roots; the final cleanup receipt names
`/tmp/tmp.0KkWOTN9jO/quire-p1-browser-eHD4fd`.

## Boundaries that remain open

- This does not accept the absent editor or any of the 69 deferred endpoints.
- O must migrate the native overview when the real scale adapters land.
- The generic HTTP aggregate/idempotency-receipt crash window disclosed by the
  independent verifier remains a portable-source transaction/recovery task;
  there is no exactly-once guarantee for that unverified gap.
- Deployment, provider credentials/live checks, full research coverage,
  dark/all-dialog accessibility and final user-facing acceptance remain open.
- The next storage phase is defined in
  `../architecture/storage-portability.md`; preserve this passing native
  baseline before conversion.
