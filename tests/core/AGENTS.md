# CORE SERVICE TESTS

## OVERVIEW
Project, repository, catalog, and collaboration service suites; score 9, distinct core state domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Project authorization and files | `base/` | Project base service |
| Review and realtime state | `review/` | Presence, proposals, source collaboration |
| Repository sessions | `git/harness.ts` | `gitFixture`, status/operation envelopes |
| Catalog and templates | `catalog/harness.ts` | Catalog fixture and response envelopes |
| Foundation operator bootstrap | `catalog/bootstrap-template/` | Bootstrap-specific policy |
| Dashboard filtering | `workspace-dashboard/` | Workspace project fixtures |
| Cross-cutting file behavior | `files.test.ts` | Root-level file contracts |

## CONVENTIONS
- Core Git tests import the actual `GitRepository` implementation.
- Review queue tests directly exercise `PresenceQueue`.
- Catalog templates and library operations have separate behavioral suites.
- Each core service has its own harness instead of one universal core fixture.
- Service-specific TypeScript configs include the relevant production source scope.
- Git fixture envelopes keep status and operation responses distinct.
- Project-base and review details are delegated to their child guidance.
- Bootstrap-template fixtures are nested beneath catalog rather than account suites.
- Repository recovery, staging, conflicts, and credentials each have dedicated cases.

## ANTI-PATTERNS
- Foundation-only seeding must not promote a pre-existing ordinary operator ID.
- Source: `catalog/bootstrap-template/bootstrap.test.ts`.
- Keep source-tracking proposal behavior distinct from source persistence.
- Source: `review/source-tracking/proposals.test.ts`.
- Preserve the Git credential and conflict boundaries in their existing suites.
- Sources: `git/credentials.test.ts`, `git/conflicts.test.ts`, `git/fences.test.ts`.
