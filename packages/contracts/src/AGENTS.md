# SHARED CONTRACTS

## OVERVIEW
Zod-backed API and runtime ports shared across layers; score 11, distinct schema boundary.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Public API | `index.ts` | Package exports |
| Endpoint metadata | `endpoint.ts` | Lane, transport, concurrency options |
| Endpoint assembly | `registry.ts` | Six route groups plus health |
| Route helpers | `route-builders.ts` | Reusable route construction |
| Account routes | `routes-accounts.ts` | Account endpoint definitions |
| Core routes | `routes-core.ts` | Project and collaboration API |
| Compilation | `routes-compiler.ts` | Jobs and worker leases |
| Adapters | `routes-adapters.ts` | Provider actions and AI tools |
| Operations | `routes-operations.ts` | Operator endpoints |
| Transport routes | `routes-transports.ts` | Streaming and realtime contracts |
| Client | `client.ts` | Contract-driven requests |
| Concurrency | `version-headers.ts` | Resource version helpers |
| Storage ports | `storage.ts` | SQL and unit-of-work interfaces |
| Runtime ports | `ports.ts` | Service interfaces |

## CONVENTIONS
- Infer data types from boundary schemas rather than maintaining parallel DTOs.
- Endpoint descriptors carry lane, transport, idempotency and `ifMatch` metadata.
- Request objects group params, query, body and mutation headers.
- The registry combines route groups into a frozen endpoint list.
- The package resolves to this directory's `index.ts`; new public contracts need barrel exposure.
- `RequestOf` uses schema input; `ResponseOf` uses schema output.

## ANTI-PATTERNS
- Do not bypass mutation header or expected-version contracts in callers.
- Do not infer HTTP ownership from a service directory; the endpoint lane is explicit.
- Do not confuse a schema's parsed output with its accepted input.
- Do not add server implementation details to shared port definitions.
