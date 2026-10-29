# LDAP administration user-bind controls: FINAL scoped workflow

October 28, 2026. Parent-owned D12 native consumer correction.

`admin/Identity.tsx` now exposes test username/password when LDAP is selected.
Only the test endpoint receives these values. They are not part of the
configuration draft or save request. Test is disabled until both are supplied;
the password clears after every attempted test, and protocol changes, reload
and successful save clear the test credentials. A new test clears the old
operation display before making another request, so an earlier success is not
presented as the latest test result.

The existing exact TLS directory fixture was rebuilt for this new scenario
after its earlier completed-task image cleanup. No live institution is used.
Build succeeded under `mon_TFM0BKGMHH66MBHT` (`bash_376`).

Component/test diagnostics are clean. The first chained check stopped on a
new test's shadowed callback variable; that name was corrected without changing
an assertion. Scoped strict types, typed deny-warning lint and actual mounted
browser acceptance then passed under `mon_K4VGGKJXSEVN3AZQ` (`bash_378`):
**1 case/22 assertions**, 61.99 seconds, exit 0. The scenario proves wrong-bind denial,
successful real bind, no directory-account provisioning, unchanged stored
configuration until explicit save, no password in persisted test config,
successful versioned save, unchanged operator identity, desktop/mobile
light/dark captures and exact cleanup. No previous LDAP sign-in case was rerun.
Actual operation `dd747bf3-8a2f-4767-a0cf-040d5286b287` was succeeded and
verified; the saved configuration advanced to version 2 only after explicit
confirmation. The operator remained the operator and no directory account
was created.

All four screenshots under
`docs/evidence/p27-admin-ldap/37c40c13-f5c2-4c7a-b056-1cd9e2a6f5b3/`
were opened. Mobile fields are readable without overlap; desktop frames were
scrolled below the new controls, so they do not close that visual gate.
The focused capture case passed **1 case/8 assertions**, 50.99 seconds, exit 0
under `mon_8E5T4M4GETH6PH86` (`bash_379`), after scoped types/lint.
All four corrected frames in
`controls-48aac643-5c7d-4442-a49d-8e60d9843034/` under the same evidence parent
were opened: both credential inputs and their explanatory text are readable
and framed at 1440/390 in both themes, without overlap.
The passing handshake/save case was not replayed.
Parent independently confirmed the original fixture root absent and all
three web/API/LDAP ports refused connections. The capture-only fixture root
was also independently absent and both of its listeners refused connections.

No live institutional directory, SAML completion, certificate-rotation or
break-glass enrollment acceptance is inferred from this LDAP slice.

The rebuilt disposable LDAP image was independently inspected with no
container consumers and only its expected fixture tag. Exact removal of
`sha256:ce6f54a395dcf9bc03e604b353c284b7955bc0696b93cae955e45a830065bf4c`
then exited 0 and reported tag/image deletion (`bash_380`, `bash_381`).

The custom-environment and diagnostic-AI lanes own disjoint source paths and
remain separate acceptance work. Current P25 global build evidence predates
these P27 changes; final root validation remains required after they settle.
