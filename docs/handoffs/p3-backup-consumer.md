# Mounted administration backup correction

Status: verified on project-local Bun 1.4.4.

`Backups.tsx` no longer requires a collection ETag to enable immutable archive
actions. Verify and Restore send expectedVersion 0. Confirmed Restore binds the
selected backup ID and entered target in the required confirmation string.

The actual browser regression in `tests/ui-product/admin/backups-browser.test.ts`
first failed because Verify was disabled (`bash_172`). After the consumer fix,
verification succeeded but restore exposed the new benefits migration's seeded
table (`bash_173`). The backup owner corrected exact migration-default admission
and proved 13 focused positive/nonfresh-target cases, preserving denial of changed
or additional grant rows.

`bash_177` then passed the complete real workflow: server-issued operator login,
actual seeded database/Git/blob backup, mounted verification, and isolated restore
with a successful operation and exact destination. No API result was stubbed.
Scoped type-aware lint and full repository TypeScript both exited 0 afterward.

All eight captures in `docs/evidence/p3-backup-consumer/` were opened and inspected:
Verify and Restore at 1440x900 and 390x844, each in light and dark. Dialogs fit
their viewports, paths wrap, labels and actions remain legible and unobscured.
These are viewport-width captures, not a claim of physical-device testing or a
complete accessibility audit.

The owned browser/context/application were disposed, and the observed fixture
root `/tmp/quire-ui-editor-JsWDJm`, including its isolated restore, was confirmed
removed. Earlier failures remain recorded rather than relabeled as passes.

The old protocol-only `tests/ui-product/admin/backups-fixture.ts` models collection
versions and literal RESTORE incorrectly; it was not edited to make a test green.
This new real-service regression is the consumer acceptance evidence. Other
operations panels and scheduled backup execution retain their separate gates.
