# P1 core review and collaboration

Owner: `st_01a17a54`. Date: October 26, 2026. Native runtime: Bun 1.3.14 (`0d9b296a`).

Status: WORKING and verified. After final session-contract clarification, the assigned command passed **32 tests, zero failures, 173 assertions across 16 files in 16.70 seconds**. Named and anonymous transports, review/history, writable counters and governance integration are implemented. Owned LSP, strict TypeScript and type-aware lint are clean. No commit or push was made.

## Composition and public exports

Import from `services/core/review/index.ts`:

| Export | Contract |
| --- | --- |
| `register(context: ModuleContext): void` | Registers the 21 owned endpoints and provides `services.realtime: RealtimePort`. Does not replace `services.projects`. |
| `migrations` | Migration `023-k-review-history`, adding a history-label aggregate counter, the unique source-checkpoint index, and review restore/decision intent tables. Baseline SQL is unchanged. |
| `RealtimeService` | Native implementation of `RealtimePort`, including its Bun websocket handlers and live authorized named/anonymous Viewer upgrade method. |
| `dispose({db}): void` | Removes this runtime's event listeners, closes SSE streams and sockets, and clears pending upgrade state. Call after stopping the listener and before closing SQLite. Idempotent. |

Suggested ordered module:

```ts
{ id: "023-k-review", lane: "K", order: 23, register, migrations }
```

Identity/policy, governance (`011-a-governance`) and core base must be registered first. Governance's migration supplies the notification producer/digest tables. This module checks the provided ProjectPort with `instanceof CoreProjects` and uses the exported native source writer. It does not deep-import runtime/contracts internals, edit base, or replace a shared DTO.

The application must pass websocket upgrades to `services.get("realtime").upgrade(request,server)` and delegate open/message/close handlers to that port. Non-upgrade HTTP requests at the realtime path return 426. For `/api/events`, disable Bun's ordinary HTTP idle timeout with `server.timeout(request,0)` or an appropriate server configuration. The module's route API has no server argument, so composition owns that setting.

## Registered endpoints

| Contract | Method and path |
| --- | --- |
| `realtime` | GET `/api/projects/:p/realtime` (WebSocket) |
| `events` | GET `/api/events` (SSE) |
| `threadsList` | GET `/api/projects/:p/threads` |
| `threadGet` | GET `/api/projects/:p/threads/:t` |
| `threadCreate` | POST `/api/projects/:p/threads` |
| `threadPatch` | PATCH `/api/projects/:p/threads/:t` |
| `threadDelete` | DELETE `/api/projects/:p/threads/:t` |
| `threadReply` | POST `/api/projects/:p/threads/:t/replies` |
| `commentPatch` | PATCH `/api/projects/:p/comments/:id` |
| `commentDelete` | DELETE `/api/projects/:p/comments/:id` |
| `threadState` | POST `/api/projects/:p/threads/:t/state` |
| `suggestionCreate` | POST `/api/projects/:p/suggestions` |
| `suggestionDecide` | POST `/api/projects/:p/suggestions/decide` |
| `chatList` | GET `/api/projects/:p/chat` |
| `chatCreate` | POST `/api/projects/:p/chat` |
| `historyList` | GET `/api/projects/:p/history` |
| `historyLabel` | POST `/api/projects/:p/history/:id/labels` |
| `historyLabelDelete` | DELETE `/api/projects/:p/history/:id/labels/:labelId` |
| `historyCompare` | GET `/api/projects/:p/history/compare` |
| `historyRestore` | POST `/api/projects/:p/history/:id/restore` |
| `historySource` | GET `/api/projects/:p/history/:id/source.zip` |

Reads use the shared branch/cursor/limit contracts. Thread filtering applies before pagination. Chat is available to named Viewers, Reviewers, Editors and Owners while current policy enables it. A Viewer link never grants comment/chat authority. Editor links require an actual authenticated principal and use base's transient membership and capacity enforcement.

## Durable source and transport behavior

The named websocket handshake checks the configured Origin, current session and CSRF. Browser clients offer `["quire", "quire.csrf." + csrfToken]`; the server selects only `quire`, never echoes the credential-bearing protocol. Native clients may instead supply the normal CSRF header. Anonymous Viewers use a live `share` query credential and same-origin check, with actual null actor/session metadata; they cannot update source, publish attributed presence or acquire a fabricated identity. Browser verification used actual session cookies and Chromium, not a mocked identity port.

Each update uses core base's branch writer queue and rechecks current credentials/ACLs after waiting. It loads the durable Yjs state, applies the update to an isolated Y.Doc, rejects foreign shared roots, embeds/formatting, malformed data and configured source-limit violations, then calls `commitSource` with an acknowledgement receipt. Base makes blobs, hidden Git checkpoint, Yjs state/update rows, materialized text, branch revision, snapshot and outbox durable before that receipt can be acknowledged. Named Git refs are not changed here.

Sequence receipts are scoped by actor/project/branch/file/epoch/client ID. First sequence may be 0 or 1; later sequences must be contiguous. An identical replay returns the original acknowledgement across restart. Different bytes at the same sequence are `SEQUENCE_CONFLICT`; a missing predecessor is `SEQUENCE_GAP`. Clients resend missing sequences rather than receive a false acknowledgement.

Epoch changes return `EPOCH_CHANGED` plus authoritative recovery text. A stale sync/update does not silently overwrite the offline buffer. Active subscribers are detached from an old epoch until they explicitly sync the new one. Presence is ephemeral, server-attributed to the actual user's name/ID, and limited to 20 updates per second per file/connection.

SSE subscribes before replay, exhaustively routes typed topics, pages all persisted events after `Last-Event-ID` (or `after`), and discards queued duplicates by sequence. It filters project events through live project authorization, personal notifications through their user aggregate, private operations through their persisted actor, and organization policy events through membership. Anonymous SSE uses a live `X-Project-Token`, is confined to that project and closes on revocation. Its actual replay test includes a private second project, a Last-Event-ID reconnect and live token revocation.

Committed `session.revoked`, access and policy events close affected transports without a polling timer. Both ordinary membership removal and actual Editor-link token revocation are exercised through subscribed clients. A token-derived Editor membership is also rechecked against current sharing policy rather than being mistaken for a permanent named grant.

The final identity contract is consumed exactly: `aggregateId=userId`, payload `{userId,sessionId:Id|null}`. Named session events close only matching authenticated connections; null closes the user's existing authenticated connections. Revoke-others keeps its caller's WS/SSE alive, and unrelated users and anonymous Viewers remain connected. No internal session event is emitted as public SSE data.

The clarification exposed and fixed a historical replay edge: replaying an old wildcard must not close a valid session created afterward. SSE now distinguishes live controls from historical replay while checking current persisted authentication in both paths. The regression logs in again after wildcard revocation without advancing the controlled clock, then proves the new WS/SSE session remains usable. Exact failures and final proof are retained in `session-revocation.log`.

## Review and history behavior

Metadata mutations and successful replay responses share one synchronous SQLite transaction. HTTP authorization/CSRF is enforced through the identity port. Branch-scoped queues prevent review snapshots from racing source writers. Only comment authors edit/delete their comments; Owner/Editor moderation resolves/reopens/deletes resolved threads. Thread deletion tombstones every contained comment. Tombstones survive restores permanently.

Suggestions validate file/anchor agreement, actual relative positions, epoch, exact before text and revision. Selected edits go through base's real `applyEdits`; any divergent selected range prevents all source edits in that selected batch. Divergent edits become `conflict`, unaffected selected siblings remain pending, and unselected edits are untouched. Acceptance has its own durable metadata intent; startup reconciles it from the source writer's atomic receipt before recording history. A regression stops the consumer between source commit and review finalization, then restarts and retries the actual HTTP decision.

Each source checkpoint gets an immutable source/review snapshot. Review snapshots retain actual relative-position offsets, so restore can recover repeated/empty quotes at the correct checkpoint position rather than searching for an arbitrary matching string. Labels are separate mutable records with an independent aggregate counter. Compare reads real immutable blob bytes, returns whole-file text hunks with correct empty/new-file line coordinates, and includes intermediate authors across the selected revision interval; source ZIPs contain actual snapshot files.

File restore preserves unrelated live files and their exact document state. Project restore creates a new revision, and restored files advance their epochs beyond both current and tombstoned epochs. Restore intents are persisted before the shared source commit and reconciled from the base receipt before the new review snapshot is captured. Recoverable review rows are restored without reviving tombstoned comments or resetting already decided suggestions.

Every content/compare/label/restore history route checks the current policy window. Inaccessible timeline metadata remains visible as `accessible:false`; physical source history is retained. The integration test also exercises base's real independent project copy: pending suggestions become copied source, while review/chat/ACL/history labels do not leak into the new project.

Comment/reply and suggestion producers call governance's real `enqueueNotification` inside their existing metadata transaction. Mention matching supports collaborator names, unambiguous first names and primary emails. Only current active project participants are eligible; self-notifications and unrelated accounts are excluded. Selection prioritizes mention, then reply to a thread participant, then explicitly opted-in `activity`. Tracking uses the existing `suggestion` preference key. Metadata replay and notification receipts prevent redelivery.

Comment mail is queued for the next ten-minute bucket using the injected clock. Governance owns preference filtering, in-app records, local digest delivery and the final current-ACL check. The actual HTTP producer test verifies project override precedence, dedupe, mention/reply/activity recipients and denial of mail to a revoked collaborator. This is local outbox evidence, not a claim of configured SMTP delivery. Chat stays separate from comment mail.

Maintenance closure is enforced by base's public authorization guard on both established socket updates and direct review mutations. Existing authorized reads, including chat reads, remain usable during closure. The regression changes the actual setting through the real operator endpoint and observes `EDITOR_CLOSED` without any source mutation.

### Mutation counters

- Thread/suggestion/chat creation, suggestion decisions and history restore compare the branch revision.
- Thread patch/reply/state/delete compare the persisted thread counter; `threadGet` exposes its ETag.
- Comment patch/delete compare the persisted comment counter.
- History label create/delete compare `history_versions.version`, independent of source revision.

## Exact checks and evidence

The verification ledger is `docs/evidence/p1-core-review/verification.md`. It preserves failed runs, the native shutdown reproduction and the later corrections.

Final checks (original output in `final-checks.log`; final session-contract proof in `docs/evidence/p1-core-review/session-revocation.log`):

- `bun test tests/core/review tests/integration/collaboration.test.ts tests/integration/review-history.test.ts`: exit 0, **32 pass, 0 fail, 173 assertions, 16 files, 16.70 seconds**.
- LSP: the complete original owned scan was clean; both follow-up changed files (`events.ts`, `session-revocation.test.ts`) are also clean. The scoped compiler/linter includes all current owned files.
- Explicit strict TypeScript compilation of the owned index, all owned tests and evidence probes, with runtime SQL ambient declarations: exit 0.
- Targeted type-aware Oxlint with `--deny-warnings`: exit 0.
- Actual authenticated Chromium WebSocket handshake: HTTP 101 at `127.0.0.1:32795`, actual cookie present, CSRF subprotocol present, authorized document update at revision 0; process exit 0.
- Native CLI transport probe at `127.0.0.1:40575`: actual login, subscription, document sync and disposal; exit 0.
- Native HTTP, source ZIP extraction, subscribed client overlap/duplicates/restart/offline replay, role matrix, live member/token revocation, history restore and crash recovery are not mocks.

No whole-repository success or product UI acceptance is claimed. The parent owns composition and final integration; U owns the editor/review/history screens.

## Concrete integration dependencies

1. **Landed and consumed, not locally edited:** `RealtimeSocketData.actorId/sessionId` are nullable for actual anonymous Viewer connections. `Comment.version` serializes each stored comment/chat counter; `HistoryVersion.version` serializes the label aggregate counter. Reload regressions use persisted counter 7, not a fallback equal to source revision zero. Thread's individual GET ETag supplies its counter.
2. Compose identity/policy, governance and base before review, apply migration `023-k-review-history`, wire the realtime port, and dispose this module before closing SQLite. Governance's producer hook and editor guard are actually consumed, not merely listed as future work.
3. Disable idle timeout for every authorized `/api/events` response, including token-authorized anonymous streams. A plain default Bun listener ends otherwise healthy quiet streams after its ordinary HTTP idle limit.
4. Governance owns notification preferences/digest dispatch; external mail transport remains a configured adapter boundary. This module produces real authorized activities and durable local receipts, not an external-delivery claim.
5. `docs/evidence/` is intentionally ignored by the existing root `.gitignore`. The lead must force-add the retained `docs/evidence/p1-core-review/**` artifacts if including evidence in its verified commit. This lane did not change the ignore rule or stage/commit files.
6. Base classifies `compile` as an editor action, not a read action. The compiler owner's explicit `write` check remains its responsibility; this follow-up did not edit base/compiler code or register a compiler endpoint.

## Native Bun shutdown limitation

Bun 1.3.14 emits the correct real client policy-close event (1008), including in Chromium, but leaves `pendingWebSockets` at 1 after server-initiated close. Awaiting `server.stop(true)` then never resolves. This was reproduced without Quire or SQLite in `native-close-probe.ts` and with Chromium in `browser-close-probe.ts`.

The isolated fixture uses the server's synchronous `[Symbol.dispose]()` and `unref()`, disposes review listeners, closes SQLite and removes its temporary root. This stops accepting connections without awaiting the stale metric; it is not a timing retry, sleep, test skip or hidden passing result. The standalone probes exit 0 and report the remaining native counter honestly.

## Ownership and cleanup

No commits, pushes, package edits, root composition edits, baseline migration edits, discovery edits or base writes were made. Unrelated IPv4 5173/3001 listeners were not stopped. API/browser probes use ephemeral loopback ports. Browser pages verify the actual API transport, not an invented product screen.

After retaining the final output, cleanup successfully removed these nine owned roots: `/tmp/quire-review-feuufu`, `/tmp/quire-review-AphfAd`, `/tmp/quire-review-m6Ch9F`, `/tmp/quire-review-6tVHTK`, `/tmp/quire-review-IpV04m`, `/tmp/quire-review-fcWy3v`, `/tmp/quire-review-FtSiAe`, `/tmp/quire-review-dGwjfo`, and isolated TMPDIR/cache root `/tmp/quire-review-lane.7J8h5u`. The first eight were abandoned pre-isolation fixtures from the retained failed runs. Successful later fixtures, browsers and listeners disposed themselves. No task server or browser process remains; both contract watches had already completed when cleanup addressed their handles.

The architecture audit then caught a six-parameter test-only proposal builder. LSP mapped all 11 calls in seven consumers; its existing edit fields were grouped using readonly `Pick<ProposedEdit,...>`, reducing the helper to three parameters without changing behavior or a production API. The full assigned suite, LSP, strict compiler and lint passed again. The separate audit rerun root `/tmp/quire-review-final.22xGDH` was removed successfully after its evidence was retained, bringing the owned cleanup total to ten roots.

The session-contract follow-up retained its evidence before successfully removing `/tmp/quire-review-session.5weHLy`, including its cache and any failed-fixture remnants. All follow-up test and gate processes finished; the owned cleanup total is eleven roots.

All owned TypeScript files have current post-edit measurements: maximum production size 196 pure lines (`realtime.ts`), maximum core-test/support size 154 (`harness.ts`), integration sizes 133/143, and maximum evidence probe size 54. Follow-up sizes are `events.ts` 134 and `session-revocation.test.ts` 141. No source file is in the 200-250 warning band.

Architectural review: each module owns a cohesive resource/transport/journal responsibility; external messages and stored JSON are schema-parsed; protocol/event/decision dispatch is exhaustive; no `any`, assertion casts, non-null assertions or suppressions were introduced. State checks are for live credentials/ACLs, not type-proven nullability. Helpers own real lifecycle/recovery seams or have multiple callers. Regressions demonstrably fail for lost intermediate authors and wrong new-file coordinates. No authored function has more than three positional parameters; reused mutation/activity commands represent actual shared transaction state. Cleanup trusts the operation contract without post-delete rechecks. New names are positive. Production logging remains with the existing runtime; probes contain only test diagnostics and no credentials.
