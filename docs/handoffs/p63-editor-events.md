# P63 editor events

FINAL - October 28, 2026, including the same-actor session-isolation correction.
**PASS.** Shared editor SSE is scoped to the actual authenticated session, not
actor equality. Seventeen focused tests pass, including real private AI events
across three sessions for one actor and two old-session revocations. The unchanged
same-context two-tab reproducer and scoped static checks pass. Runtime evidence
shows one live stream per editor tab, two actual server streams total, and no
pending normal API requests at the two-mounted-tab checkpoint.

Earlier headers-object and actor/token receipts, including the parent's prior
P61 native receipt, remain historical. They do not certify this final correction.
The parent was sent the exact settled frontend hashes and released to rerun only
after the final native result at 22:42:35Z. No further frontend edits followed.

## Final session and lifecycle contract

All four event consumers delegate to `apps/web/src/features/editor/shared/events.ts`.
The active registry is weakly keyed by the injected client. Within that client,
shared scopes include the server-authenticated actor, actual session CSRF boundary
and exact project token. **Every shared subscriber resolves `/api/me` before
joining a scope.** A caller-supplied actor is only a consistency check, not authority.
Every network reader reopening for replay verifies the same actor and CSRF boundary.
There is no global actor/session lookup cache and no cross-tab auth sharing.

The identity service derives CSRF with HMAC-SHA256 over the actual session cookie
and verifies its stored hash during authentication. `/api/me` returns that trusted
principal's value. It is stable across header/workspace refreshes but changes when
a new session is issued, including for the same actor. Therefore refreshed or
derived headers converge without allowing a new same-actor session to inherit an
old private AI stream. CSRF values are not printed or persisted in evidence.

Anonymous scopes require an actual unauthenticated `/api/me` result and remain
partitioned by exact project token. Authenticated and anonymous scopes cannot
collide. The existing standalone PDF API may omit access metadata; those callers
receive dedicated non-shareable readers, even when they reuse the same headers
object. Unknown identity is not treated as an authenticated or anonymous shared
session. Server authentication and authorization remain authoritative.

There is no private event-history cache. A late subscriber rewinds the single
stream to the minimum requested cursor, letting the server authorize replay.
Existing subscribers retain their own queued cursors and suppress replay through
those boundaries. Each callback queue is serial, but the shared reader and other
subscribers continue while a callback awaits a normal API request. Callback
failure detaches only that subscriber. Independent abort removes one reference;
the last subscriber removes the registry entry and awaits reader cancellation.
Existing review retry and document reconnect policies remain consumer-owned.

The rejected keys were origin/client-only, headers-object identity across
refreshes, and actor/token without a session boundary. Full reasoning is in
`docs/evidence/p63-editor-events/contract.md` and `session-before.md`.

## Session-isolation proof

`tests/ui-editor/events/sessions.test.ts` uses the real identity, review/SSE and
AI services with an owned provider, not mocked session results or private events.
It logs in twice as one actor, keeps one injected client, and replaces its actual
cookie. The two sessions have distinct server session IDs and CSRF boundaries.
Six real private Ask runs establish that:

- Each session receives its own live/private replay, never the other's history.
- Refreshed headers in the second session share its stream and replay without
  redelivering the succeeded event to its existing subscriber.
- Logging out the first session closes its stream; the second session and its
  refreshed subscriber still receive a subsequent real private completion.
- Logging out the second session closes both of its subscribers. An anonymous
  reader without a token gets HTTP 401 rather than inheriting that stream.
- A third login for the same actor receives none of the earlier private events;
  direct reads of the first two sessions' private runs return HTTP 404.

The separate real authorization test verifies different actors and two real
anonymous Viewer tokens for different projects. Private actor notifications and
project events do not cross those scopes. The standalone PDF test proves that
metadata-free readers do not share even an identical header object.

The replay regression holds a real same-origin API response inside one callback,
then adds a subscriber and forces server rewind. Other subscribers receive events
while that API request is held. On release, the old subscriber sees exactly
[1,2,3], not stale duplicated actions. All async tests use event/queue signals;
there are no fixed sleeps or polling loops.

## Actual native convergence and recovery

The unchanged test runs with `tests/ui-editor/events/native-observer.ts` preloaded.
The observer records actual served-module key accesses, browser requests/document
generations and independent API request abort lifetimes. It does not replace
application callbacks, responses, replay cursors, provider gates or the test.
Runtime stacks from assistant, PDF, review and document transport on both tabs
use the same client/session-authority identity within each tab, including
refresh/remount. Numeric observer identities do not expose credentials.

Before collaborator close the final raw checkpoint is:

```json
{"open":{"1":1,"2":1},"serverOpen":2,"pending":[]}
```

There is one Playwright browser context containing two mounted editor tabs;
there is no cross-tab global connection. All five actual SSE requests across
navigation and rewind have recorded closure by teardown. The final recovery
receipt records 37 second-tab `/api/me`, document, suggestions and compile-preview
requests completing HTTP 200 without failure, in 9-291 ms. None remains pending.

The original provider-gated test still saves newer source from the second tab,
releases the actual held provider response, discards the genuine late proposal,
preserves the newer source and makes no second provider request on stale Send.
Browser and console error arrays are empty. The final screenshot was inspected
and shows the discarded-proposal notice, selected diagnostic, no proposed changes
and saved shared source.

The unchanged fixture's latest artifacts remain at
`docs/evidence/p27-diagnostic-ai/8e1ee03e-5b8b-4943-99c1-b0b46934b052/`.
No diagnostic-AI test or fixture was edited to obtain this result.

## Exact checks and raw evidence

All commands run from `/home/norman/Repos/Quire` with
`export PATH="$PWD/node_modules/.bin:$PATH"`. Runtime output confirms repository
Bun **1.4.4 (38afee6c8)**, not shell-default 1.3.14.

| Command | Result |
| --- | --- |
| `bun test tests/ui-editor/events tests/ui-editor/pdf/events.test.ts` | 17 pass, 0 fail, 120 expectations; `P63_SESSION_FOCUSED_EXIT=0` |
| `bun node_modules/typescript/bin/tsc -p tests/ui-editor/events/tsconfig.json --noEmit` | `P63_SESSION_FINAL_TYPES_EXIT=0` |
| `bun x oxlint --type-aware --deny-warnings apps/web/src/features/editor/shared/events.ts apps/web/src/features/editor/assistant/events.ts apps/web/src/features/editor/pdf/events.ts apps/web/src/features/editor/review/events.ts apps/web/src/features/editor/transport/connection.ts tests/ui-editor/events` | `P63_SESSION_FINAL_LINT_EXIT=0` |
| `bun test --preload ./tests/ui-editor/events/native-observer.ts tests/ui-editor/diagnostic-ai/boundaries.test.ts -t 'genuine late diagnostic'` | Original test and observer assertions pass, 0 fail; `P63_SESSION_NATIVE_EXIT=0` |

Current raw evidence under `docs/evidence/p63-editor-events/`:

- `session-focused.log`: real three-session/private-AI receipt, two revocations,
  real token/actor isolation and 17 passing tests at 22:40:34Z. Its initial lint
  run found one type-only import; that import was corrected without changing
  assertions or runtime behavior. The final scoped checks are retained below.
- `session-static-final.log`: final scoped TypeScript and type-aware lint exits 0,
  22:42:12Z-22:42:28Z. No diagnostic or warning was suppressed.
- `session-native-final.log`: exact command, runtime, UTC, raw native exit and
  all final frontend/unchanged-reproducer/observer pre/post hashes. Every pair
  matches. The run was 22:41:37Z-22:42:35Z.
- `native-observer.json` and `session-request-recovery.json`: current raw call
  stacks, request statuses/durations, server stream lifetimes and checkpoint.
- `session-native-browser.json`, `session-native-cleanup.json`,
  `session-fixture-cleanup.log` and `settled-files.log`: current empty browser
  errors, exact owned cleanup checks and complete final file fingerprints.
- `session-before.md` records the previous stable frontend fingerprints and the
  verified CSRF contract. Earlier observations/logs are retained as history;
  `native-observer-before-session.json` preserves the preceding actor-only run.

## Settled frontend files and pre/post fingerprints

These are the exact five settled frontend files. Each hash below is identical
before and after the final native run; `session-native-final.log` retains both
literal copies. Only `shared/events.ts` changed during the session correction
relative to the previous stable frontend set.

```text
e0b20d1fc3bff1d36d5563b67cef18c9fc1439ff6c3787e3b7a720a6ce735605  apps/web/src/features/editor/shared/events.ts
04f5b74c26821fe820dead4cc11a348a7c1e636dc3a174d30799d4282a81f795  apps/web/src/features/editor/assistant/events.ts
40c2470de6626d889cc35d24817c544a9cbea0719cc6681d094218b1283d96ef  apps/web/src/features/editor/pdf/events.ts
c37145f6f18d9f5970c046dfa093810d77a2f6a1e42bc3615d9ffe7a2e674b67  apps/web/src/features/editor/review/events.ts
4454cb0460dddf8bd92322b4b27db21913145e8d9b2b23d6937ba7e7cf7931d7  apps/web/src/features/editor/transport/connection.ts
```

The settled focused files are `tests/ui-editor/events/{authorization.test.ts,
harness.ts,native-observer.ts,replay.test.ts,sessions.test.ts,shared.test.ts,
tsconfig.json}`. Their exact final hashes and both unchanged diagnostic-AI file
hashes are in `settled-files.log`. No file outside the authorized source/test/
P63 evidence/report scope was edited. The unchanged native fixture writes its
own runtime artifacts to the existing P27 location.

## Cleanup and scope

Final native root `/tmp/quire-assembly-0aJyjz` was removed at
22:42:35.933Z. Independent checks at 22:44:15Z confirmed it absent and neither
owned web port 32881 nor API port 39967 listening. All observed server SSE
requests closed. The browser/context, API/application, Vite and provider disposal
stack completed and the test process exited 0.

The real private-AI root `/tmp/quire-p2x-ai-Df8DBp` and authorization root
`/tmp/quire-p1s-review-RTZ3wQ` were independently absent at 22:42:41Z. Exact
private-AI API/proxy/provider ports 45249, 34241 and 44621 were closed. Focused
HTTP servers were disposed, and all monitors completed. Earlier attempt cleanup
remains recorded in the retained evidence. No owned process remains.

No commit, port 5173 process change or unrelated workspace/process change was
made. No broad passing suite was rerun. Parent integrated checks and the parent's
new P61 receipt remain its own gate; its prior passing receipt is historical
rather than silently re-certified against changed helper bytes.
