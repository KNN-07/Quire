# Promoted authority across restart: FINAL scoped proof

October 28, 2026. Parent acceptance of the retained release floor and completed
operation receipt after a real signed promotion and controller restart.

The new two-API scenario promotes the signed candidate, records the completed
receipt and sequence-2 floor, kills and restarts the actual controller, and
requires a new supervisor epoch with the same binding/floor/receipt. It also
checks public operation reads, an exact idempotent retry, and rejection of a
new request for the already-installed release without changing authority.

## Transport regression found

A focused real Unix-socket test failed before the fix: `UpdateError` code
`REPLAY_OR_DOWNGRADE` was transmitted as generic `CONTROL_REQUEST_FAILED`
(`mon_PTQ2MHJ212Y38Q54`, `bash_370`, exit 1). The controller transport now
preserves codes from the two known domain error classes, `ControlError` and
`UpdateError`. Unexpected exceptions still produce only the generic code;
internal messages are not exposed.

The new regression also asserts unexpected-error sanitization. Existing
canonical frame, peer authentication and unsupported-driver transport cases
are included because the transport source changed.

## Validation

Controller-server diagnostics are clean. Scoped strict types and typed
deny-warning lint passed. Transport regressions and the real restart scenario
passed **4 cases/27 assertions**, 115.18 seconds, exit 0
under `mon_PWZPW29XMS0MGKKN` (`bash_371`). Durable output:
`docs/evidence/p7-installation-integration/p25-restart-authority.log/xml`.
No previously accepted compiler, rollback or environment suite was replayed.
The exact fixture root was independently absent and the exact installation
unit scope returned empty (`bash_372`, exit 0).

Root typecheck, typed deny-warning lint and the complete production build
subsequently passed exit 0 (`mon_M08MMC0YZ1J1GHTR`, `bash_373`).
The raw receipt is `p25-product-validation.log` in the same evidence directory.
The web build completed in 5.23 seconds; all API/repository/compiler/installation/
SSH bundles were regenerated. The existing large web-chunk warning remains
documented; it was not suppressed.

This establishes a retained promoted floor and completed receipt across one
real controller restart, including idempotent retry and replay denial. It is
not a claim of arbitrary multi-release rollback sequences or live deployment.
