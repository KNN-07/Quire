# P2O default-host operations integration

Owner: `st_01a17dd5`. October 27, 2026. Status: IN PROGRESS; support and
default-unconfigured lifecycle are verified. Configured host integration
awaits the selected installation foundations and published lifecycle seams.

## Architecture decision selected; foundations owned elsewhere

The parent selected `docs/architecture/installation-authority.md`, read in
full (718 lines). It requires a stable `systemd-local-v1` supervisor,
independent control SQLite, actual all-role stopped authority and fresh
process/data binding. Compose/Helm are unsupported update targets for that
driver. The design is not acceptance evidence or an existing API export.

The parent is delivering control contracts/store, update receipt adaptation
and the fresh-target restore primitive in disjoint foundation lanes, followed
by independent verification. This task explicitly releases
`services/operations/updates/**` and all restore paths to those owners.
No updates/restore source was edited by this task, and it will not introduce
promised callback implementations or concurrently rewrite those foundations.

The later owned integration phase will consume the actual published
`UpdateClient`, prepared/start/close lifecycle and validated host capability.
It will retain one route registration and no API scheduler, merge authorized
operation receipt reads at the assigned task-reader seam, and verify actual
isolated configured host safety only after those interfaces land. Until
then, the current passing support/default-unconfigured evidence is preserved
without a configured readiness claim.

## Original escalation and source constraints

`ESCALATE: deep-high`. A configured production installer cannot truthfully be
completed inside this task's write boundary with the current contracts.

1. `packages/runtime/src/native-admission.ts` holds maintenance with open kernel
   flock descriptions. `services/operations/storage/postgres/admission.ts`
   holds it with PostgreSQL reserved sessions and advisory locks. Both release
   authority on process/session death. `packages/runtime/src/admission.ts`
   exposes callback-scoped `exclusive(work)` only.
2. `services/operations/updates/service.ts` retains `retainedGate` only in
   process memory. Its filesystem install lock prevents another updater, not
   HTTP, realtime, repository, compiler or adapter writers after process loss.
   Persisting `recovery_required` in `update_jobs` does not make those roles
   consult it. A host-only Promise bridge would preserve a live callback's
   exclusion but cannot preserve crash-retained maintenance.
3. The same service writes update phases and operation receipts through its
   captured `context.db` after `safety.rollback`. Backup's supported restore
   creates a fresh isolated target, not a live database replacement/reconnect.
   No runtime reconnect/rebind authority is exported.

Further concrete bridge constraints traced while awaiting the design:

- `services/operations/backups/database.ts:28` rejects every queued/running
  operation except the exact current `backups` row. The running update is
  created by `updates/store.ts:74` before `safety.backup()`; a direct call to
  the existing full backup therefore fails `BACKUP_RECOVERY_REQUIRED`.
  The backup owner needs a narrowly authorized snapshot/control-operation
  seam, not a table-wide pending-operation exemption or a forged success.
- `backups/archive.ts:36` always calls `BackupHost.exclusive` around export.
  Holding the default runtime's exclusivity and then calling this host again
  would hit the existing nonreentrant admission guard. An already-held,
  authenticated owner-scoped snapshot seam is needed.
- `packages/runtime/src/admission.ts` scopes authority with
  `AsyncLocalStorage`. Returning a release handle from a long-lived exclusive
  callback does not make the caller of `quiesce()` inherit that callback's
  admitted context. The update service's later phase/backup receipt SQL would
  run outside the retained owner and be denied. A retained physical lock alone
  is insufficient even before crash recovery.

These are source-traced integration constraints, not new execution receipts
or changes to the backup/admission producers. They reinforce the need for an
explicit controller/control-storage architecture rather than a host-only
Promise wrapper.

The original request was for the parent to choose and own either a durable installation maintenance fence
checked at admission by every API/repository/worker role, plus reconnectable
control storage after live rollback, or a separately supervised installation
controller with independent control storage and explicit all-role stop,
restore, restart and recovery authority. A timed lease or API-local flag is
not an equivalent substitute. Required proof includes killing the updater
after migration/activation, observing writes remain denied on surviving roles,
and exact operator recovery before admission reopens.

No configured installer, competing per-API scheduler, no-op safety callback,
production update or live restore is being introduced.

## Inquiry seam resolved

`services/operations/support/inquiries.ts` already exposes `InquiryOutbox`
with `recipient(): string | null` and
`enqueue(tx: Transaction, inquiry: SupportInquiry): Promise<void>`.
At initial inspection `services/adapters/delivery/index.ts`, `module.ts` and
the aggregate exposed drain/schedule/close, not a configured support recipient
or transactional enqueue function. Existing `MailDelivery.claim()` consumes unsent
`mail_outbox` rows with status `local`/`pending`.

Parent supplied and verified the exact adapter aggregate `inquiries` handle
in `docs/handoffs/p3-support-inquiry-adapter.md`: validated
`AdapterDeployment.supportRecipient` / `QUIRE_SUPPORT_RECIPIENT`,
SQL-only insertion into the existing `mail_outbox` using the supplied
transaction, dedupe key `support:<inquiry.id>`, and no network I/O or second
SMTP sender. Parent receipt `bash_179` passed five affected adapter tests,
type-aware lint and full repository TypeScript.

Composition now passes its fresh aggregate's handle into the native support
registration. The comparison is registration-function identity, not merely
the module ID, so a custom replacement registration remains untouched.
No extra aggregate or sender is created. Without the configured recipient
the default route still durably saves the inquiry and returns truthful
503 `SUPPORT_UNCONFIGURED`.

Both parent message attempts failed with:
`The delivery this send continues is not one the sender received.`
The parent subsequently received the escalation through the task channel,
assigned read-only authority design `st_01a17dda` to
`docs/architecture/installation-authority.md`, and supplied the actual inquiry
handle. This on-disk handoff retains the original evidence rather than
claiming the initially missing hook never existed.

## Delivered host integration

`services/operations/index.ts` exports exactly:

```ts
operationalModules: readonly ServiceModule[];
registerSupport: typeof import("./support").register;
startSupport: typeof import("./support").startSupport;
stopSupport: typeof import("./support").stopSupport;
```

`operationalModules` contains O070 updates (`070-o-updates`, order 70,
additive migration `070-o-updates`) and O085 support (`085-o-support`,
order 85, additive migration `085-o-support`). Both supply explicit SQLite
and PostgreSQL producer SQL. Native `composition.modules` includes this
catalog once. The existing schema-only migration collector consumes it
without starting any operational worker.

`createApplication` preserves its existing options and return shape. During
registration it binds only the actual native `registerSupport` function to
the same application's fresh `adapters.inquiries` handle. A custom same-ID
registration is not overwritten. Explicit `modules` and adapter aggregate
replacement/ownership semantics remain intact.

`app.start()` starts support once only when that native support registration
was selected. `app.close()` awaits support before closing aggregate adapters,
environment work, compiler/review resources and storage; its existing
all-sibling cleanup/error handling remains. No update scheduler is started.
Backup shared root, signing key, isolated fresh target, compiler quiescence
and required direct WebSocket message callback are unchanged.

Actual support delivery initially lacked whole-network writer admission.
A real external flock probe reproduced the defect (exclusive acquisition
incorrectly succeeded while the receiver held acknowledgement).
`startSupport` now wraps its complete dispatch in
`context.admission.background`, retaining the existing native/distributed
writer authority through acknowledgement persistence. This is an integration
fix, not a replacement admission implementation.

## Current verification

Monitor `mon_Q15R5GEA8NN7THK1`, project-local Bun 1.4.4:
`./node_modules/.bin/bun test tests/integration/operations` exited 0:
7 pass, 0 fail, 34 assertions, 55.48 seconds.
Monitor `mon_NQ2K6QVWDPAW79AN` scoped strict TypeScript and type-aware
deny-warning lint exited 0 (`OPERATIONS_STATIC_EXIT types=0 lint=0`).

These checks prove actual default HTTP operator success and denial,
once-only/reopened migrations, fail-closed update submission, redacted real
support JSON/core download, current download authority, durable unconfigured
inquiries, configured transactional outbox/restart/dedup, single support
runner, awaited acknowledgement before SQL shutdown, custom catalog
replacement and actual kernel admission across support delivery.

That run's downloaded bundle was 2,747 bytes, operation
`bde62ac0-7fb4-4101-9b3a-30b383301fdb`, SHA-256
`f3ad96934f617c5c408ca1ea7b5b95cb06a2c2260e40cf3dbab4711e73db26c1`.
Queued inquiry `76028231-d22c-4ebb-b359-903ca9c5d997` had exactly one local
mail row; no external email was sent.

After that run, the native-support start guard was narrowed from module-ID
matching to function identity, its same-ID custom regression was tightened,
and receiver cleanup logging captured the original ephemeral ports before
stop. The final capture/checks are running separately; the prior passing
receipt is not presented as a verification of those later edits.

The subsequent frozen-source final support gate is now terminal:
`mon_3QVFNAJ4HDN8829H` exited 0 on project-local Bun 1.4.4:
**7 pass, 0 fail, 35 assertions, 43.24 seconds**.
`mon_J0EYYC4GRBGP121E` strict types/type-aware lint exited 0.
Exact commands and test outcomes are in
`docs/evidence/p2o-integrate/support-acceptance.md`.
The final downloaded bundle operation was
`e06f4ad3-5d84-4a04-bb81-4d2d27ab60c5`, 2,747 bytes, SHA-256
`0431e1d53f2b22c4636ae65fbc1b05cda18f19116883d2408647193b91a002b0`.
Its allowlisted JSON is retained as `support-bundle.json` with one text-file
newline (2,748 bytes, SHA-256
`aaf4fc482be8f17618d7e6d9a32a86fbe6c05636b4fe17af2faf4c6d5842a0c4`).
Final configured inquiry `47e70ec9-182b-4699-a525-025183464b87`
had exactly one local outbox message.

`source-fingerprints.md` records the exact current source graph anchors and
pure-line counts; the post-run hashes matched. `cleanup.md` records the
exit-0 read-only audit: no task-prefixed roots, final API/receiver listeners
or owned integration test process remained. All actual teardown was awaited.
Composition's final fresh LSP request timed out; the strict compiler includes
it and passed. No diagnostic or failure was suppressed.

No signed installation-host migration/rollback/crash-recovery proof has run:
it remains blocked on the parent-owned authority decision, not covered by the
producer's sandbox tests. Historical deployment/environment/worker/backup/
SSH/update receipts were not rerun or relabeled.

## Support-host architectural review

1. Single responsibility: composition owns application lifetime; the catalog
   owns operational descriptors; the support runner owns SIEM lifetime.
2. Boundary purity: actual producer routes/configuration parse their inputs;
   the host passes the existing typed inquiry handle.
3. Variant discrimination: no new tagged union dispatch was introduced.
4. Escape hatches: no casts, `any`, non-null assertions or suppressions added.
5. Defensive layers: identity comparison selects the actual module contract,
   not a guessed service/module ID; existing lifecycle contracts are reused.
6. Helpers: the fixture has multiple real tests; no one-off production
   abstraction, duplicate aggregate or sender was introduced.
7. Tests: actual HTTP/schema/outbox/download/shutdown behavior fails if host
   wiring is removed; the kernel probe reproduced the admission regression
   before its fix.
8. Parameters: added functions remain within three inputs.
9. Verification: production contains no post-setter/readback or post-delete
   query; exact external cleanup audit is the task's explicit evidence gate.
10. Names: no negative-form domain flags or invented semantic aliases added.
11. Logging: no production logging framework or new log message introduced;
    test receipts contain only owned resource IDs/ports and redacted output.

All changed TypeScript files are below 200 pure lines, with composition
largest at 172. The current support artifact still reports the producer's
historical minimum Bun metadata `1.3.14`; it is not the current package-engine
authority (`>=1.4.4`). This unrelated metadata was left unchanged and actual
verification used 1.4.4.

## Subsequent parent-owned follow-up

The parent is independently verifying C36b notification digest flushing
inside the existing admitted adapter delivery tick (`bash_183` pending at
notification). No inquiry API, timer-count or sender contract changed.
Per explicit parent direction this integration did not edit the adapter
file or rerun its unchanged support proof. The captured adapter fingerprint
is that proof's input, not a claim that later parent source never changed.

The parent then supplied verified `bash_183`: ten actual governance,
digest and scheduled TLS delivery tests passed, scoped lint/full repository
TypeScript exited 0. `docs/handoffs/p3-digest-scheduling.md` was read as the
separate producer receipt. Its two pre-initialization timeout roots remain
parent-owned final-audit work; they are not this task's `quire-p2o-integrate-*`
roots and were not adopted or removed by this lane.

The default five-minute design file subscription expired before publication;
it was replaced with persistent `mon_F8F94KBJE4XP64YT`, still awaiting
`docs/architecture/installation-authority.md`. Configured update work remains
pending, not silently reduced to support-only completion. The design has now
published and selected the stable-supervisor alternative; foundation readiness
and the later host integration remain separate required work.
