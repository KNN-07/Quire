# P63 environment admission errors

FINAL, October 28, 2026. The expected unbuilt-image and incompatible-policy
denials now return actionable typed HTTP errors instead of `500 INTERNAL_ERROR`.

## Mapping and boundary

`services/operations/environments/create.ts` catches only rejected `probeImage`
calls, recognizes the actual installation `ControlError` class, and maps:

| Broker code | HTTP | API code |
| --- | --- | --- |
| `CONTROL_EXECUTION_PROFILE_REQUIRED` | 409 | `ENVIRONMENT_EXECUTION_PROFILE_REQUIRED` |
| `CONTROL_EXECUTION_POLICY_DENIED` | 403 | `ENVIRONMENT_EXECUTION_POLICY_DENIED` |

The first response explains that the exact image needs an available reviewed
profile or successful installation-owned build, and directs the operator to the
installation environment builder or reviewed profile provisioning. It does not
claim that every missing profile means the image is physically absent.
The second directs an operator to check API role, work kind, resource limits and
profile compatibility; it does not label every policy rejection as a role error.

All other errors are rethrown unchanged. There is no catch around registry
publication, no fallback execution and no successful response on denial.
The catch precedes `saveEnvironment`, leaving environment, receipt, audit and
idempotency publication unreachable on these rejected probes.

## Observable verification

Pinned executable: `./node_modules/.bin/bun`, version 1.4.4, SHA-256
`10702245766b225e70bbf6235fd6b47214fd94b4760d00ffaed8ab0df57ac235`.
Final commands began at `2026-10-28T22:05:51Z`:

```sh
./node_modules/.bin/bun test tests/operations/environments/admission-errors.test.ts tests/operations/installation/environment-admission-denials.test.ts
./node_modules/.bin/bun node_modules/typescript/bin/tsc --noEmit -p docs/evidence/p63-admission-errors/tsconfig.json
./node_modules/.bin/bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings --tsconfig docs/evidence/p63-admission-errors/tsconfig.json services/operations/environments/create.ts tests/operations/environments/admission-errors.test.ts tests/operations/environments/admission-role.ts tests/operations/installation/environment-admission-denials.test.ts
```

The final test invocation passed once: 2 tests, 32 assertions, zero failures,
26.55 seconds, `P63_FINAL_TEST_EXIT=0`. Strict scoped TypeScript and typed
deny-warning lint both exited 0; `P63_FINAL_STATIC_EXIT=0`.
Production-file LSP diagnostics were clean. A later fresh test-file LSP request
timed out; the completed strict TypeScript command is the static-check evidence.

`admission-errors.test.ts` provisions an isolated baseline before authority
startup, bundles `admission-role.ts` as its release factory, and starts actual
kernel-attested roles using the existing supervisor fixture. The helper exposes
the real application through an ephemeral loopback HTTP listener. No asserted
route, identity, probe, sandbox, execution client or broker is mocked.

An actual operator login and CSRF-protected `POST /api/admin/environments`
exercise the complete route-to-broker chain:

- An unbuilt exact image returns 409 with the profile-required API code.
- The exact existing image reviewed for a compiler-worker role returns 403 with
  the policy-denied API code.
- An image whose reviewed profile has the wrong work kind also returns that
  same 403 code, establishing that the policy category is broader than roles.
- A real, deliberately invalid execution source produces the unmapped
  `CONTROL_EXECUTION_SOURCE_INVALID`; the API continues returning
  `500 INTERNAL_ERROR`. The authenticated broker assertion and retained role
  journal establish the underlying error, not just the HTTP status.

Every request is retried with the identical body and idempotency key. After
each response, actual SQL snapshots of environments, environment receipts,
create idempotency results and environment-created audit entries are unchanged.
The broker launch ledger remains empty. The existing actual broker denial test
is unchanged and still proves unbuilt, wrong-role and absent-profile denials.
Tests use event-based fixture readiness, not sleeps or retry-until-pass.

## Raw evidence and cleanup

All files below are under `docs/evidence/p63-admission-errors/`:

- `final-focused-tests.log`: command, UTC, pinned version, pre-run source hashes,
  individual API responses, unchanged-publication result, broker denials,
  fixture ownership/cleanup and final exit marker.
- `final-scoped-static.log`: complete commands and independent type/lint exits.
- `owned-inspection.log`: cleanup at `2026-10-28T22:07:07Z`, final source hashes,
  executable hash, closed API port and actual unknown-error role journal.
- `tsconfig.json`: strict scoped entrypoints, extending the repository config.
- `focused-tests.log`, `api-diagnostic.log`, `scoped-static.log`: retained earlier
  failures, not combined into the passing result. The initial API fixture lacked
  the complete caller role metadata and therefore returned 400 before reaching
  the broker. The diagnostic run exposed those fields; isolated baseline
  provisioning was corrected. Initial lint found a `HeadersInit` object spread;
  the test now uses `new Headers`. Neither failure required changing production
  authority or weakening an assertion.

Final test monitor/session: `mon_F91K9WZ20XFQENH6` / `bash_9`.
Final static monitor/session: `mon_JCB8PJFJ24EQ49W6` / `bash_10`.
Cleanup monitor/session: `mon_G9WDDFQVZK3FF3S2` / `bash_12`.

Independent inspection confirms all five exact roots from all attempts absent
and all 20 exact owned units not-found/inactive, with MainPID 0 and empty
ControlGroup. Port 37801 refuses connections (`curl` exit 7, expected absence).
Each fixture reports zero owned containers and images; no execution launch was
reserved. The shared baseline image was only inspected, not removed.
`P63_CLEANUP_EXIT=0`. Pre-run and post-run hashes match for the final production,
test, broker, caller-context and existing fixture inputs.

## Scope and inherited success evidence

The sole production edit is the narrow `create.ts` mapping. No broker authority,
signed admission/release semantics, compiler default, UI or full installed
success-chain file was changed. No commit was created, no listener used port
5173, and no unrelated service was changed.

The full signed build/adopt/revoke/PDF success is reused from
`docs/handoffs/p37-admission-recovery.md`, not rerun. Its accepted installed test
has 80 assertions, zero failures and `P37_INSTALLED_TEST_EXIT=0`; the retained PDF
SHA-256 is `329266371db7565fed5b76ea2bab3a0bab356be886bf7d9fc228177dfa7318f3`.
The P37 handoff hash remained
`51aa3437cb26d7c8959e2c55c5199c0e01911610c56135bf4fb5153edf0b9bf4`.
This task verifies only the requested API denial boundary, not a new whole-tree
build or a replay of the expensive installed success chain. Nothing is deferred
within that boundary.
