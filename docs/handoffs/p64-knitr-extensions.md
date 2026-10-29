# P64 R/knitr extension and cache contract

FINAL, October 28, 2026. C24's missing `.Rtex` and explicit cache-policy
acceptance are closed within the installed Docker knitr profile.

Exact root `main.Rtex` now follows the same import/publication, selected-main,
source-write and confined compiler path as `main.Rnw`. Other R source paths
remain unsupported. Both require an editable unlinked file and a persisted
Docker environment advertising knitr. Ordinary TeX behavior is unchanged.
With `main.tex` selected, an accompanying `main.Rnw` retains precedence over
`main.Rtex`; selecting an R main explicitly removes that ambiguity.

The helper preserves the read-only source mount and only preprocesses the
private working copy into `main.tex`. The configured knitr option hook rejects
enabled chunk caching with `QUIRE_KNITR_CACHE_UNSUPPORTED`, directing authors
to `cache=FALSE`. This is a supported-workflow check, not a security boundary
against R code intentionally replacing knitr hooks. Arbitrary R still runs
only inside the existing disposable confinement; cross-job R caches are not
persisted. The runbook and settings design contract disclose these boundaries.

## Actual runtime evidence

`docs/evidence/p64-knitr/image-build.log` records an offline build from the
retained, exact P2O image, replacing only the helper and regenerating its
inventory. `P64_IMAGE_EXIT=0`; resulting immutable image:
`sha256:b4e407507c5df6f88162fa2076ab6d76fb81cdefbdd532ede66299f743c730c8`.
No host R/TeX installation or live environment was modified. Installed knitr's
actual `all_patterns$tex` was inspected, and the Rtex fixture uses its
percent-prefixed `begin.rcode` / `end.rcode` syntax rather than just renaming
an Rnw fixture.

`backend.log` contains the literal commands, UTC, four source/test hashes,
repository Bun 1.4.4, scoped TypeScript exit 0 and:

```text
bun test tests/operations/environments/knitr-extensions.test.ts tests/core/base/import-settings.test.ts
9 pass
0 fail
31 expect() calls
P64_BACKEND_EXIT=0
```

The new image passed the actual existing knitr environment probes before
registration. A standalone Rtex project then compiled through the real
authenticated application API to successful job
`a422add9-93ce-41b9-b3a8-1f6dd59d4878`. Its 13,849-byte one-page PDF is retained
in `b8dc3936-8b5e-4cd3-b896-881aa5b53778/output.pdf`. `pdftotext` reports
`QUIREKNITREXTENSION55`; the parent rendered and opened the entire page,
confirming real R output and no clipping.

Explicit `cache=TRUE` failed for both Rtex and Rnw. Jobs
`43bc154c-7848-44d9-bd6c-08c07cb93b23` and
`538c6ea7-292b-4404-ab3e-c5647bfe9c36` have the explicit unsupported-cache
sentinel in their retained build logs and no successful PDF artifact.
Every case verifies stored source remains byte-equal. Receipt JSONs retain
project, job, main path, selected cache option, source and exact fixture root.
The import regressions cover both extensions with/without knitr, restart,
explicit main/engine persistence and missing-main denial.

## Mounted settings evidence

`picker.log` records scoped TypeScript and touched-file type-aware lint exit 0,
plus two real mounted settings tests: **2 pass, 0 fail, 24 assertions**,
`P64_PICKER_EXIT=0`. They register/probe the actual image through the operator
API, then select, save and reopen `main.Rtex` at 1440 and 390 pixels. Native
and Docker-without-knitr environments exclude it; nested/other Rtex names
remain excluded; switching to an incompatible environment disables Save.

All four light/dark picker screenshots were opened by the parent. Controls
remain readable without overlap. This is the existing real-service mounted
Tools harness, not a new whole-product visual acceptance claim. The API/PDF
test and mounted settings test are separate receipts, not one invented
continuous browser-to-PDF run. Both picker input hashes match before/after.

## Cleanup and remaining boundaries

All three recorded compiler fixture roots and picker root
`/tmp/quire-ui-editor-381X9e` were independently confirmed absent. The picker
reports its web/API shutdown. `owned-inspection.log` confirms no remaining
container using the owned image and absence of the three exact job containers.
Its final four hashes match the backend run inputs; `sh -n` returns 0.
Shell/Docker language servers and shellcheck were not installed; actual shell
syntax, image build and execution supplied those checks instead.

The exact owned tag `quire-p64-knitr:20261028-01a17963` and image were removed
after tests, with `P64_IMAGE_CLEANUP_EXIT=0` in `image-cleanup.log`. The retained
P2O base and unrelated images/shared builder cache were not pruned. The small
pattern-inspection container used `--rm` and exited 0.

Deployments must build/probe a new immutable image and, when managed, admit
that image through the existing signed release procedure. An older image does
not acquire a new helper by changing its registry metadata. The unchanged
signed build/adopt/revoke chain and earlier Rnw evidence were not replayed.
Root integrated validation remains pending after concurrent P63/P61 edits.
