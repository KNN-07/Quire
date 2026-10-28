# P2O independent default-host verification

Verifier: `st_01a17de6`. Date: October 27, 2026. **FINAL verdict: FAIL
for completed operations default-host integration.** The actual default-host
support integration passes. Configured installation updates, durable
maintenance after updater loss, and live rollback remain incomplete/unverified.
Missing proof is an acceptance failure, not an observed production incident.

## Findings that prevent acceptance

1. **FAIL: required FINAL integration handoff.**
   `docs/handoffs/p2o-integration.md:3` still says `Status: IN PROGRESS`.
   Its installation-authority escalation explicitly says no signed
   installation-host migration/rollback/crash-recovery proof has run.
   This was read before testing and checked again afterward. Its terminal
   support receipts do not make the overall handoff final.
2. **FAIL: configured host update/install behavior.**
   The actual default host returns HTTP 503 `UPDATES_UNCONFIGURED` to an
   authenticated operator's update request, exposes an empty releases page,
   and queues no update. This is correct fail-closed behavior, independently
   executed, but is not a working configured installation. The operational
   catalog registers the unconfigured update producer; composition supplies
   no `UpdateOptions`, retained update service, or designated-host scheduler.
3. **FAIL: actual maintenance retention on rollback failure or process loss.**
   No configured host safety adapter or all-role recovery proof exists.
   `services/operations/updates/service.ts` retains its gate in process memory;
   native authority is an open kernel flock description and PostgreSQL
   authority is a reserved session/advisory lock. These are not durable
   installation maintenance after process/session loss. The producer's
   `tests/operations/updates/updates.test.ts` rollback-failure case checks
   `isHeld()`, backed by the fixture's boolean, not a surviving API/repository/
   compiler/adapter writer denied by actual maintenance authority.
4. **FAIL: live host rollback/rebinding proof.**
   The producer's successful migration-rollback receipt restores a separate
   fixture application SQLite database; its control runtime remains separate.
   Default backup restore creates an isolated fresh target. Neither establishes
   replacement/reconnection of the live host database followed by valid
   operation receipt persistence. The integration handoff acknowledges this
   seam; no destructive live rollback was attempted by this verifier.

Required completion evidence remains a configured installation owner with
actual backup/preflight/migrate/health/rollback hooks, durable all-role
maintenance, updater termination after migration/activation while surviving
writers remain denied, rollback-failure retention, and exact authorized
recovery before admission reopens. Producer sandbox receipts cannot replace it.

The parent accepted this OVERALL FAIL distinction and confirmed that
deep-high architecture owner `st_01a17dda` is resolving an independent
supervised installation controller, external control receipts/version floor,
explicit stop/restore/restart authority and crash proof. No actual configured
implementation exists yet. A later scoped installer implementation and
verification phase must close that blocker; the unchanged seven passing
host-support/schema/lifecycle cases are preserved without another run.

## Exact behavior verdicts

Evidence labeled independent was executed in this verification. Historical
PASS means inspected retained execution proof only, not a deployment rerun or
current-checkout whole-product certification.

| Claim | Verdict | Observed evidence and boundary |
| --- | --- | --- |
| FINAL integration handoff exists | FAIL | Handoff remains IN PROGRESS. |
| Default operational migrations register once and survive reopen | PASS | Independent real HTTP/runtime suite; exactly `070-o-updates` and `085-o-support` in the queried migration ledger. |
| Independent operator, viewer, anonymous and CSRF denial | PASS | Operator release read 200; anonymous release read 401; viewer and missing-CSRF update/diagnostics requests 403. |
| Missing update configuration fails closed | PASS | Actual 503 `UPDATES_UNCONFIGURED`, empty release page and zero queued update jobs. |
| Configured default-host signed update executes | FAIL | No configured installer/safety/scheduler; no host install proof. |
| Support download contains actual redacted bytes | PASS | Independent core download HTTP 200, JSON MIME, 2,747 bytes; source/root canaries absent; SQL/repository/API probes ready. |
| Download checks current operator authority | PASS | Actual operator demotion after creation changes subsequent download to 403. |
| Unconfigured inquiries remain durable without fake delivery | PASS | Two HTTP 503 responses across reopen; one persisted inquiry, zero mail rows. |
| Configured inquiry enqueue is transactional and deduplicated | PASS | Concurrent requests and reopen/replay return three 200s; exactly one local aggregate outbox row. No external email sent. |
| Explicit same-ID module replacement is preserved | PASS | One custom registration, no aggregate, no default support table; releases route remains 501. |
| Support starts once and shutdown drains acknowledgement before SQL close | PASS | One actual loopback receiver request; persisted positive cursor and zero attempts after reopen. |
| Support dispatch retains actual writer admission | PASS | Separate OS `flock --exclusive --nonblock` exits 1 while receiver acknowledgement is held. This proves live native dispatch exclusion, not crash-retained installation maintenance. |
| Host rollback failure retains real all-role authority | FAIL | No host adapter/proof; producer boolean assertion is insufficient. |
| Host crash recovery and live SQL rebinding | FAIL | No executed host scenario. |
| Signed shared backup survives creator private storage deletion | PASS | Historical real Compose and Helm proof inspected; surviving API verifies exact manifest digest and lists archive. |
| Offline signed pack installs and runs | PASS | Historical Bun 1.4.4 execution inspected; retained manifest signature independently verified now. Full ephemeral pack is not retained. |
| Scoped strict types and type-aware lint | PASS | Independent commands both exit 0. |
| Source stability and exact owned cleanup | PASS | 433 before/after fingerprints identical; seven exact roots absent, eight exact API/receiver listeners absent; test process exit 0. |

## Independent commands and retained evidence

Working directory was `/home/norman/Repos/Quire`. Project-local runtime actually
reported `1.4.4`, test revision `38afee6c8`; the global binary was not changed.
The required integration suite ran **exactly once**:

```sh
./node_modules/.bin/bun --version
QUIRE_OPERATIONS_EVIDENCE=1 ./node_modules/.bin/bun test tests/integration/operations
```

Monitor `mon_0NSTD9TGCS86K6BB`, exit 0:
**7 pass, 0 fail, 35 assertions, 2 files, 46.10 seconds**.
`docs/evidence/p2o-verify/integration.log` retains the complete terminal output,
including expected unconfigured errors, actual downloaded JSON, resource
identities and individual test outcomes. No failure was suppressed.

```sh
./node_modules/.bin/tsc --noEmit --pretty false -p tests/integration/operations/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  apps/server/src/composition.ts services/operations/index.ts \
  services/operations/support tests/integration/operations
```

Monitor `mon_SPZ7C3N47SDFFRWP`, exit 0, retained in
`docs/evidence/p2o-verify/static.log`:
`P2O_VERIFY_STATIC_EXIT types=0 lint=0`.
These are scoped checks, not a whole-repository typecheck/build.
No TypeScript source or test was written or changed, so no new regression
test, source-size refactor or production diagnostic request was required.

Actual support operation: `e68d415c-59a0-4254-8166-1e38a3abe1db`.
Transport SHA-256:
`f8e80056f114602567d8255fa2ff75374e0dc6fb2bd140722bcb0d7fcf7c8abf`.
`docs/evidence/p2o-verify/support-bundle.json` retains those 2,747 bytes plus
one text-file newline: 2,748 bytes, SHA-256
`82c13eea15a2197b240235e5f4a46226d9a8f84e65a28d137d8f3d6b9a81216d`.
The reconstructed transport bytes were independently counted and hashed
against the actual test receipt. The bundle honestly reports optional Pandoc
and R missing; its historical minimum-Bun metadata remains `1.3.14`, whereas
the executed runtime and package engine authority are 1.4.4.

Actual configured inquiry: `557994ab-eb26-4da6-8add-bef504dbde04`;
status `local`, exactly one outbox message.

## Existing signed deployment and producer evidence

All P2O producer handoffs were read, including backup/integration/hooks,
deployment, environments/compiler integration, Git session, operation status,
remote PDF validation, SSH, support, updates and workers/hooks. Historical
interim failures were not relabeled or counted as new passing executions.
No deployment or broad producer suite was rerun.

- Compose: `docs/evidence/p2o-deployment/bun144-final-shared-compose-proof.log`,
  exit 0; archive `c0ee5d60-fb93-4a56-86c1-530489129db7`, manifest
  `fa24bbd69ba24e54076684c2af4f29282e6fbb74552aa7cb43e8776cab038e2c`.
- Helm: `docs/evidence/p2o-deployment/bun144-final-shared-helm-proof.log`,
  exit 0; archive `a625da5c-239c-49c3-a4bf-3bb0584316af`, manifest
  `ff9b6b87b402215932b0f06bf36b788385ab742987e4b43ed36b7ce73cbece9a`.
  Both inspected proof paths actually remove the creator's private
  volume/PVC before requesting surviving-API verification/listing. This is
  stronger than an archive status flag. Helm evidence is single-node shared
  RWO storage, not multi-node RWX certification.
- Offline: `bun144-offline-pack.log`, exit 0; 9,462 inventory entries,
  1,674,049,601 regular-file bytes, five images, three executed profiles,
  actual installed Bun 1.4.4, migration and confined doctor/SQLite HTTP health.
  `bundle-proof.ts` was read: it creates/verifies/loads the signed pack,
  installs its actual runtime/packages, starts the actual production server,
  and awaits application closure/private-root cleanup.
- Independently executed OpenSSL Ed25519 verification of
  `bundle-1.4.4-manifest.json` with its retained `.sig` and trusted public PEM
  returned `Signature Verified Successfully`, exit 0. Manifest/signature/key
  SHA-256 values match the producer handoff and are retained in
  `docs/evidence/p2o-verify/artifact-verification.json`.
- Retained update feed signature independently verified with its pinned
  public key. Decoded package is exactly 164 bytes, SHA-256
  `7043e3b148a645c1622fd73165819bf6553eca07c1b5ea6a861d4cd032e6255f`,
  matching signed length/digest; entrypoint `bin/quire`. These are actual
  retained bytes, not fabricated success metadata.
- `docs/evidence/p2o-updates/receipts.json` retains successful sandbox operation
  `f368bac0-8021-4424-936a-001b7fe958aa` and failed-migration rollback operation
  `640184e4-a935-445d-acc0-8c8806ac4072`. The fixture/test/evidence documentation
  was read. Their historical Bun 1.3.14 module execution is not a current
  configured-host acceptance run or proof of actual crash-retained admission.
- `bun144-cleanup-verified.log` records the deployment owner's exit-0 exact
  Compose/Helm/volume/image/private-root/listener audit. Those historical
  resources were not recreated or deleted by this verifier.

The current composition hash is
`46caa98bcc7e8bfdb935bbbdc9a783c011fad60f96cc7f7d423a72a423d3b7ee`;
the retained deployment image/offline inventory used
`394d2489317a0498cdadc5840dd9c42ce7af08cd1536d097d656f3a1512cc014`.
Therefore the accepted deployment receipts do not certify the later support
composition inside that old image. Its original shared-backup/offline behavior
remains historical evidence; this verifier did not manufacture an unchanged
whole-checkout deployment claim or rerun those deployments.

## Stable inputs, cleanup and relay

`source-before.sha256` and `source-after.sha256` under
`docs/evidence/p2o-verify/` enumerate 433 source/configuration inputs across
server, packages, services, workers, deployment, scripts and integration tests,
plus root package/lock/type/lint/runtime configuration. Both manifest hashes
are `01375fe12be7272cc3894cf314309eb559ba5795e702eb19795cffee11908057`.
No changed, added or removed path was observed in that captured source set.
The workspace was already heavily modified/untracked; those unrelated changes
were not attributed to this verifier. This does not claim unmeasured files
were frozen or detect a write reverted between captures.

All test-created resources were closed by awaited fixture cleanup. The
independent read-only audit in `cleanup.log` found these exact roots absent:

```text
/tmp/quire-p2o-integrate-3wzwhL
/tmp/quire-p2o-integrate-KiltuC
/tmp/quire-p2o-integrate-NfpGwD
/tmp/quire-p2o-integrate-c1KeCK
/tmp/quire-p2o-integrate-custom-ydiUWO
/tmp/quire-p2o-integrate-J1HPZJ
/tmp/quire-p2o-integrate-6ahFGq
```

API ports 38449, 34261, 34581, 40449, 37325 and 41385, and receiver ports
34161 and 46771 had no listeners. The suite process terminated exit 0;
its actual flock child was awaited. No verifier-owned container, deployment,
installation, production update, live restore, external mail or private key
was created. No cleanup touched another owner's resource. Original inputs
and producer files were not edited; writes stayed under the assigned evidence
directory and this handoff. No commit was made.

Initial automatic parent messaging failed with
`The delivery this send continues is not one the sender received.`
The terminal FAIL findings and PASS checks were subsequently delivered with
explicit `follow_up`: parent message sequence 168, delivery
`99847972-0678-4daf-b94a-fdb805740e0d`. The report records concrete missing
host behaviors instead of treating the unfinished integration as complete.
