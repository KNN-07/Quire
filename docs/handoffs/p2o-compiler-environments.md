# Compiler environment integration

Parent-owned follow-up, October 27, 2026. Native selection and remote-worker
regressions pass. Docker image/profile acceptance is still owned by the
environment producer; this document is not final whole-environment acceptance.

## Coordinator boundary

`services/compiler/index.ts` exports:

```ts
type CompilerEnvironments = {
  resolve(id: Id): Promise<Environment>;
  build(input: BuildInput & { readonly environment: Environment }): Promise<BuildResult>;
};
configureCompilerEnvironments(
  context: Pick<ModuleContext, "services">,
  provider: CompilerEnvironments,
): void;
```

Operations registers its provider after compiler registration. Resolution
checks exact requested ID and availability. Admission additionally checks the
engine. Selected environment identity contributes to the cache key; execution,
worker source archives and historical PDF-diff admission use the selected
manifest. The provider performs the actual native-versus-Docker build dispatch.
Without a provider, only the originally probed native environment is usable.

`QUIRE_COMPILER_BACKEND=docker` permits a coordinator to start without probing
or advertising an artificial native environment. Compilation remains
unavailable until operations installs a verified provider and manifests.
The environment list reads persisted available manifests.

## Remote worker boundary

`QUIRE_WORKER_ENVIRONMENTS_FILE` optionally names a JSON array of operator-
provisioned `Environment` manifests. With no file, the existing actual native
probe remains the default. `QUIRE_WORKER_ENVIRONMENT_IDS` may select a subset;
otherwise the supplied manifests' IDs are used.

Before advertising IDs, `workers/compiler/profiles.ts` executes the native
probe or the environment producer's cancellable Docker image probe. It compares
availability, backend, image/root digest, package digest, release and supported
engines/helpers. Duplicate IDs and unprobed requested IDs fail startup.
On every lease, worker/job/source-manifest environment IDs must agree; manifest
execution identity is checked against the local approved manifest. The build
uses that local manifest, not unchecked coordinator image parameters.

Docker execution delegates to the producer's `runProfile`; startup probes pass
the worker AbortSignal to every sandbox. Native execution still uses the
existing confined build implementation.

## Retained evidence

- `bash_108`: 10 tests passed, exit 0. Actual selected native-manifest PDF,
  unavailable/mismatched-provider denial, correct remote source manifest,
  real remote CLI protocol, immutable snapshots, timeout and last-good preview.
- `bash_109`: Docker-only startup regression passed. Root typecheck stopped
  on concurrent source UI, SSH and backup WIP diagnostics, reported to their
  owners. It is not claimed as a passing global check.
- `bash_110`: touched coordinator/test type-aware lint passed, exit 0.
- `bash_111`: remote profile identity and real remote worker/protocol tests:
  three passed, exit 0, followed by touched worker/test type-aware lint.

The fixtures await worker shutdown and remove their exact roots/listeners.
No real Docker worker success is claimed before the environment lane's rebuilt
image passes its actual probes. That lane reported engine-selection, Lua font
I/O and minted compatibility failures in its initial image and is fixing them.

## New-project defaults

The existing `CoreProjects.createFromFiles` already chooses a nonretired
environment ordered by availability and `is_default`. No production change
was needed. An added real project-creation regression proves that an available
default wins, an unavailable/retired default loses to an available alternative,
and existing projects retain their pins.

`bash_119`: three catalog tests passed, 11 assertions. Its strict gate stopped
on the concurrent backup composition's missing `signingKey`, reported to that
owner. `bash_120`: touched-test type-aware lint passed. The initial regression
fixture omitted marking its alternative available; that setup error and failed
receipt `bash_118` are retained, not relabeled as a passing run.

## Managed-pool admission

Compiler claim admission now calls `admitWorkerClaim` under its own compiler
transaction lock, after the worker upsert and before queue selection. Lease
fencing calls `assertManagedLease`; issued wall limits are capped by
`workerWallSeconds`. `CompilerService.remoteWorkers()` reflects scale mode or
the installed managed-pool policy. Local start/pump/run refuse managed
execution; PDF differences await remote jobs in that mode.

`bash_124` exited 0: `tests/compiler/managed.test.ts` proves a real queued job
cannot be claimed by an unmanaged worker when the pool is managed/disabled,
local execution is rejected, and the same job becomes claimable in explicit
legacy mode with the 30-second pool cap. This uses actual runtime SQL/compiler
leases without a cold TeX probe. Touched-file type-aware lint also passed.

The operations lane's broader real-process authority run remains separate:
`bash_116` failed during native readiness/startup and did not reach its
disabled-claim assertion. Its owner is reconciling that fixture and the
backup-admission callback-lifetime regression. No full worker-pool acceptance
is claimed by the focused regression.
