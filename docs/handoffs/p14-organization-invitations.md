# Pending organization invitation workflow: FINAL

October 28, 2026. Parent delivery; no migration, live SMTP delivery or
requested-origin acceptance is claimed.

The Organizations settings panel now creates pending invitations, lists them,
resends them with a rotated secret and revokes them. These actions remain
separate from immediate verified-account admission. Managers can invite
ordinary members; administrator/operator authority is required for privileged
roles and their resend/revoke controls.

The emailed `/organization-invitations/:id` account route uses the existing
invitation card. It survives sign-in, privately previews the current record,
requires explicit recipient acceptance and persists accepted membership.
Opening the link alone grants no access. Role and licensed-seat assignment
remain separate; acceptance creates an unlicensed membership.

The backend proof and its exact limits are in
`p14-organization-invitations-backend.md`: three cases/33 passing assertions
across the corrected selections, strict account types, touched-source lint
and the affected registry invariant. Shared database storage already had all
required fields in both dialects.

## Real browser acceptance

- Recipient: one case/11 assertions, 45.44 seconds, exit 0 under
  `mon_JXVVSKMAQP28Z49C`. Actual outbox link, signed-out sign-in return,
  pre-acceptance organization 403, explicit acceptance, persisted Manager
  membership without a license, post-acceptance 200 and accepted reload.
- Sender: one case/11 assertions, 42.92 seconds, exit 0 under
  `mon_B8YQMGTFC9HCZ8F0`. Actual settings form, queued pending invitation,
  no premature membership, resend/version change, revoke, reload and retained
  nonmembership.
- The existing project-invitation regression was rerun because the shared
  component changed: its case passed 28 assertions in 56.56 seconds. Its
  joined command failed on the new sender test's exact-label locator. The
  sender was corrected to use the existing Select's combobox accessibility
  name and rerun alone; the passing project case was not repeated.
- Final consumer strict types and touched-source/test type-aware deny-warning
  lint passed exit 0 under `mon_FX0X1P57XRMZN7V5`.

There are no successful-response mocks or fixed sleeps. Subscriptions precede
navigation and mutation actions. An earlier recipient capture had overly broad
manager licensing guidance; the final page correctly names an administrator,
and was recaptured after that correction.

Final packets under `docs/evidence/p14-organization-invitations/`:

- `93703648-e565-4638-8267-d61c00b5c96d/`: recipient.
- `sender-5e5117ae-b27f-4b0f-91f3-ff1d61d51ff5/`: sender.
- `acceptance-final.xml` and `sender-fixed.xml`: passing final browser commands.
- `sender-project.xml`: historical mixed command, not relabeled all-green.

All eight final screenshots were opened and inspected at 1440/390 in light
and dark. Principal controls are readable without observed overlap or
horizontal clipping. The settings form scrolls vertically. These are Chromium
viewport captures, not a new touch-device or cross-browser claim.

## Cleanup and boundaries

The following exact roots were independently absent after awaited disposal:
`/tmp/quire-ui-integrations-CtPdIN`, `-TYtbob`, `-2yasFu`, `-iUTjMU`, and
`-fCrDF3` (the latter four share the same `/tmp/quire-ui-integrations` prefix).
Their ten ports independently refused connections:
43993, 35811, 36189, 34779, 35915, 44709, 39633, 45897, 45733, 34969.
Failed-run artifacts were retained where present.

This closes pending organization invitations and ordinary verified-recipient
acceptance. It does not certify live mail/federation, a new PostgreSQL
invitation runtime, institution eligibility policy or accepted managed-account
offboarding. FastShort and port 5173 were untouched. Audit ZIP acceptance is
separate and still subject to its independent verifier's findings.
