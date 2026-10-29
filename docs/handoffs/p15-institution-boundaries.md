# Institution admission boundaries: FINAL

October 28, 2026. Bounded A53a delivery, not complete institution parity.

Institution members must now self-enroll. Direct member creation and pending
organization invitations are rejected for institutions, including privileged
roles; administrators may still change roles for already-enrolled members.
Managed-account invitations and acceptance are team-only. Acceptance also
checks current organization kind, so a retained earlier invitation cannot
bypass the institution boundary.

Organization kind is now fixed at creation. Allowing a populated team to
be relabeled as an institution would otherwise bypass self-enrollment.
Name, domains and other permitted updates remain supported. No data migration
or automatic deletion of existing membership was introduced.

The account settings consumer hides direct admission and invitation controls
for institutions and links the real enrollment portal. Team controls remain
available. The native portal denies a nonmatching verified-email domain,
then permits the same user after an authorized domain configuration update.
Enrollment creates an unlicensed ordinary membership, not account management.

## Verification

Three new native cases first demonstrated the bypasses with successful 200
responses where denial was required. After the guards, the focused selection
passed **7 cases/70 assertions**, including the affected team invitation
cases and independent sponsorship/managed-release case. The latter's stale
institution setup now performs actual self-enrollment followed by separate
licensing; its preservation assertions were retained.
Account strict TypeScript and touched-source/test type-aware deny-warning
lint passed in the same exit-0 command: `mon_WY37A30K02D620TT`.

The actual institution settings and enrollment browser case passed
**1 case/17 assertions/45.73 seconds**, with scoped consumer types/lint,
exit 0 under `mon_YABYEP8TKX96M4PR`.
It verifies hidden admission controls, native eligibility 403 and subsequent
200, persisted ordinary membership and retained independent account control.
`docs/evidence/p15-institution-boundaries/browser.xml` retains the receipt.

The changed settings component's other branch was checked with the existing
team sender workflow: **1 case/11 assertions/42.45 seconds**, exit 0 under
`mon_NXXX2SWS4AE6ECPE`. Creation, resend, revoke and persisted nonmembership
remain functional. Its receipt is
`docs/evidence/p15-institution-boundaries/team-regression.xml`.

All twelve current screenshots were opened and inspected at 1440/390 in
light/dark: institution settings and successful portal enrollment under
`docs/evidence/p15-institution-boundaries/95a09ecc-100d-4b4f-9f1b-eed3758f4938/`,
plus team settings under
`docs/evidence/p14-organization-invitations/sender-5d9df50c-2b47-467b-aaac-15f163635960/`.
No overlapping or horizontally clipped principal controls were observed.
This is Chromium viewport coverage, not a cross-browser/touch claim.

## Cleanup and remaining boundaries

Both exact roots were independently absent:
`/tmp/quire-ui-integrations-0ki8mk` and
`/tmp/quire-ui-integrations-wsqaZK`.
Ports 36631/37799/43339/44861 independently refused connections.
Native tests use awaited isolated fixture disposal.

The supplied domain policy is operator-configured test data, not verification
of real-world institutional domain ownership. Department/IdP claim mapping,
reconfirmation configuration, scheduled eligibility reconciliation and distinct
institution product/AI scopes remain separate A53a/A53b obligations.
The public marketing header still displays its existing generic sign-in links
after enrollment; that unchanged navigation is not an authentication failure.
Original inputs and FastShort were untouched.

## Federation fixture follow-up

Two existing managed federation cases still configured an institution as
their managing organization. Their actual rerun failed at
`INSTITUTION_ACCOUNT_CONTROL`, confirming the new guard was enforced.
The managed cases now explicitly configure the existing team fixture, and
their shared acceptance helper uses the configured organization ID rather
than a hardcoded institution. Their transfer, suspension, release and
independent-recovery assertions remain intact; production guards were not
relaxed.

The corrected selection passed 2 cases/6 assertions, followed by federation
strict TypeScript and touched-test type-aware lint, exit 0 under
`mon_TYVKQC0YWM27G7MG`. Unchanged federation cases were filtered.
This fixes stale setup and does not close the separate accepted-managed
transferee requirement.
