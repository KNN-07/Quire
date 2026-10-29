# P46 pinned-runtime acceptance supplement

October 28, 2026. FINAL parent execution receipt; independent lifecycle verdict
remains a separate gate.

The producer's successful host/account/browser checks used global Bun 1.3.14.
Those receipts remain valid observations of that runtime, not acceptance of
the repository-pinned Bun 1.4.4. Parent ran the affected final lifecycle
selection with the repository binary first in PATH:

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
bun test tests/accounts/governance/lifecycle-schedule.test.ts \
  tests/adapters/host/managed-lifecycle.test.ts \
  tests/ui-product/managed-lifecycle/browser.test.ts
```

`docs/evidence/p46-managed-lifecycle/parent-pinned.log` records cwd, exact
selection, Bun 1.4.4, UTC start/end, seventeen identical before/after source
and test hashes, and `P46_PINNED_EXIT=0`. The seven cases passed with 192
assertions, from 16:58:03Z to 16:58:54Z.
Monitor `mon_BB1JJH4D91FP0PVG` / `bash_435` completed exit 0.

The selection covers the native schedule configuration/reload, explicit
lapse/recovery/disable and unauthorized denial; actual default-host ticks,
persisted authority and restart; due boundaries and invalid transfer recipients;
last-admin and last-operator protection; lost ownership or inactive authorizer;
and rollback of an injected final-audit failure while another due account
succeeds. Expected denial/audit-failure logs are intentional assertions.

Parent inspected all four captures under
`docs/evidence/p46-managed-lifecycle/browser-6189a619-b9d0-4468-a0ed-e3ad6719686f/`:
390 and 1440 viewport widths, light and dark. Schedule inputs, recipient,
confirmation, dates, recovery and refresh controls are visible and neither
overlap nor overflow. These are panel captures, not whole-product visual
acceptance.

Parent independently verified all seven named runtime roots absent:

- `/tmp/quire-ui-integrations-XQa1yI`
- `/tmp/quire-p2x-integrate-GkeNkf`
- `/tmp/quire-p2x-integrate-osBR6j`
- `/tmp/quire-p1s-accounts-55eTIH`
- `/tmp/quire-p1s-accounts-fWRlLZ`
- `/tmp/quire-p1s-accounts-0lRrb0`
- `/tmp/quire-p1s-accounts-Hvj72y`

Web/API ports 39413 and 36333 refuse connections. The raw receipt records
awaited fixture teardown and zero remaining host scheduler listeners.
The short hold on the Dropbox producer's two core files was released after
completion; subsequent P49 changes are not covered by this snapshot.

The separate pinned-runtime `parent-schedulers.log` passed the three affected
existing subscription/shutdown/failure-isolation cases with 12 assertions and
matching hashes, exit 0. Parent changed only the stale five-task/four-survivor
count assertions; both test files had clean LSP diagnostics.

Producer root types passed, including the P47 test. Its prior bounded root
lint passed; a later root lint observed the concurrent P49 Dropbox API
`no-constant-condition` finding. That finding was sent to its owner and is
not represented as a P46 regression or a current global lint PASS.
Final integrated validation follows the remaining source changes.
