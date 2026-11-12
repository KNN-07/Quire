# NATIVE INSTALLATION INTEGRATION

## OVERVIEW
Native controller, signed release, health, and role recovery acceptance; score 8, retained OS installation domain guidance.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Native runtime topology | `native-fixture.ts` | `nativeInstallation`, native process fixture |
| Accepted environment | `environment-fixture.ts` | `provisionAcceptedEnvironment` |
| Scale resources | `scale-resources.ts` | Installation storage/process resources |
| Candidate release | `candidate-release.ts` | Signed candidate setup |
| Restored inventory | `restored-inventory.ts` | Shared recovery inventory helpers |
| Health failure | `prepared-health-failure.test.ts` | Failed candidate acceptance |
| Crash recovery | `prepared-crash-recovery.test.ts` | Persisted recovery path |
| Role composition | `all-role-native.test.ts`, `all-role-scale.test.ts` | Native and scale variants |

## CONVENTIONS
- The native fixture builds actual entrypoints using `Bun.build` with the Bun target.
- Each fixture generates its own installation ID and temporary root.
- Native checks inspect systemd units, cgroups, process identities, and execution files.
- `nativeInstallation` accepts migration, health barrier, and candidate port-conflict options.
- Worker environments and scale resources are optional explicit inputs.
- Restored health can be observed through the `onRestoredHealth` callback.
- Package signing, admission signing, and control-command signing are separate concerns.
- Shared fixture credentials and browser origin are exported for related HTTP scenarios.
- Tests distinguish direct entrypoints, worker factories, and client composition.

## COMMANDS
```sh
bun test tests/integration/installation
```

## ANTI-PATTERNS
- Keep failed health and restart-authority scenarios tied to actual native observations.
- Do not treat a built candidate alone as proof of accepted/restored runtime health.
- These are systemd/process integration fixtures, so plain in-process setup is insufficient.
- Sources: `native-fixture.ts`, `restart-authority.test.ts`, `prepared-health-failure.test.ts`.
