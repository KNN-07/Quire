# AI ADAPTER

## OVERVIEW
Consent-bound provider execution with separately reviewed source proposals; score 8, distinct untrusted-output domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Contract and checks | `README.md` | Policy, persistence and verification |
| Assembly | `index.ts` | `createAiModules` |
| Orchestration | `service.ts` | Execution and policy rechecks |
| Provider boundary | `provider.ts` | Prompt and tool authority |
| Context | `context.ts` | Bounded selected context |
| Execution | `execution.ts` | Provider-call lifecycle |
| Proposal validation | `proposals.ts` | Identity, ranges and base text |
| Decisions | `decisions.ts` | Reviewed application |
| Conversations | `conversations.ts` | Conversation state |
| Receipts | `store.ts`, `journal.ts` | Durable execution state |
| Logging | `request-log.ts` | Private content exclusions |
| Search | `project-search.ts` | Retrieval context |

## CONVENTIONS
- Pin configuration and policy versions and recheck them before execution.
- Only explicitly selected ranges authorize edit proposals.
- Validate UTF-16 bounds, code-point boundaries, exact base text and overlap.
- Ask content remains session-local.
- Generation and reviewed application are separate operations.
- Run `bun test tests/adapters/ai` for this adapter.

## ANTI-PATTERNS
- Source, retrieval and user content are data, never tool authority.
- Provider tools must not expose shell, filesystem or general network access.
- Ask mode returns no patches; never auto-apply proposals.
- Never automatically regenerate an interrupted potentially paid call.
- Never log private Ask text or selected file, image or diagnostic context.
- Do not modify previously applied migration SQL.
