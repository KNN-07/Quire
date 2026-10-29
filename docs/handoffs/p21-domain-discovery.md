# Organization sign-in discovery: FINAL scoped workflow

October 28, 2026. Parent-owned backend work; the separate LDAP consumer phase
owned `auth.tsx` and `auth-options.tsx` until its final run settled. The parent
then mounted the domain chooser on SignIn; signup remains on its existing
provider/LDAP flow.

## Contract

`endpoints.authDiscover`: public `GET /api/auth/discover?domain=example.test`.
The query accepts a domain, not an email address or URL, trims it and normalizes
case. The response is `{ organizations: [{ id, name, provider, capability }] }`.
Provider is `oidc`, `saml` or `ldap`. Responses are `Cache-Control: no-store`.
No account search, identity existence, credentials, group mappings, issuer
URLs or directory details are returned.

Identity supplies an empty result when no discovery reader is registered.
The federation module registers one reader using its explicit deployment
organization and current configured domains. Matching is exact, never suffix
or inferred from an account's email. Disabled matching configuration remains
visible with its actual disabled capability, not an enabled sign-in action.
The current deployment supports one federation organization; this does not
invent multi-tenant provider routing.

Discovery does not grant membership or authenticate anyone. Existing callback
verification, provisioning, current-configuration fences and LDAP admission
remain authoritative after selection.

## Current evidence

Initial native selection: one passed, one failed, 14 assertions, exit 1
(`mon_1HK9388WWP5F3TZT`, `bash_340`). Exact mismatch/suffix/email/URL denials
passed. The other case used the wrong seed organization name, "Quire
University", while the actual seed is "Quire Institute"; only that expectation
was corrected. A readonly handler declaration was also replaced with the
contract-inferred reader type after TypeScript diagnostics.

The failed case subsequently passed **1 case/5 assertions**, 615 milliseconds,
exit 0, followed by passing scoped federation strict types and typed
deny-warning lint (`mon_538CVD89AR7NGSJV`, `bash_341`). The separate earlier
negative case stands; these are not a fabricated combined green run.
The added route-registry check passed **1 case/2 assertions**, 89 milliseconds,
exit 0 under `mon_DP27XXBXGQ7G02XZ` (`bash_342`).
The parent added `apps/web/src/features/account/organization-sign-in.tsx`.
It submits the actual discovery endpoint, clears old results on input changes,
shows exact server availability and empty/error states, and provides Back and
provider-selection callbacks. Component diagnostics are clean.

Mounted browser acceptance passed **1 case/19 assertions**, 52.85 seconds,
exit 0 (`mon_GHAYP7X6XSSNK3KR`, `bash_353`), after scoped strict types and
type-aware deny-warning lint. It exercised Back, exact-domain rejection,
disabled configuration, removal of stale results on input change, enabling
current configuration, actual OIDC authorization/callback, requested local
settings navigation and authenticated session reload.
Four ready-state desktop/mobile light/dark screenshots under
`docs/evidence/p21-domain-discovery/641ed467-672c-4824-ae09-c7566a7e5cf1/`
were opened. Chooser controls are readable and do not overlap.

The separate LDAP Back scenario passed **1 case/11 assertions**, 51.16 seconds,
exit 0 (`mon_A0M9YYECFEBXAZ0C`, `bash_354`), with scoped types/lint.
It proves unconfigured LDAP is disabled despite federation being enabled,
entered username/password disappear after Back/reopen, and the domain chooser
selects the actual LDAP credential form. Its four captures under
`docs/evidence/p21-ldap-back/520fa66d-943f-4a3b-962e-714190c29c6c/`
were opened and show readable form controls.

The original LDAP final run remains a separate **1 case/49 assertions** proof,
not part of a fabricated aggregate. Parent read its original final logs and
exit markers, closing the early verifier's missing-receipt findings. The new
Back case closes that verifier's missing secret-clearing/unconfigured checks.
The historical `p21-ldap-sign-in-verification.md` FAIL remains preserved with
its earlier cutoff.

All three application roots and the producer's named certificate root were
independently absent. Ten exact web/API/provider/LDAP ports refused connections.
Native fixture disposers closed their browsers and directory containers.

## Remaining visual and deployment boundaries

The apparent dark intro omission was investigated separately. Raw PNG decoding
and exact pixel comparison confirmed the suspect captures contain the complete
intro; the omission was in their repeated inline presentation, not the stored
screenshots. `p21-intro-rendering.md` records the resolution. No production
styling was changed speculatively.

Live organization IdPs/directories, credentials and authorized real-user
acceptance remain deployment requirements. Discovery supports the configured
single federation organization and does not claim multi-tenant routing.
Existing successful federation protocol tests were not replayed.
