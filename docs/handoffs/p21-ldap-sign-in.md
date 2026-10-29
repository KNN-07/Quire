# P21 LDAP sign-in - FINAL

Date: 2026-10-28. Child task: `st_01a1814a`. No commits.

## Delivered

`ProviderOptions` recognizes the exact `ldap` ID registered by
`services/adapters/federation/index.ts`, not a label or an inferred protocol.
Enabled LDAP opens the native directory username/password form with Back.
Disabled availability remains disabled and retains the backend reason.
Other provider IDs still navigate through `endpoints.identityStart`.

`ldap-sign-in.tsx` posts `endpoints.ldapLogin`, displays the actual server error,
refreshes the session, and navigates to the caller's existing safe local target.
The JSON endpoint validates only hash-free projects/settings continuations;
the consumer therefore sends that allowed path/query, or `/projects` for signup,
while preserving the safe client navigation target, including its fragment.
Signup explicitly advances its existing local step before SPA navigation, so
`/sign-up?step=start` actually displays the starting-point form.

Owned implementation files:

- `apps/web/src/features/account/auth.tsx` (provider props and signup transition only).
- `apps/web/src/features/account/auth-options.tsx`.
- `apps/web/src/features/account/ldap-sign-in.tsx`.
- `tests/ui-product/account/ldap-sign-in/browser.test.ts`.
- `tests/ui-product/account/ldap-sign-in/tsconfig.json`.

No backend, contract, shared CSS, original input, feature-matrix, or unrelated test
was edited. Existing worktree changes were preserved. Domain discovery and its
chooser remain the parent's lane; both auth integration files were reported
settled to the parent.

## Final command receipts

Run from `/home/norman/Repos/Quire`:

```sh
./node_modules/.bin/bun test tests/ui-product/account/ldap-sign-in
./node_modules/.bin/tsc --noEmit -p tests/ui-product/account/ldap-sign-in/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings apps/web/src/features/account/auth.tsx apps/web/src/features/account/auth-options.tsx apps/web/src/features/account/ldap-sign-in.tsx tests/ui-product/account/ldap-sign-in/browser.test.ts
```

All three exited **0**. Final browser result: **1 pass, 0 fail, 49 assertions**,
57.25 seconds. Raw output and explicit exit markers:

- `docs/evidence/p21-ldap-sign-in/test-final.log`: `TEST_EXIT=0`.
- `docs/evidence/p21-ldap-sign-in/tsc-final.log`: `TSC_EXIT=0`.
- `docs/evidence/p21-ldap-sign-in/oxlint-final.log`: `OXLINT_EXIT=0`.

Commands were run with `set -o pipefail`, output piped through `tee`, and
`${PIPESTATUS[0]}` preserved as the command exit. The final logs append the raw
exit marker before the wrapper exits with that same code.

The final single browser run proves:

- Actual disabled federation capability disables LDAP.
- Enabled LDAP opens the form; Back restores options and ordinary email input.
- Real TLS directory rejection returns HTTP 401, `LDAP_CREDENTIALS_INVALID`,
  and the exact visible message `Directory authentication failed`.
- Correct directory credentials return HTTP 200 and a `quire_session` cookie.
- Session refresh and reload both produce authenticated `/api/me` HTTP 200;
  profile inputs contain `Directory Researcher` and `directory@example.test`.
- The local settings query/fragment survives navigation.
- A foreign-origin return target falls back to `/projects`.
- Shared signup reaches the actual `What are you writing?` starting-point UI.
- Ordinary password sign-in still returns HTTP 200.
- An OIDC provider deliberately labeled `LDAP-looking OIDC fixture` still uses
  the real 302 authorization redirect and completes its real 303 callback.
- SAML still uses its real 302 start redirect with `SAMLRequest`; LDAP is disabled
  when SAML is selected. SAML assertion completion is not claimed by this scope.
- No browser page errors or horizontal overflow were observed.

No successful HTTP response was mocked. The test reuses
`tests/adapters/federation/ldap-fixture.ts`, its trusted TLS certificate and
directory user bind, `connectionApplication`, and the existing native Chromium
browser harness. Event/response subscriptions are registered before actions and
handled together; screenshots await fonts and a paint-frame signal, with no
fixed sleeps.

## Earlier receipts retained

The same browser command initially exited 1 in `test-1.log` because the existing
fixture image was absent. The unchanged repository Dockerfile was then built
once:

```sh
docker build -t quire-p2x-federation-ldap:st_01a17c62 -f tests/adapters/federation/Dockerfile tests/adapters/federation
```

Build exit: **0**, raw output `fixture-build.log`. Image:
`sha256:90d06f578fab2faf97b002904f3e0e0149e2600de63e4cded6dbbbdb3344be2d`.
The reusable image cache remains; no container remains from this task.

`test-2.log` exited 1 on the hash-bearing backend continuation rejection, fixed
in the consumer. `test-3.log` exited 1 after unhandled pending test subscriptions
interrupted teardown; those subscriptions were corrected. `test-4.log` exited 1
on the new test's unsupported `postDataJSON()` assumption. `test-5.log` exited 1
on looking for a profile input value as body text. `test-6.log` exited 1 on the
new test's incorrect OIDC start-status expectation (302, not 303). All were
corrected before the final passing run.

Earlier scoped TypeScript runs exited 0. `oxlint-4.log` exited 1 on a newly added
paint callback shadowing the imported `resolve`; it was renamed, and subsequent
lint runs including the final run exited 0. These are implementation/test
iteration receipts, not remaining failures.

## Screenshots inspected

Evidence directory: `docs/evidence/p21-ldap-sign-in/`.
All 16 final PNGs were opened and visually inspected:

```text
disabled-1440-light.png          disabled-1440-dark.png
disabled-390-light.png           disabled-390-dark.png
credentials-1440-light.png       credentials-1440-dark.png
credentials-390-light.png        credentials-390-dark.png
wrong-credentials-1440-light.png wrong-credentials-1440-dark.png
wrong-credentials-390-light.png  wrong-credentials-390-dark.png
authenticated-1440-light.png     authenticated-1440-dark.png
authenticated-390-light.png      authenticated-390-dark.png
```

Viewport sizes were desktop 1440x900 and mobile 390x844, with full-page captures.
LDAP fields, Back, submit, actual error, disabled reasons, and persisted profile
inputs are readable without overlap or horizontal overflow in both schemes.

Residual visual finding: the unchanged static AuthShell intro text is absent
from the dark sign-in captures even though its borders remain; the LDAP form
and error remain visible. Light intro and authenticated profile captures render
their text. The cause was not established and is not presented as a fixed
capture issue or a pixel-clean whole-shell result. The parent was notified;
shared `account.css` and the original intro were not changed in this lane.

## Cleanup

The final test closed its browser/context, provider HTTP fixture, application
adapters/runtime/API, Vite process, TLS directory container, certificate root,
and application root through their actual disposers.

Final owned resources, all closed/removed:

- Application root `/tmp/quire-ui-integrations-yvsP0X`.
- Certificate root `/tmp/quire-federation-certificate-8sWM5B`.
- Container `quire-p2x-federation-fbbcee8f-7216-4baf-aa76-d2c10d4b62ef`.
- Web/API/provider/LDAP ports `39539`, `40397`, `37403`, `33127`;
  direct socket probes each returned `ECONNREFUSED`.

`cleanup-final.log` records root/certificate absence checks exiting 0, container
inspect exiting 1 (absent), and an exact Vite command match exiting 1 (absent).
The final test also asserts root/certificate removal and container absence.

The interrupted third run required exact manual cleanup: Vite PID `187878`,
container `quire-p2x-federation-4313c9be-fc57-4a33-b88f-ee714e0c86e1`,
`/tmp/quire-ui-integrations-c2P3uP`, and
`/tmp/quire-federation-certificate-kXSDXl`. TERM, container removal, and exact-root
removal each exited 0; subsequent absence probes are retained in
`interrupted-cleanup.log`. Other test attempts completed their cleanup normally.

Every owned monitor was stopped:
`mon_S6FX09VKN09Q3914`, `mon_2E6HNK2Y0298H4ZP`, `mon_CDH0NHEXSPWDVR4H`,
`mon_WSM1JJQDD8EGMHAJ`, `mon_4XBV0871GE7NP23J`, `mon_9PA2JCM68G4TT6DF`,
`mon_9C0BV02169HMQQYF`, `mon_KBBZYJA23XEV109F`, and `mon_40JJQ9K0PTTVC5P3`.
No other session's processes, fixtures, or files were cleaned.

All authentication evidence is from controlled local fixtures. No live
institution, production directory, or institutional federation deployment was
validated or is claimed.
