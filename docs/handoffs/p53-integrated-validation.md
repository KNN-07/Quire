# P53 integrated production validation

October 28, 2026. FINAL static/build increment after lifecycle, Dropbox,
Mendeley and privacy changes. Independent adapter verdicts and whole-product
acceptance remain separate.

## Production build

From `/home/norman/Repos/Quire`, with repository `node_modules/.bin` first in
PATH, `bun run build` completed exit 0 on pinned Bun 1.4.4.
Raw receipt: `docs/evidence/p53-integrated-validation/build.log`.
Monitor `mon_W2A95FR56X10D40J` / `bash_440`.
UTC: 17:39:33Z through 17:39:40Z.

The receipt fingerprints 671 production-source/configuration inputs before
and after the build. All 671 pairs match. The web, API, repository, compiler,
installation controller/role and SSH bundles were regenerated successfully.
Vite built in 6.02 seconds. The principal web chunk is 1,999.62 kB
(594.87 kB gzip); the existing greater-than-500-kB warning remains unsuppressed.

## Current root static checks

P49's root typecheck/lint receipt ended at 17:31:55Z with exit 0. None of the
671 inspected production inputs changed after that check began. However, four
Mendeley preview-test inputs subsequently changed:

- `tests/ui-product/mendeley-groups/tsconfig.json`
- `tests/ui-product/mendeley-groups/workflow.test.ts`
- `tests/ui-product/mendeley-groups/preview-boundaries.ts`
- `tests/ui-product/mendeley-groups/preview-harness.tsx`

Parent therefore refreshed only the root static gate:

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
bun run typecheck && bun run lint
```

`docs/evidence/p53-integrated-validation/static.log` retains the command,
UTC start/end, matching pre/post hashes of those four inputs, and
`P53_STATIC_EXIT=0`. Monitor `mon_WESTXR2C27X1V5RD` / `bash_441` completed
exit 0 from 17:41:08Z through 17:42:19Z. This supersedes the intermediate
missing Dropbox symbols and redundant-union findings, without deleting
their earlier failure receipts. The unchanged production build was not repeated.

## Scoped runtime evidence reused

- P46 pinned lifecycle selection: seven cases/192 assertions and independent
  bounded PASS; separate three-case/12-assertion scheduler integration receipt.
- P47 actual PostgreSQL recovery: one case/22 assertions, exact cleanup.
- P48 correlated compiled publisher archive/submit/status: one case/14
  assertions and inspected real PDF, owned loopback only.
- P49 FINAL producer receipts: 13 new native cases/81 assertions, affected
  Dropbox/core checks, and one actual browser workflow/21 assertions.
- P50 FINAL producer receipts: five selected provider/native cases/70
  assertions; additional native preview/cancellation/access-denial workflow
  one case/44 assertions, with focused types/lint.
- P52 native privacy surface: inspected before/after captures, final lint,
  default-fixture network/storage observations, exact owned cleanup.

These are separate selected runs and snapshots, not a new whole-suite
aggregate. P49/P50 producer summaries still require their dependent independent
audits. P46's earlier two core-dependency hash differences were expected after
P49's authorized creation extension; P49's actual creation/composition and
browser checks plus this integrated build/static increment address that
changed-input concern without replaying every lifecycle scenario.

The build and static commands are completed; they left no running server or
browser. Production assets are retained, not treated as disposable caches.
No port 5173 operation, live-provider call, commit or external deployment was
performed. The required-origin decision, broader capability remainders,
independent reviews and final owned-resource cleanup remain open.
