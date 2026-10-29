# Installed environment-build consumer: FINAL scoped proof

October 28, 2026. This is actual installed API acceptance, distinct from the
earlier direct execution-broker recipe proof.

The new test starts the signed installed API/SSH/worker-controller cohort,
uses a real operator session, submits the environment-build endpoint, subscribes
to durable SQL changes before submission, and requires successful build/probe
publication of an available immutable environment. It collects only images
from this fixture's successful environment-build execution receipts for exact
cleanup after the cohort closes; the shared base image is never removed.

Initial selection failed before building: **0 pass/1 fail, 2 assertions**,
15.04 seconds, exit 1, because the new request omitted the mandatory trailing
slash from the exact configured HTTPS mirror. The signed fixture mirror entry
had the same mismatch. Both fixture values were corrected to
`https://archive.ubuntu.com/ubuntu/`; production validation was not loosened.
The failure remains in `p23-environment-build.log/xml`.

The corrected selection passed **1 case/8 assertions**, 158.26 seconds,
exit 0, with scoped strict types/lint under
`mon_9Y3EKRP7N2EXK0W1` (`bash_367`), retaining
`docs/evidence/p7-installation-integration/p23-environment-build-source.log/xml`.
The operation succeeded with `available: true`, a new immutable image and a
persisted matching available environment manifest. Its actual controller-owned
build execution exited 0 and the derived image completed the real probe chain.
The test used empty package/font additions, not network package installation.

The private-`/tmp` hypothesis was disproved. The recorded source was
`/tmp/quire-installation-integration-Rd5rMU/data/source/work/quire-environment-build-fjVWNO`;
`services/operations/installation/binding.ts` already sets controlled
`TMPDIR` to that bound work directory. Production build code was unchanged.

The exact generated image
`sha256:be4a7e87a47584847e3016b7dc23f262e9504a279eaf9dad2c1057ff06b590b8`
was removed after cohort disposal with Docker exit 0. Both attempted fixture
roots were independently absent. Exact unit and Docker ownership-scope checks
for `integrationce146cd62056` and `integration6bcb7d36bed8` returned no resources
(`bash_368`, exit 0). The known teardown-time manager warning is retained.

This closes the configured installed build/probe/publication consumer slice.
It does not claim arbitrary package installation, cross-profile custom-worker
adoption, or execution after a further release revokes the inherited profile.
