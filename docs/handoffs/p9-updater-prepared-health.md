# Updater completed prepared-health seam: FINAL

October 27, 2026. Parent-owned updater/ledger admission correction.
Actual supervisor failure reporting and cohort drain remain separate driver
integration obligations.

`UpdateService.perform` retains every existing execution-result check.
Only a health intent may additionally accept a reported failure from an actual
`purpose: prepared` identity. Its durable `completedHealthFailure` record must
match the failed identity, the exact current health intent, operation, epoch,
generation, canonical input binding digest and result bytes. Other purpose
mismatches still fail. The driver-owned store validates the recorded completed
and drained cohort; the updater does not fabricate a health execution.

The new tests explicitly exercise the ledger contract, not process attestation.
They use the real ControlStore with its explicit supervisor extension installed,
the existing updater fixture, and labeled contract-only execution records.
Complete proof permits ordinary fresh-generation rollback; missing proof or
proof belonging to another health intent leaves recovery required.

The first attempt exposed missing supervisor-extension setup in the test;
after using `installSupervisorExtensions`, `mon_3BRPSQZ47CC8SE3Z` supplied the
actual red proof: complete prepared evidence was rejected with
UPDATE_HELPER_RESULT_UNPROVEN while both negative cases already passed.

After the narrow correction, `mon_S20JYC3W8GTZA4X9` completed exit 0 on
project-local Bun 1.4.4: 10 cases passed, 48 assertions, 1.261 seconds.
The three new cases ran with the seven existing signed-install, signature,
digest, scheduled-update, migration/health rollback and exact recovery cases.
Type-aware lint and root TypeScript also exited 0. No existing assertion,
version check, signature check, failure-purpose check or recovery closure was
removed or weakened.

Output and hashes:
`docs/evidence/p9-supervisor-execution/updater-health.txt` and
`updater-health.sha256`. Existing await-using fixture disposal ran; this report
does not claim an extra per-root filesystem audit.

The concrete driver must still provide authenticated completed-failure reports
and observed cohort termination before storing this proof. Lost reports,
unexpected process death and incomplete drain must remain explicit recovery.
This contract-level PASS is not the configured candidate-health rollback gate.
