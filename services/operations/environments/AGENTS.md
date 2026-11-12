# COMPILER ENVIRONMENTS

## OVERVIEW
Toolchain registration, construction and signed execution admission; score 8, distinct environment authority domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Registration | `index.ts` | Operational routes |
| Schemas | `model.ts` | Environment model |
| Registry | `registry.ts` | Environment records and resolution |
| Admission | `admission.ts` | Probe versus execution status |
| Creation | `create.ts` | New environment workflow |
| Build | `build.ts` | Build preparation |
| Execution | `execution.ts` | Controlled execution |
| Processes | `process.ts` | Environment process boundary |
| Probe | `probe.ts` | Toolchain inspection |
| Fixtures | `fixtures.ts` | Compiler acceptance inputs |
| Inputs | `inputs.ts` | Parsed build inputs |
| Lifecycle | `lifecycle.ts` | Default and retirement state |
| Migrations | `migrations.ts` | Durable registry schema |

## CONVENTIONS
- Probe readiness and execution admission are separate results.
- Controlled roles resolve admission through their signed installation release.
- Scale or managed pools use the managed execution route.
- Selection requires a ready probe and no explicit admission denial.
- Environment resolution is rechecked before compiler execution.

## ANTI-PATTERNS
- Toolchain probes do not grant execution.
- Do not admit an environment or image absent from the signed release.
- Do not equate an unsigned operator proposal with live authority.
- Do not hide an untrusted manifest behind a successful binary probe.
- Keep build/process execution behind the installation execution boundary.
