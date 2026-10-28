# P2X reviewed AI execution

Owner: `st_01a17ca2`. Final owned-lane handoff, October 27, 2026.

**Owned implementation complete and verified.** Native Bun 1.3.14 completed
44 tests with 0 failures and 148 expectations. The final strict compiler,
type-aware lint and owned-file diagnostics are clean. Terminal checks and
owned-resource cleanup finished before this handoff was written.

This is not a live third-party inference claim or a completed parent server/UI
composition claim. No provider credentials were supplied and no paid/live
external write was made. Editor U, shared composition and scale integration
remain outside this child lane.

## Public exports and composition

Entrypoint: `services/adapters/ai/index.ts`.

Value exports:

- `createAiModules`
- `AiService`
- `OpenAiChat`
- `missingConfiguration`
- `migrations`

Type export: `AiOptions`.

```ts
type AiOptions = {
  readonly termsVersion?: string;
  readonly retentionDays?: number;
  readonly visionModels?: readonly string[];
  readonly retrieval?: () => PublicationRetrieval;
  readonly http?: SafeHttpClient;
};

createAiModules(options?: AiOptions): {
  readonly contributions: readonly AdapterContribution[];
  readonly module: ServiceModule;
  readonly service: AiService;
  readonly close: () => Promise<void>;
};
```

The factory's `service` getter becomes available after registration.
`module` is `069-x-ai`, lane X, order 69. Create one fresh factory per runtime.
Supply its contribution alongside the real references contributions to
`createAdapterModules`. Register identity/core source/core Git first, shared
connections/providers next, references then AI. Set
`retrieval: () => references.retrieval` for Citation Reviewer.

Stop and drain HTTP admission before shutdown; await AI close, references
close, shared close, then runtime close. Also close factories if assembly
fails. The AI service aborts/drains inference and policy checks, unsubscribes
events and clears session-local memory. Background persistence failures are
retained and surfaced on close rather than becoming unhandled rejections.

Detailed configuration and request semantics are in
`services/adapters/ai/README.md`.

## Applied parent contract delta

The parent, not this child, added:

- `aiImageCreate`
- `aiConversationCreate`, `aiConversationGet`
- `aiUsageGet`
- `aiSecurityGet`, `aiSecurityPut`
- `aiSessionClear`

All seven are registered by `services/adapters/ai/routes.ts`, along with
existing run create/get/cancel/decide/undo and conversation-delete routes.
HTTP tests exercise actual DTO parsing, authentication, CSRF, ownership,
image admission, shared conversation reads, usage and security.

The parent also made these `AiRun` fields required:

- `tool`: parsed from persisted `request_json` using `CreateRunSchema`.
- `version`: `ai_runs.version`.
- `errorCode`: nullable `ai_run_metadata.error_code`.
- `conversationId`: nullable `ai_run_metadata.conversation_id`.

The DTO constructor is `AiStore.dto` in `services/adapters/ai/store.ts`.
Errors are public DTO fields, not a custom-header fallback. ETag remains
additional version metadata. The raw `AiProvider` registry port is deliberately
not registered: it lacks the actor/session/tool/context needed for governance.
No existing app/service/runtime caller required that bypass. There are no
remaining AI endpoint contract blockers.

Exact route signatures and the original request are retained in
`docs/evidence/p2x-ai/contract-delta.md`.

## Delivered behavior

The real configurable provider uses bearer-authenticated
`/chat/completions`, JSON-mode output and actual `/models` probing.
All 20 `AiToolSchema` values execute through the same governed path.
User model/style preferences are separate from interface/spelling language;
translation names its target language explicitly in the prompt.

Current consent terms, account/session state, ACL, provider and intersected
organization/user/project policies are checked before context lookup,
dispatch and acceptance. Confidential state is an owner-controlled project
security label, not a dashboard tag. Policy/session/access events abort active
calls where possible; terminal publication discards late forbidden output.

Only explicitly selected files/ranges and actual selected diagnostic log
bytes are sent. Combined text/prompt/history/retrieval context is limited to
256 KiB. PNG/JPEG signatures, session/project ownership, expiration and
10-MiB individual/aggregate size are checked; model vision support is explicit
and unsupported modality is rejected before reservation. Inline completion
requires opt-in.

Every tool shares one atomic user/day reservation with UTC reset and default
ceiling 50. Two independent native runtime instances cannot both exceed the
ceiling. Only undispatched reservations refund; provider failures and explicit
regeneration consume uses. Receipt replay, accept/reject and undo do not
charge again. Monthly reports aggregate daily records.

Provider edits must match selected file IDs, paths, UTF-16 ranges and exact
base text. The service creates Yjs anchors itself, rejects overlapping/invalid
patches and never changes source during generation. Per-edit/all decisions,
conflicts, concurrent acceptance and inverse-anchor undo use real core source.
Optional AI branches are actual Git refs; `commit:false` does not implicitly
commit the accepted working source. `commit:true` creates a real commit.
Existing unrelated dirty source must be committed first, preventing accidental
inclusion in an AI commit.

Git/source preparation occurs outside SQL. A durable owned journal precedes
repository CAS. Current actor/policy, run version, branch revision and lease
fences are checked with the supplied transaction executor before finalizing
source, proposal state, inverse edits, idempotency receipt and outbox events.
The restart test interrupts after real Git publication and recovers source
and the receipt without another model call. Recovery stays fenced when the
original decision authority is revoked; it does not expose uncertain Git
publication or delete the journal to hide it.

Citation Reviewer consumes the actual references factory and explicit user
retrieval-provider selection. Public sources contain only retrieved provider
IDs from that invocation. Endpoint/time/digest provenance is retained against
the real response blob. Invented provider IDs are rejected; an LLM sentence
does not become a verified publication or a Dimensions result.

Default chat is session/project/branch-local memory. Private Ask prompt and
selected text are redacted from persisted request records. Explicit shared
conversations persist under current ACL, with clear and configured retention;
clear cancels/discards late results and redacts shared Ask message/request text.
Agent runs/proposals remain separate audit records. Retention denies reads at
expiry and purges on startup/run access or explicit `conversations.expire()`;
the host can invoke that method in its owned maintenance scheduler when idle.
Recompilation after Error Fix approval uses the existing compiler endpoint;
generation itself neither compiles nor writes source.

## Migration and preservation

Only new migration `069-x-ai` was authored, in
`services/adapters/ai/migrations.ts`. It adds:

- `ai_run_metadata`
- `ai_project_security`
- `ai_images`
- `ai_conversation_retention`
- `ai_source_journal`
- `ai_run_provenance`

It reuses the existing `ai_runs`, `ai_usage` and `ai_conversations` tables.
Both SQLite STRICT and explicit PostgreSQL SQL are supplied.

SHA-256 of exact SQL:

- SQLite: `1989c6fef1c964c73b60e25fc94981eafdad72a9944eb7d6cbb4619ae171c2f7`
- PostgreSQL: `3020ad2cf4d073aeac2d1bf38b4af84734a72cfed67f557f22919a3cadde1277`

No original input or previously applied migration SQL was edited. Restart
compares full prior `schema_migrations` rows, including digests/timestamps.
The new PostgreSQL variant was not executed against a PostgreSQL server by
this lane; earlier P1S acceptance is not evidence for that new migration.

## Terminal commands and evidence

Native runtime: **Bun 1.3.14, build 0d9b296a**.

| Command/check | Final result | Evidence |
| --- | --- | --- |
| `bun --version && bun test tests/adapters/ai` | Exit 0; 44 pass, 0 fail, 148 expectations, 11 test files, 66.53 s | `docs/evidence/p2x-ai/native-final.log` |
| `./node_modules/.bin/tsc -p tests/adapters/ai/tsconfig.json` | Exit 0 | `docs/evidence/p2x-ai/static-final.log` |
| `./node_modules/.bin/oxlint --type-aware --deny-warnings services/adapters/ai tests/adapters/ai` | Exit 0 | Same static log |
| Owned LSP diagnostics | 14 source files and 13 test/support files; 0 diagnostics | Same static log |
| Native migration hashing | Exit 0; hashes above | Same static log |
| Owned process probe | Exit 0; no AI test/type/lint process | Same static log |
| Exact leftover temporary-root removal | Exit 0 | Same static log |

The native suite includes real HTTP provider failures and model envelopes,
all tools, logged diagnostic isolation, modality denial, session isolation,
ACL/CSRF, multi-file proposals, conflict/undo, real branch/commit, durable
Git-publication recovery, daily races across native instances, UTC reset,
regeneration/refund semantics and shared chat clear/retention.

The only owned edit after the final native run removed an unused fixture
export; the final static gate covers that removal. An intervening concurrent
core Git import extraction briefly broke strict typing outside this lane.
The parent corrected its import; the final static gate passed afterward.
No core fix was made here. Earlier failures and their actual fixes remain in
`docs/evidence/p2x-ai/history.md`; no failure was skipped or suppressed.

## Decisions, assumptions and external prerequisites

JSON mode plus strict application validation was chosen over assuming every
OpenAI-compatible endpoint implements Structured Outputs. Explicit configured
model/vision support was chosen over inferring modality from a model name.
Clean Git baselines were required for AI commits rather than silently
committing unrelated work. AI proposal audit remains separate from generic
human suggestions, whose acceptance route would bypass AI policy checks.

Live use requires a reachable permitted HTTPS provider endpoint, actual model
identifier, bearer credential, JSON-mode Chat Completions compatibility,
appropriate vision support where enabled, and acceptable provider retention
terms. Git must be installed for reviewed source publication; native tests
used the actual installed executable. No additional AI SDK executable is
required.

Citation Reviewer additionally requires the real references composition,
explicit user retrieval consent and configured selected providers. Dimensions
requires institutional licensing, tenant endpoint, credentials and the approved
response contract documented by the references lane. No private-provider
endpoint or citation was invented.

Official primary docs were consulted October 27, 2026 through OpenAI's
maintained generated API types after Context7 was unavailable:

- `https://raw.githubusercontent.com/openai/openai-python/main/src/openai/types/chat/completion_create_params.py`
- `https://raw.githubusercontent.com/openai/openai-python/main/src/openai/types/chat/chat_completion_content_part_image_param.py`
- `https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml`

Details and access limitations are in `docs/evidence/p2x-ai/sources.md`.
No live model call, live external credential verification, new PostgreSQL
execution, UI browser verification or full parent composition is claimed.
Matrix ownership is A12/A14/A22/C14/I46/I47/I48/I49a/D03 plus the I49b
retrieval-consumption seam; editor/browser acceptance remains with U.

## Architectural review and cleanup

1. Responsibilities are separate provider protocol, admission/context,
   governance, conversation, execution, proposal transformation, decision,
   journal and route modules. All owned files are below 200 pure LOC.
2. HTTP/provider/persisted run payloads parse at their boundaries; no
   untyped external provider values flow into source mutation.
3. Tool/decision dispatch is exhaustive. State comparisons are explicit
   admission guards rather than catch-all variant handling.
4. No casts, non-null assertions, suppressions or missing-port shims were
   introduced.
5. Checks enforce named trust, authority, version and source boundaries;
   they do not revalidate framework-proven internal values speculatively.
6. No speculative helper layer was added; the unused fixture export was
   removed during final review.
7. Behavioral tests exercise actual HTTP/storage/Git outcomes and fail for
   missing review, quota, context or policy enforcement.
8. Authored functions have at most three parameters.
9. Production code does not delete/set and then re-query to verify its own
   operation. Tests read observable results.
10. No negative-form domain flags were added.
11. Existing runtime logging is retained; no logger or raw source/secret
    diagnostic logging was added.

Successful fixtures awaited listener/runtime/repository closure and removed
their unique data roots. One root from the initial timed-out failed checkpoint
was removed explicitly with exit 0 after final checks. Owned process probes
found no live test/type/lint process. The temporary core-import watch was
stopped; the contract watch had already completed. No browser/container was
created, no shared Docker image or listener 5173/3001 was touched, and no
workspace commit/push or nested agent was used.

All edits stayed inside the AI implementation/test paths, owned evidence and
this handoff. Parent contract additions were applied by the parent. Server/
scale composition ownership, including backup module 041 lifecycle gates,
was neither modified nor released by this lane.
