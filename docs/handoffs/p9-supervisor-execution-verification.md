# P9 supervisor execution independent verification: FINAL

October 27, 2026. Independent verifier: `st_01a17f45`.

**FINAL PASS for the concrete supervisor-execution delta.** The original
independent run completed on project-local **Bun 1.4.4 (38afee6c8)**:
**8 tests, 68 assertions, zero failures, 118.66 seconds, exit 0**.
Scoped strict TypeScript and type-aware deny-warning lint completed exit 0.
Exact cleanup and post-run fingerprints passed. No production, caller,
producer, existing test, or historical P7 report was edited.

**This is driver acceptance, not configured all-role application acceptance.**
The latter remains owned by `st_01a17e71`; parent retains final root types/build.

## Admission and preserved evidence

The complete `p9-supervisor-execution.md` FINAL, all 27 source manifest entries,
execution/profile and completed-health machine contracts, relevant concrete
implementations, new cases, and both FINAL compiler/updater seam handoffs
were read before admitting the run. All 27 current source fingerprints matched
the final manifest before execution and again afterward.

The accepted P7 independent seven-case baseline and prepared-factory receipts
were reused, not rerun. The superseding prepared-composition manifest matched
all 12 entries before and after this gate. Both compiler-quiescence and
updater-health seam manifests also matched before and after. Historical P7
report fingerprints remained unchanged.

Evidence is exclusively under `docs/evidence/p9-supervisor-independent/`:

- `tests.txt`: actual complete terminal report, including ownership/cleanup
  manifests and the original test exit sentinel.
- `statics.txt` and `commands.txt`: actual completed diagnostic result and
  exact commands/monitor provenance.
- `sources.sha256`: the independently matched 27-entry admission manifest.
- `owned-resources.json`: exact owned resource inventory.
- `cleanup-and-after.txt`: independent post-run resource and fingerprint audit.
- `admission-and-live.txt`: receipt hashes, runtime admission and live process
  identities captured during execution.

The existing monitors `mon_FW57KGFB3BF3M8CN` and `mon_6QB94HQV210AG3E5`
were recovered after the premature running-only response. Both were already
completed with exit 0; neither test nor diagnostic run was duplicated.
No JUnit reporter was configured; the original terminal report is preserved
instead of manufacturing a replacement report. Evidence files are subject
to the repository's existing ignore rules and are present on disk.

## Independent execution and evidence boundaries

The exact focused command was:

```sh
./node_modules/.bin/bun test tests/operations/installation/supervisor-execution
```

The delivered directory has eight tests: the requested seven new concrete/
source cases plus the additive approved-package schema case. No old P7 or
prepared-factory suite is included.

1. **Authenticated native/Docker execution:** a real role launches native
   metadata and Docker confinement payloads, obtains actual output and exit
   outcomes, rejects a changed idempotent request and a foreign Unix peer,
   and starts a real endless Docker compile. Stopped authority requires its
   actual systemd cgroup to have zero PIDs and its exact Docker container to
   be absent. Cancellation is retained in the launch ledger.
2. **Owned environment build:** one real builder container produces a new
   immutable image ID; a subsequent confinement probe runs through that
   installation-owned derived image. The container is independently inspected
   absent by the test. This is a font-only/no-package-download build, not
   acceptance of network package retrieval.
3. **Controller death/reconciliation:** a running Docker compile survives the
   controller kill boundary until restart reconciliation drains its exact
   inventory. The actual old cgroup is empty and container absent; the ledger
   records interruption with a null payload report, not invented success.
4. **Completed prepared-health failure:** the signed native candidate passes
   isolated preflight, migrates live storage, then fails a real private file
   health read. Its authenticated prepared failure produces the exact
   binding/health-intent/result/stop-evidence digest proof after cohort drain.
   The failed receipt survives automatic rollback to a distinct original-release
   generation; floor remains `1.0.0/1`, and the candidate-only table is absent.
   The assertion proves at least one prepared identity was drained; it does
   not prove that both candidate role slots had reached health before the
   first failing slot. The implementation stops the actual prepared cohort
   and requires global absent evidence before completed proof admission.
5. **Stopped native backup/compiler reconciliation:** two real queued jobs,
   including a real worker lease, are canceled inside the stopped backup
   producer. Archive rows show cancellation; fencing increases, leases are
   removed, and cancellation outbox events remain undispatched. A separate
   unsettled adapter operation still rejects with `BACKUP_RECOVERY_REQUIRED`.
6. **PostgreSQL runtime-root boundary:** a real bwrap/systemd probe connects to
   PostgreSQL, writes work/mail/cache/backup/restore files outside Git, cannot
   read control state or overwrite its read-only credential, and leaves the
   actual Git volume empty. Missing role-secret authorization, Git overlap,
   and generation-root reuse reject. This case proves PostgreSQL mounts and
   root isolation, **not a newly executed stopped PostgreSQL compiler-backup
   workflow**. Earlier accepted PostgreSQL/S3/Git backup receipts remain
   baseline evidence, not fresh all-role PostgreSQL acceptance.
7. **Immutable source:** an actual 140,000-byte source copy preserves all
   bytes, removes directory write permission, rejects a changed digest and
   removes its temporary root.
8. **Package/profile syntax:** pinned approved package syntax is admitted;
   unversioned packages and caller-supplied arbitrary argv are rejected.

Actual kernel process/cgroup and Docker inspections underlie these tests;
producer declarations alone were not accepted. The verifier additionally
captured live controller/API PIDs, invocation IDs and cgroup paths, and
independently audited exact resources after the run. Signed-profile selection,
limit comparisons, concurrency guards, prepared report authentication and
completed-proof ledger guards were inspected; this run does not claim an
exhaustive stress test of every resource ceiling or every work kind.

The scoped diagnostic commands were the FINAL handoff's strict configuration
and exact type-aware deny-warning lint target list, recorded in `commands.txt`.
Their original joined command completed exit 0. Shared-tree `git diff --check`
also completed exit 0. Broad unrelated integration changes were already
present and left untouched; global root checks were not duplicated.

## Exact cleanup

After both original runs terminated, an independent audit against the live
Docker daemon confirmed **31 exact units unloaded, 7 recorded roots absent,
8 exact containers absent, 1 generated image absent, and the exact MinIO
volume and host listener absent**. Every unit had `LoadState=not-found`,
`MainPID=0`, and its exact app.slice cgroup path absent. The additional
short-lived source-copy root is checked removed by its passing test; it is
not included among the seven logged roots.

All exact names and raw daemon absence responses are retained in the
inventory/audit files. Daemon unavailability was not interpreted as absence.
The source fixture's PostgreSQL/Redis exit 137 values reflect intentional
owned container removal. The three observed unrelated dbus/document portal/
permission-store units retained their exact PIDs and invocation IDs.
No unrelated resource or host policy was changed. No owned cleanup is deferred.

The earlier running-only response was not a FINAL acceptance result. This
report is published only after recovering the terminated original commands,
preserving their actual output, and completing the independent cleanup/hash
audit. The concrete scoped gate passes within the explicit boundaries above.
