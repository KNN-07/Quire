# INSTALLATION CONTROL TESTS

## OVERVIEW
Installation ledger, bindings, supervisor execution, and durable fences; score 10, distinct control-plane domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Durable control setup | `control-fixture.ts` | `controlFixture`, IDs, timestamps, hash |
| Pagination behavior | `control-pagination.test.ts` | Receipt continuation invariants |
| Supervisor execution | `supervisor-execution/fixture.ts` | Execution identities and budgets |
| Execution behavior | `supervisor-execution/executions.test.ts` | Role execution lifecycle |
| Execution health | `supervisor-execution/health.test.ts` | Health ownership |
| Foundation durability | `foundation-acceptance/` | Durable state and fences |

## CONVENTIONS
- `controlFixture` provisions a dedicated `control.sqlite` file beneath its temporary root.
- Installation identity, supervisor epoch, actor, and role-inventory digest are explicit state.
- `at` and `later` are fixed instants one minute apart.
- Prior and candidate bindings retain both release and data-generation identity.
- Release request digests and authenticated control-command signatures are distinct helpers.
- `command()` creates a reserved update command with a fresh operation ID.
- `reopen()` closes the store and opens it under the next supervisor epoch.
- `inhibit()` exercises accept, claim-due, and inhibit transitions in order.
- Nested supervisor execution tests share their own fixture and limits.
- Control storage and real native installation acceptance live in different test families.

## ANTI-PATTERNS
- Pagination must not rescan receipt IDs already returned to the caller.
- Source: `control-pagination.test.ts`.
- Preserve epoch and binding identity across reopen/recovery tests.
- Do not bypass fixture transition ordering when testing durable fences.
- Sources: `control-fixture.ts`, `foundation-acceptance/fences.test.ts`.
