# P65 backup policy controls and scheduler contract

FINAL, October 28, 2026. The native policy form now matches the existing
backup service. Empty/whitespace schedule input submits `disabled`; a saved
disabled policy reopens as an empty field. Retention requires an integer
between 1 and 36,500 days. Destination is the read-only provisioned private
root, not an advertised relocation control.

The form explains the daily UTC syntax, latest-slot catch-up and duplicate
deduplication. It explicitly says saving does not install/start a timer and
shows the existing scheduled CLI invocation under an enrolled operator.
No default timer, invented principal or hidden host service was introduced.
Verify and Restore were not changed.

## Verification

`docs/evidence/p65-backup-policy/verification.log` retains literal commands,
UTC 22:27:23Z-22:28:22Z, repository Bun 1.4.4 and matching before/after
production/native-test hashes. Scoped TypeScript and touched-file type-aware
deny-warning lint passed. The selected tests reported:

```text
bun test tests/operations/backups/policy.test.ts tests/ui-product/backup-policy/native.test.ts
4 pass
0 fail
28 expect() calls
P65_POLICY_EXIT=0
```

The real native administration test authenticated an operator, verified
read-only destination and invalid retention values, saved manual-only policy,
reopened it and then saved daily `0 3 * * *` UTC with retention 1.
The persisted values and optimistic versions were read through the actual
API. Saving alone created no archive; the disabled scheduler returned null.

The test then invoked the real deployment scheduler entrypoint with that
operator. It created and verified backup
`d918b2fc-b750-4f89-bdf6-28ff18e9e622`, operation
`2573e5f5-f8ac-48f1-8dbd-bee6814f203d`, manifest digest
`a4a4e51ea3d4c23844c84c9f0f989176785492b0a16b814de8782d141b3be178`.
The duplicate due-slot invocation returned the same operation and retained
exactly one backup. After operator authority was removed, another invocation
failed with `FORBIDDEN` and created nothing.

The existing backend cases independently prove UTC midnight slot selection,
duplicate scheduling, deletion of only owned verified expired archives while
preserving an unrelated directory, and excessive-retention rejection. They
use the injected clock and real archive verification, not timing sleeps.

The native packet
`docs/evidence/p65-backup-policy/49a2b500-2ddf-42dd-a461-403f8af08a0d/`
retains policy/operation/backup receipts and four screenshots. The parent
opened all 1440/390 light/dark captures. The fixed destination, retention
field, UTC instructions, timer prerequisite, command and Save control remain
visible without overlap or document-width overflow.

## Boundaries and cleanup

This verifies the configured application's actual scheduled entrypoint,
not installation of a systemd/cron timer on a live deployment. That explicit
operator prerequisite remains in the form and recovery runbook. Literal
localhost:5173 acceptance and whole-product integrated gates remain separate.
No full restore drill or signed installation lifecycle was repeated.

The native fixture closed its browser and application and removed
`/tmp/quire-ui-editor-ibqWXK`; both backend roots
`/tmp/quire-p2o-backup-3FkDNV` and `/tmp/quire-p2o-backup-GFwiSU`
were also independently confirmed absent. Secret-bearing full archives and
signing keys stayed inside those disposable roots; only non-secret receipts
and screenshots were retained. No unrelated process, live timer or project
commit was changed.
