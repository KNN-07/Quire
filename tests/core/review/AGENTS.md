# REVIEW AND REALTIME TESTS

## OVERVIEW
Collaboration, review proposals, presence, and author comparison; score 8, distinct realtime state domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Runtime and peers | `harness.ts` | `reviewFixture`, `peer`, `bounded` |
| Source and proposals | `harness.ts` | `sourceDoc`, `proposal`, `mutation` |
| Alternate storage | `postgres-fixture.ts` | `postgresFixture` |
| Presence queue | `presence-queue.test.ts` | Actual queue implementation |
| Author attribution | `author-comparison/` | Comparison scenarios |
| Tracking proposals | `source-tracking/proposals.test.ts` | Source ownership boundary |

## CONVENTIONS
- `reviewFixture` composes identity, governance, project base, and review.
- It serves HTTP routes and WebSocket handlers from the same listener.
- `localOrigin` changes the public URL to the actual listener for origin-sensitive cases.
- The default clock starts at `2026-10-26T12:00:00.000Z`.
- `QUIRE_REVIEW_POSTGRES_URL` opts the fixture into PostgreSQL adapters.
- The PostgreSQL helper remains responsible for its own connection/database cleanup.
- Request origin derives from the active runtime configuration.
- Caller-supplied abort signals take precedence over the default request timeout.
- Realtime fixtures use actual Yjs document and message contract types.
- Review disposal is a separate lifecycle hook from runtime close.

## ANTI-PATTERNS
- Proposal persistence must not become source persistence.
- Source: `source-tracking/proposals.test.ts`.
- Preserve actual WebSocket upgrade and message paths in collaboration coverage.
- Reopening a listener must keep public URL and origin expectations aligned.
- Source: `harness.ts`.
