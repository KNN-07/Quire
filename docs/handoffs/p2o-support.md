# P2O support handoff

Owner: `st_01a17c34`. October 27, 2026.
Status: **native module verified; parent root/X wiring required**.
This does not claim the default application already exposes these routes or
that external support mail has been delivered.

## Terminal results

The final `bun tests/operations/support/verify.ts` terminated exit 0 using
native Bun **1.3.14**. Its retained component receipts are:

| Command | Terminal result | Evidence in `docs/evidence/p2o-support/` |
| --- | --- | --- |
| `bun test tests/operations/support` | Exit 0; 14 pass, 0 fail, 87 assertions, four files, 17.85 seconds | `support-tests.log` |
| `node_modules/.bin/tsc --noEmit --pretty false -p tests/operations/support/tsconfig.json` | Exit 0 | `support-strict.log` |
| `node_modules/.bin/oxlint --type-aware --deny-warnings services/operations/support scripts/ops/doctor.ts tests/operations/support` | Exit 0 | `support-lint.log` |
| `QUIRE_DATA_DIR=<owned temporary root> bun scripts/ops/doctor.ts` | Exit 0; actual native sandbox/PDF probe ready | `doctor-cli.log` |
| Final owned-process audit | Exit 0; no matching test, verifier or doctor process | `cleanup-final.json` |

`checks.json` records the four actual component exit codes. The language server
reported zero diagnostics across the seven support modules and six direct
test/helper files. Fresh single-file doctor diagnostics sometimes timed out;
the final scoped compiler check includes that file and passes.

Initial failures were repaired rather than suppressed: an outbox fixture
option was not wired, Bun's default PATH lookup did not follow the test's
changed PATH, and the scoped tsconfig needed the existing SQL asset
declaration. The recorded PATH/declaration failure receipts remain in
`support-tests-initial.log` and `support-strict-initial.log`. A concurrent
core Git optional-property error temporarily blocked the scoped compiler;
`support-strict-concurrent-git.log` retains that failure. It was resolved
outside this lane before the final clean run. No failing test was skipped,
deleted or weakened.

The earlier whole-repository typecheck encountered concurrent editor,
SSH, backup and compiler-profile work. This handoff claims the final scoped
strict/lint gates, not a final whole-product build or repository-wide pass.
PostgreSQL was not provisioned for this lane: native real storage is the
accepted execution profile, with explicit PostgreSQL migration SQL supplied.

## Implemented operations and observed artifacts

`diagnosticsCreate` requires real current operator/session/CSRF authority,
creates actual JSON bytes through the injected BlobStore, references that blob
in SQL and returns a persisted completed Operation. Core `operationGet` and
download stay untouched. Result metadata uses
`{blob,projectIds:[],operatorOnly:true,mime:"application/json",filename:"quire-support.json"}`.
The actual core byte-download path rechecks current operator authority.

The retained `diagnostic-canaries.json` is **2,746 bytes**, SHA-256
`6dd113e4f77a457abdfee9dafa6c22ad98ab9fb795ee681a602921d9be400538`.
Its operation ID is `5198612a-0140-409e-9212-d19af1c230e7`.
`diagnostic-artifact.json` records its observed byte count/hash and seven
canary exclusions. Private source, name, credential, settings, mail content,
email and temporary path inputs did not reach the downloaded bytes.

The bundle manifest explicitly declares contents and omissions. Redaction is
an allowlist before serialization, not regex replacement over arbitrary
records. It excludes source/generated documents, environment values,
credentials/encrypted secrets, PII, inquiry/audit contents, endpoint URLs,
filesystem paths and all subprocess output. Probes execute actual SQL,
repository-port reads, fixed tool version commands, TCP connectivity and
the accepted confined native compiler boundary with a generated TeX document,
real pdflatex and pdfinfo. No profile is marked available from PATH alone.

`auditSiem`/`auditSiemGet` use current operator authorization, ETag/version
checks, explicit enabled configuration and AES-GCM credentials using the
existing instance key/shared SecretBox. Production requires HTTPS; only
development loopback permits HTTP. Credential-bearing URL authority, query
and fragment are rejected. GET returns only credential presence.

SIEM delivery has an ordered durable audit cursor, SQL lease, stable audit-ID
idempotency key, persisted attempts/retry deadlines, no redirects, no hidden
HTTP retry and a five-second request deadline. Network I/O is outside SQL
transactions. Disable/rotation fence stale claims, and dispatch checks the
configuration author's current active operator authority. Receiver failures
never advance the cursor. The worker retries storage-admission failure,
clears recovered failure state, and shutdown drains its pending work.

`siem-receipts.json` records actual receiver port **38165**, three received
HTTP attempts, exactly two durably ingested ordered events (sequences 1 and 2),
final cursor 2, zero remaining attempts and no last error. The first receiver
durably ingested an event but returned 503; it was then stopped, dispatch saw
the real outage, and the receiver restarted on its original port. The API
storage was also closed/reopened before retry. The receiver deduped the
stable event key. This is at-least-once HTTP with receiver-side idempotency,
not an exactly-once transport claim.

`supportInquiry` bounds and privately persists request input, including
unconfigured submissions across actual runtime close/reopen. HMAC-scoped
idempotency prevents duplicate enqueue and rejects changed-payload reuse.
Configured delivery is an atomic SQL outbox hook, never a duplicate SMTP
sender. Without a configured recipient/hook, the response truthfully returns
503 `SUPPORT_UNCONFIGURED` with the saved opaque inquiry ID. HTTP 200 means
queued, never delivered or a promised SLA.

`inquiry-receipts.json` retains the actual queued inquiry
`8f223f53-94ff-4847-8884-b965f4833497` and its one durable local mail row
`944f99e5-153a-4bf9-bee9-e18560f28323`. The mail remained local and no real
message was sent. Concurrent duplicate requests produced one inquiry/mail;
unconfigured input produced no mail.

`doctor-report.json` and `doctor-cli.log` separate required native probes,
optional installed tools, optional configured provider metadata and stored
compiler-profile observations. The native tool/sandbox checks passed; Docker's
actual version command passed, while Pandoc/R were missing and optional
providers unconfigured. Provider connectivity is explicitly `not-probed`.
Negative tests prove a present executable with exit 73 is degraded, an absent
port is degraded, and losing the real configured Git store degrades native
readiness even when SQL/tool probes succeed.

## Exports and integration requests

The O module is `services/operations/support/index.ts`:

```ts
register(context: ModuleContext, options?: {
  readonly inquiries?: InquiryOutbox;
}): void;
startSupport(context: Omit<ModuleContext, "routes">): void;
stopSupport(context: Pick<ModuleContext, "services">): Promise<void>;
dispatchSiem(context: Omit<ModuleContext, "routes">):
  Promise<"idle" | "delivered" | "retry">;
```

It also exports `migrations`, `diagnosticBytes`, `bundleContents`,
`bundleOmissions`, `toolProbes`, `compilerProbe`, `portProbe`,
`runtimeProbes`, `providerConfiguration`, and the `SupportInquiry` and
`InquiryOutbox` types. `doctor(context: ModuleContext)` is exported from
`scripts/ops/doctor.ts`.

One additive migration, **085-o-support**, supplies explicit SQLite and
PostgreSQL variants for `support_siem` and `support_inquiries`. No original
SQLite migration bytes were edited. SQL uses the async executor/transaction
ports; the supplied callback executor is passed through every transactional
operation. Blob/Git/network work does not occur inside a transaction.

The parent must perform these out-of-scope integration writes:

1. Register `{id:"085-o-support",lane:"O",order:85,migrations,register}` after
   identity in root composition. No overview or core-operation routes should
   be duplicated.
2. Call `startSupport(runtime)` at application start, and await
   `stopSupport(runtime)` before adapter shutdown.
3. X must provide the actual outbound-mail hook through
   `register(context,{inquiries})`:

   ```ts
   type InquiryOutbox = {
     readonly recipient: () => string | null;
     readonly enqueue: (tx: Transaction, inquiry: SupportInquiry) => Promise<void>;
   };
   ```

   `SupportInquiry` contains the parsed form fields plus shared branded `Id`.
   The hook is SQL-only, uses X's configured recipient/local-or-SMTP outbox,
   and deduplicates on the stable inquiry ID. It must not send network mail
   inside the transaction. No such X hook was available at final inspection;
   the module therefore stays truthfully unconfigured without injection.
4. Change the root `doctor` package command to `bun scripts/ops/doctor.ts`.
   At final inspection it still referenced the foundation PATH inventory.

Root composition, package files, X directories and `packages/**` were not
edited. Child-to-parent `thread_send` repeatedly failed with
`unknown_cause: The delivery this send continues is not one the sender received`;
the exact requests were retained in this handoff while independent work
continued. Default-app exposure and configured external support delivery are
not claimed complete.

## Exact cleanup and final review

Every final test API port, exact temporary root and doctor CLI resource is
recorded in `cleanup-final.json`; the doctor root was
`/tmp/quire-p2o-support-doctor-cli-i7iDkw`, port **38341**.
All 13 final fixture roots were removed after awaited listener/adapter closure.
The native test/verifier/doctor processes terminated, receiver stop calls
were awaited, compiler probe roots were removed in finally, and tool exits
were awaited. Final `/tmp/quire-p2o-support*` inspection returned no matches;
the owned-process audit returned no matches and exit 0.

No container/volume, production installation, external posting, destructive
restore, workspace commit or push occurred. Unattributed generic compiler
probe roots were not touched. Only the scoped support source/tests, doctor,
runbook, handoff and evidence were authored.

`architecture-review.md` records the complete eleven-point post-write review.
Modules have one responsibility; boundaries are parsed; no type escape hatch,
test suppression, oversized module, parameter-bloat wrapper, duplicate sender
or duplicate integrity check was introduced. The largest direct test has
180 pure lines; production support modules range from 19 to 109.
The operational instructions are in `docs/runbooks/support.md`.
