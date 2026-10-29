# Managed execution after promotion: FINAL scoped proof

October 28, 2026. Parent continuation of installation acceptance.

The actual native all-role scenario now has separate rollback and successful
promotion variants. Only the new `signed promotion` selection ran;
the accepted rollback variant was not replayed.

The new case requires real compilation and PDF bytes before the signed update,
successful update receipt, the candidate release ID, the advanced monotonic
release floor, unchanged application-data binding on success, a distinct new
managed worker, and real compilation/PDF bytes after promotion. It also checks
old execution-unit absence. No synthetic update, worker or compiler is supplied.

Strict installation types and typed deny-warning lint passed. The new scenario
passed **1 case/36 assertions**, 318.65 seconds, exit 0 under
`mon_AKK76ZGTN0828PF4` (`bash_364`). Durable evidence:
`docs/evidence/p7-installation-integration/p23-promotion.log/xml`.
Fixture ownership scope is `integration8e06d3b56289` at
`/tmp/quire-installation-integration-OKmiwN`.
The final receipt is succeeded, the floor is sequence 2/version 2.0.0, and
the control ledger retains 30 actual execution records. The same teardown-time
manager warning documented in P21 remains in the raw output, not suppressed.
Parent independently confirmed the exact root absent and the exact unit and
Docker ownership-scope queries empty (`bash_365`, exit 0).

Configured environment-builder consumer acceptance was subsequently recorded
in `p23-environment-build.md`. The suspected private-`/tmp` issue was disproved:
the launcher binds `TMPDIR` to the permitted work root. The actual API built,
probed and published an available immutable image, then cleaned its owned image
and resources. No production build-path correction was necessary.
