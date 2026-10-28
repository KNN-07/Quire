# Existing bibliography regressions: FINAL

October 27, 2026. Parent-owned follow-up; production Library code is unchanged.

The retained media regression exposed two existing tests in
`tests/ui-editor/tools/features.test.ts`:

- The import case waited for an automatic POST immediately after choosing a
  file. The elected UI now requires review and Save record. The test verifies
  the exact review contents and performs that real confirmation before waiting
  for the POST. Its target selection and independent copied-byte assertions remain.
- The read-only-link case depended on the earlier test having populated the
  account Library. It now creates its own actual Library record and scopes its
  disabled-copy assertion to that record. The link-byte, refresh, source-readonly
  and occupied linked-bibliography assertions remain.

No expected API failure, permission, version or byte assertion was removed.
The existing desktop/narrow copy-and-settings cases were also run because
their Library UI input changed. Their screenshots now support a separate
evidence directory, preserving earlier producer images.

`mon_JQH62JC6RZ4KZJZX` completed exit 0 on Bun 1.4.4:
4 passed, 32 assertions, 57.52 seconds. Both changed test files passed
type-aware lint and had clear LSP diagnostics.

Evidence:
`docs/evidence/p10-library/parent-regression-5c5f22af-eabb-458c-a3dc-af57425646d3/`
and durable JUnit report
`docs/evidence/p10-library/parent-regression-254e2878-57f1-46cd-8fd3-3b7e7980754c.xml`.
The exact owned roots `/tmp/quire-ui-editor-hACRfz` and
`/tmp/quire-ui-editor-j7SkYP` were independently confirmed absent.
The earlier failing results remain historical; no unrelated suite was repeated.
