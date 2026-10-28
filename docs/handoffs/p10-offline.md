# P10 offline window - FINAL

Completed 2026-10-27.

## Result

Closed elected I41b's five-minute browser-window mismatch. The current source
document now defaults to exactly ten minutes (600000 ms) of local editing after
transport loss. Operators can configure `VITE_QUIRE_OFFLINE_WINDOW_MS` in the
public web build; unset selects the default, while malformed, zero, negative,
fractional, and browser-timer-overflow values fail at document construction.
Configuration is validated before allocating the document or Awareness owner.

The original discovery contract is `docs/discovery/services.md`, row I41b:
short-disconnection current-file changes, controlled-clock lock boundary,
explicit reconnect/conflict recovery, and a separate downloaded/Git local
workflow for longer disconnections. Its hosted 2/10-minute plan distinction and
unknown owner-premium inheritance do not establish a Quire entitlement mapping.
The elected ten-minute default is therefore one configurable deployment policy.

## Implementation and preserved contracts

- `apps/web/src/features/editor/transport/config.ts` reads and validates the real
  public build setting. No constructor test-only setting or shared API/schema
  change was introduced.
- `apps/web/src/features/editor/transport/document.ts` consumes that setting for
  both immediate disconnect-state calculation and the scheduled expiry event.
- `tests/ui-editor/transport/document.test.ts` changes the existing deadline
  fixture only from five to ten minutes and adds deterministic default/custom
  expiry, synchronization/ack recovery, retained text, and invalid-setting tests.
- `tests/ui-editor/transport/offline.browser.test.ts` proves actual native
  browser disconnection, current-file lock at the exact boundary, backend
  exclusion of unsaved text, and acknowledged reconnect with retained source.

Failed reconnects still cannot extend the first disconnect's deadline. A
successful server synchronization resets the budget. Expiry locks rather than
discards source or pending updates; the exact acknowledgement queue, backend
current-role checks, and epoch fences remain authoritative. Existing epoch
replacement and session/access-revocation recovery tests passed.

No offline file switching, compilation, comments, AI, arbitrary project writes,
browser durable-storage guarantee, retries, or fallback paths were added.
Existing status/recovery components contain no displayed numeric duration, so
they required no edits. SourceEditor and shared composition/configuration paths
were not changed.

Operator setup, rebuild semantics, bounds, original-tab recovery, and longer
local-workflow limits are documented in `docs/runbooks/offline.md`.

## Completed verification

All commands used repository-local Bun 1.4.4 (`38afee6c8`).

- `./node_modules/.bin/bun test tests/ui-editor/transport`: exit 0; 23 passed,
  0 failed; 71 assertions across 7 files.
- Final browser-only run after strengthening its failed-request event fence:
  `./node_modules/.bin/bun test tests/ui-editor/transport/offline.browser.test.ts`:
  exit 0; 1 passed, 0 failed; 8 assertions.
- Scoped type-aware lint with denied warnings: exit 0.
- Scoped transport TypeScript project, including the browser test: exit 0.
- Transport LSP diagnostics: no errors. A later fresh browser-test LSP request
  timed out; completed scoped TypeScript checking covered it successfully.

No real sleeps or polling assertions were added. Tests use controlled clocks,
explicit expiry delivery, a failed-request event subscription, and DOM/saved
state signals armed before the corresponding action. Chromium offline emulation
does not close existing WebSockets; the test therefore closes only its captured
actual native server sockets as the network-cut injection. Source services,
updates, acknowledgements, authentication, and recovery remain real.

Desktop (1440 px) and mobile (390 px) expiry/reconnect captures were rendered
and inspected. Exact commands, outcomes, capture descriptions, and cleanup are
in `docs/evidence/p10-offline/README.md`.

The final browser fixture verified both captured sockets closed and its exact
root `/tmp/quire-ui-editor-zy7AGb` removed after disposing the context, browser,
application, web/API listeners, worker, and storage. No resources belonging to
other sessions were touched. No unaffected broad UI suite was rerun.

Nothing is deferred for this scope.
