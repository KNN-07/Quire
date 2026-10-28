# Governed AI availability in administration: FINAL scoped correction

October 27, 2026. Closes the specific A57a overview-consumer defect.

The default application registers AI through its governed adapter registry,
not the legacy `services.ai` port. Overview previously checked only that absent
legacy port and always returned unconfigured. It now consumes the configured
adapter's existing asynchronous availability result. The ExternalAdapter type
exposes that already-implemented method; no new provider detector, remote probe
or duplicated configuration parser was added.

The result describes configuration availability, not live provider health,
per-project permission or consent. Missing configuration, operator-disabled
configuration and configuration-ready remain distinct. Overview retains its
operator-only authentication and persisted instance totals.

## Evidence

- `mon_15R1ZPYF0C4MAR57` reproduced the mismatch against the real default host.
- The new configuration regression plus existing totals/authorization case
  passed: 2 tests, 27 assertions, 1.70 seconds. The regression exercises actual
  encrypted provider configuration, ready/disabled/missing-secret transitions,
  equality with the registry result and zero provider requests.
- The actual `/admin` browser case passed on Bun 1.4.4: 1 test, 17 assertions,
  45.63 seconds. It refreshes real persisted states and checks 1440/390 CSS-pixel
  widths in light and dark themes, no horizontal overflow, no page errors,
  no provider request and no displayed credential.
- Inspection found a duplicate disabled suffix; Overview now avoids it when
  the state itself is disabled. The affected browser case was rerun once.
  All four changed frames were inspected; eight byte-identical frames reuse
  the preceding inspection. No unrelated frontend or editor suite was rerun.
- Changed-file type-aware lint passed. LSP diagnostics are clear after exposing
  the adapter port method. The earlier root TypeScript run included two now-fixed
  availability-type errors plus two errors in the concurrent driver lane
  (`execution-broker.ts` const assignment and `execution-docker.ts` stream
  iteration). The driver owner was notified. A new globally green root
  typecheck is not claimed by this receipt.

Current packet:
`docs/evidence/p9-overview-ai/e829afbd-b812-4fb5-b481-e871ccf6da86/`.
It contains twelve screenshots, source/capture manifests and actual backend
and browser terminal output. The earlier packet
`ec815067-378d-42f3-adbc-79474d569b6b` remains retained.

The two exact browser roots `/tmp/quire-ui-editor-HauX6V` and
`/tmp/quire-ui-editor-Xw5CXD` were independently confirmed absent after awaited
disposal. Backend fixtures and loopback provider listeners use awaited cleanup.
No live vendor connection or deployed production readiness is claimed.
