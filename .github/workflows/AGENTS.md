# GITHUB WORKFLOWS

## OVERVIEW
CI verification and static-site deployment workflows; score 8, distinct repository automation domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| CI checks | `ci.yml` | Typecheck, lint, matrix and contract tests |
| Pages deploy | `pages.yml` | Build artifact then deploy job |
| Workflow permissions | Each job | Scope tokens to required actions |
| Local command definitions | `../../package.json` | Repository scripts |
| Pages source | `../../site/` | Static publication input |
| Runtime pin | `../../.bun-version` | CI toolchain selection |
| Dependency lock | `../../bun.lock` | Frozen install input |
| Published-site setup | `pages.yml` | Build artifact and deploy permissions |
| CI concurrency | `ci.yml` | Cancel superseded branch runs |

## CONVENTIONS
- Grant workflow permissions only to the job that needs them.
- CI checks out source without persisted credentials and installs frozen dependencies.
- Keep artifact upload and deployment in dependent jobs.

## ANTI-PATTERNS
- Do not grant write permissions to verification jobs without need.
- Do not combine Pages artifact creation and deployment into an unscoped job.
- Keep dependency installation frozen to the checked-in lockfile.
- Do not treat CI's contract subset as full browser or compiler acceptance.
- Keep third-party actions pinned to explicit maintained action versions.
- Do not persist checkout credentials for read-only verification jobs.
- Preserve separate job boundaries when permissions differ.
