# Signed package root metadata: FINAL scoped correction

October 27, 2026. Parent-owned parser seam.

`Package.files[].path` now allows dots after a safe first character in the
first path component. Required `installation-runtime.json` and
`installation-roles.json` files pass the real digest-checked package download.
Leading dot/absolute/backslash/empty components retain rejection. Existing
`fetchPackage` dot-segment, duplicate-path and executable-entrypoint checks
are unchanged; no signed parser bypass was added.

`mon_6RCF4Z3AT2RFW468` reproduced the old filename rejection in 7.67 ms.
The corrected parser then passed 27 cases/48 assertions across the new
path tests and existing artifact/rejection suites. Its chained lint found
four await-thenable errors in the new test assertions. Those assertions now
use the repository's existing awaited rejection helper.

`mon_WP5QF1EEDANYWKZM` reran only the changed nine tests: 9 passed,
10 assertions, 137 ms. Type-aware lint on both parser files and the concurrent
Share correction passed. Root TypeScript then failed only on the integration
owner's in-progress `tests/integration/installation/native-fixture.ts`:
implicit-any `bindings` at lines 83/208 and watcher arguments at line 211.
The owner was notified. This is not a globally green root-typecheck claim.
The 18 unchanged passing artifact/rejection cases were not rerun.

After the installation owner corrected those four fixture errors, the parent
ran only root `tsc --noEmit`: `mon_YW8Q4HY88SS0CEBZ` completed exit 0.
This supersedes the root-type blocker without repeating passing behavior.

Current parser SHA-256:
`9b66ea71479a0bc01a56731c66ab7a1fb06020aa1b42c30716fb41c2089b3623`.
Receipts and exact hashes:
`docs/evidence/p7-installation-integration/parent-package-path-result.txt`
and `parent-package-share.sha256`.

The new tests use owned loopback download listeners and close each in a
finally block. Their configured install-root string is never opened or
written. This correction admits required filenames, not a completed signed
installation, tracked execution protocol or rollback guarantee.
