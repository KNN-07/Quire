# P21 LDAP sign-in independent verification: FINAL FAIL

Audit date: October 28, 2026. Evidence cutoff: 2026-10-28T07:04:27Z.
Verifier: child `st_01a18151`, parent `01a17963-4d3c-715c-a44c-212374491a0a`.
Repository: `/home/norman/Repos/Quire`, HEAD `17a8dd43e2f6662dad590de746339d24fe6181d4`, shared dirty working tree.

**Binary verdict: FAIL.** This is a bounded evidence audit, not a claim that all
implemented behavior is broken. The required producer report was absent and the
available browser test receipt failed before exercising the consumer. No live
institution success is established.

## Findings, ordered by severity

1. **P1 FAIL - required FINAL producer handoff absent.**
   Reading `docs/handoffs/p21-ldap-sign-in.md` returned ENOENT; the subsequent
   existence probe returned 1. The nearby `p21-domain-discovery.md` explicitly
   says IN PROGRESS and describes a separate parent-owned track. It cannot
   substitute for the missing LDAP producer report.

2. **P1 FAIL - no successful real TLS LDAP consumer run.**
   `docs/evidence/p21-ldap-sign-in/test-1.log` records Bun 1.4.4, 0 pass/1 fail,
   and `LDAP exited 125` because image
   `quire-p2x-federation-ldap:st_01a17c62` could not be found or pulled.
   The 125 is the Docker child exit, not an established Bun process exit code.
   The receipt does not record the exact launching command or outer exit.
   Therefore the requested
   `./node_modules/.bin/bun test tests/ui-product/account/ldap-sign-in`
   exit 0 is **not verified**. `fixture-build.log` subsequently reports an image
   build/export, but contains neither a subsequent login run nor an outer exit
   receipt. Building the image does not prove authentication.

3. **P2 FAIL - type/lint command and exit provenance missing.**
   `tsc-1.log`, `tsc-2.log`, `oxlint-1.log`, and `oxlint-2.log` are all zero bytes.
   Silent tools can succeed, but these files establish neither the actual
   commands/scope nor exit 0. No original terminal receipt identifiers or
   run-time source manifest were supplied in a producer handoff. Current source
   hashes below cannot retroactively establish which inputs earlier checks used.

4. **P2 FAIL - Back secret clearing and unconfigured availability lack coverage.**
   In `tests/ui-product/account/ldap-sign-in/browser.test.ts:80-88`, Back is
   exercised before entering a username/password; reopening is followed by filling
   credentials, not checking that previously entered credentials are empty.
   `:70-75` exercises disabled federation, not a separate unconfigured LDAP
   state. There is no execution evidence for either requirement. Conditional
   unmounting in `auth-options.tsx:33-34` suggests intended clearing but is not
   observable proof.

5. **P2 FAIL - visual acceptance and exact cleanup not evidenced.**
   The P21 evidence directory contains six logs and no PNG files. Consequently
   there were zero claimed P21 screenshots available to open; no desktop/mobile
   or light/dark visual PASS is issued. Older `p1-ui-admin/identity-ldap-*`
   screenshots are not evidence of this consumer and were not substituted.
   The failed log has no `LDAP_UI_OWNED` or `LDAP_UI_CLEANED` record, so no exact
   resource inventory, removal, listener shutdown, or browser shutdown is proven.
   Cleanup assertions at `browser.test.ts:197-208` are source, not receipts.

6. **PASS - static consumer/fixture design only, not runtime acceptance.**
   `ldap-sign-in.tsx:20-24` calls the typed `ldapLogin` endpoint and refreshes the
   session before navigating. `auth-options.tsx:43-44` branches on provider ID
   `ldap`; other IDs retain `identityStart` redirects. `auth.tsx:34-38`
   normalizes same-origin returns and falls back to `/projects`.
   `tests/adapters/federation/ldap-fixture.ts` starts a real Docker slapd fixture,
   provisions it using LDAPS, and exposes its certificate; the inspected browser
   test does not replace successful LDAP responses with mocks.
   `services/adapters/federation/ldap.ts:23-37` requires verified TLS (or STARTTLS),
   performs service-account search, and then binds as the returned user DN.
   These observations establish intended wiring only; the available test stopped
   before proving it works.

## Required behavior evidence ledger

Every FAIL below means acceptance evidence is missing or failed, not a proven
production defect unless stated in the findings.

| Requirement | Verdict | Available evidence / missing proof |
| --- | --- | --- |
| Exact scoped Bun command, exit 0 | FAIL | Only failing test log; exact command and outer exit absent |
| Scoped tsc and lint | FAIL | Four empty logs; command, scope, exits and source binding absent |
| Real TLS LDAP login without success mocks | FAIL | Authentic fixture/source design; fixture startup failed in available run |
| Wrong password denied, no session | FAIL | Assertions at browser test `:89-102`; no reached response receipt |
| Safe local return and external fallback | FAIL | Assertions at `:104-122`, `:127-140`; no execution receipt |
| Back does not retain a secret | FAIL | Only empty-form Back tested; entered-secret reopen assertion absent |
| Disabled and unconfigured availability | FAIL | Disabled test written but not executed; unconfigured case absent |
| Preserved password/OIDC/SAML behavior | FAIL | Assertions at `:157-195`; no execution receipt |
| Session cookie, refresh and reload persistence | FAIL | Assertions at `:112-121`; no reached receipt |
| Both widths and themes | FAIL | Capture helper targets 1440x900 and 390x844, light/dark; no images exist |
| Exact cleanup | FAIL | Cleanup source exists; owned resource IDs and completed cleanup receipts absent |

## Provenance and source binding

The verifier directly read every existing P21 log and the inspected source, using
the session's `read` tool; SHA-256 values were obtained through read-only
`sha256sum`. The inventory and hash receipt is
`docs/evidence/p21-ldap-sign-in-verification/audit-inputs.md`.
No tests, compiler checks, lint checks, fixture builds, or browser runs were
replayed. The audit reports missing proof instead of producing replacement
evidence or competing with the producer. Only this handoff and the verifier's
evidence directory were written; production/test files were not edited and no
commit was created.

These are current audit-time hashes, not authenticated run-time hashes:

| Path | SHA-256 |
| --- | --- |
| `apps/web/src/features/account/auth.tsx` | `6f97b3b0d16e9e78f8f23550f8997760190366c173a7994774d46a65fa5e9392` |
| `apps/web/src/features/account/auth-options.tsx` | `2b6113b78642b08af986722ec49ee1827e8b65c42632d25ebae6324e6f699a76` |
| `apps/web/src/features/account/ldap-sign-in.tsx` | `cb5c092120131eb89bce79acc57e1d850b90adcdca4e58f6c8e83dff2026d5ec` |
| `apps/web/src/features/account/account.css` | `82ff3b5a0a6f564219acf8af2ee7ced5c19bd83b49ce7febe6397c319411289d` |
| `tests/ui-product/account/ldap-sign-in/browser.test.ts` | `fcbac6e7823c81438594eb358f6950513d8a9e7f725599531713dd9c6164429c` |
| `tests/ui-product/account/ldap-sign-in/tsconfig.json` | `8c343875a08381f6fc3e45139b921dd38618b48e96a06d37ce8535ba8245a560` |
| `tests/adapters/federation/ldap-fixture.ts` | `a7501d94039fa93ead565766a01268936e3534f5a55a2311ae4e89f8a1dcdf1f` |
| `services/adapters/federation/ldap.ts` | `0b2670e4692d7146786c515b796d794bfa626960555c03ce7b15bd5513e365ac` |
| `services/adapters/federation/index.ts` | `15c018d4fbef94d55088de7f486372ad8639fba67f7e6163bb37b26ea2132b26` |
| `packages/contracts/src/routes-accounts.ts` | `b68163e6fa0f9257a4b7bf7a771c0c19dd8eb30838a8515c016d26583c2885ce` |

## Remaining gates

1. Producer publishes a FINAL LDAP report with exact original commands, raw
   terminal process exits and run-time source hashes. Reuse unchanged successful
   checks; do not rerun them merely to generate a cleaner report.
2. Resolve the failed fixture prerequisite and supply a successful scoped real
   TLS consumer run, including wrong-password denial, cookie/session reload,
   safe returns, password/OIDC/SAML boundaries and exact owned-resource cleanup.
   A rerun of this previously failed check is allowed by the task restriction.
3. Supply entered-secret Back/reopen and unconfigured-availability evidence;
   source-only assertions or an empty-form Back click do not close those gates.
4. Supply the captured states at both widths/themes for direct visual inspection,
   tied to the successful source snapshot.
5. Live institution deployment remains an external gate: institution-controlled
   directory reachability, certificate trust, bind credentials, immutable subject
   mapping, admission policy and an authorized real-user login are not established
   by a local fixture, even if that fixture subsequently passes.

Evidence created after the cutoff is outside this verdict and requires a new
bounded review of the new receipts, not automatic acceptance.
