# Reviewed AI adapter

The adapter sends only explicitly selected context to an operator-configured
OpenAI-compatible endpoint. It never executes provider tools, shell commands,
or source mutations on generation. Agent edits require explicit review.

## Composition and lifecycle

```ts
import { createAiModules } from "./services/adapters/ai";
import { createReferencesModules } from "./services/adapters/references";
import { createAdapterModules } from "./services/adapters/shared";

const references = createReferencesModules();
const ai = createAiModules({
  termsVersion: "2026-10-27",
  retentionDays: 30,
  visionModels: ["your-explicitly-vision-capable-model"],
  retrieval: () => references.retrieval,
});
const shared = createAdapterModules({
  contributions: [...references.contributions, ...ai.contributions],
});
// After identity, core source and core Git modules:
const adapterModules = [
  shared.connections, shared.providers, references.module, ai.module,
];
```

Create fresh factories for each runtime. `module` is `069-x-ai`, lane X,
order 69. Migrations have explicit SQLite and PostgreSQL variants. Do not
modify previously applied migration SQL. Core source and Git migrations must
be installed; the core repository service uses the installed Git executable.
The factory does not claim a working Git installation on behalf of the host.

On shutdown stop HTTP admission, await `ai.close()`, `references.close()`,
`shared.close()`, then `runtime.close()`. Close constructed factories on failed
assembly too. Inference uses runtime background admission, bounded 60-second
execution, and AbortSignals; closure aborts and drains owned calls and event
subscriptions. No implicit provider retry can duplicate a paid request.
Interrupted calls are never automatically regenerated. Expired execution
leases become failed on startup; reservations are refunded only if they were
not marked dispatched. A second live runtime does not cancel another runtime's
unexpired run.

## Provider configuration

An authenticated operator configures existing
`PUT /api/admin/providers/ai`, with `If-Match` and `expectedVersion`:

```json
{
  "baseUrl": "https://your-provider.example/v1",
  "model": "your-model",
  "secret": "your-provider-api-key",
  "policy": {
    "compileSeconds": 180,
    "writableMembers": null,
    "historyDays": null,
    "trackChanges": true,
    "chat": true,
    "ai": "agent",
    "aiDailyUses": 50,
    "sharing": "named",
    "anonymousRead": false,
    "anonymousEdit": false
  },
  "expectedVersion": 0
}
```

This is a configuration example, not a shipped endpoint or credential.
Missing configuration reports the exact missing base URL, model or bearer
credential. Credentials use shared `ProviderConfigurations` and the runtime
encrypted secret store, never a source file. The optional operator probe
performs `GET /models`; it does not spend an inference allowance.
`POST /chat/completions` uses bearer authorization, JSON mode,
`stream:false`, `store:false`, text/image message parts and no tool access.
The provider must support this documented protocol for the chosen model.
Provider-side retention policies are external prerequisites; `store:false`
does not promise third-party zero retention.

Model selection and writing style use the existing account preferences.
`aiModel:null` chooses the configured default; an explicit different model
is rejected until the operator selects it. Language is independent of the
interface/spelling language: the translate prompt names the target language.
Inline completion requires `inlineCompletion:true`.
Vision is disabled unless the exact configured model occurs in
`visionModels`. `http` optionally supplies the real safe transport, including
literal-loopback fixture allowances in tests only. Production default is
HTTPS/SSRF-checked, a 16-MiB transport limit, and a 60-second deadline.

All `AiToolSchema` tools use this same execution path: chat/Ask/Agent,
TeXGPT, logged error fix, table/equation prompt/image, grammar, fluency,
paraphrase, concise, scientific, split/join, synonyms, title, abstract,
translate, inline completion, and citation reviewer. No standalone retired
Summarize/Explain tool is advertised.

## Consent, context and quota

Users accept the configured terms version through the existing account
AI-consent endpoint. Provider, project, user, federation and organization
policy intersect; deny wins. Merely configuring a provider does not enable
AI in a default-denied organization. `ai_project_security.confidential` is
owner-controlled project security state, not a private dashboard tag.
Policy/session/ACL changes cancel in-flight work when possible and all late
output is fenced before publication.

`POST /api/projects/:p/ai/runs` accepts the shared registry request and an
Idempotency-Key. Select exact file IDs; an optional selection must match the
current text. Only the selected substring is transmitted for that file.
Prompt, selected files, log excerpt, history and retrieved publications
together are capped at 256 KiB. Error Fix requires a real diagnostic whose
compiled snapshot belongs to the requested project/branch; only its recorded
log byte range is sent. Images are PNG/JPEG with matching signatures,
maximum 10 MiB each and 10 MiB combined; uploads are session/project-bound
and expire after one hour. Unsupported modalities are rejected before charge.

One atomic daily reservation is shared by all tools and sessions for the
user. The effective configured ceiling defaults to 50; UTC dates define the
reset. Only failure/cancellation before dispatch can refund. HTTP/provider
failure after dispatch still counts. Regeneration is a new invocation;
accept/reject/undo and idempotent replay do not consume another use.
Monthly usage is reporting over daily records, not a second reset system.

`GET /api/ai/runs/:id` returns the real status, `tool`, `version`,
`errorCode` and nullable `conversationId`. ETag also reflects the version.
Run decisions/cancellation require the current version. The governed service
is the invocation boundary; the legacy raw `AiProvider` port is not installed
as an unauthenticated shortcut.

## Review, provenance and Git

Provider patches name file ID, current path, UTF-16 range, exact base text and
replacement. The adapter rejects invalid paths, out-of-selection changes,
surrogate splits, overlapping patches and unverified retrieval IDs. It builds
Yjs anchors itself, never trusts provider-supplied anchors, and checks current
paths/epochs/base text again at acceptance.

`POST /api/ai/runs/:id/decide` selects edit IDs, or `[]` for all, and
`decision:"accept"|"reject"`. Conflicts preserve the source. Accepted changes
have retained inverse anchors; `/undo` restores only still-matching accepted
text. Concurrent acceptance cannot apply an edit twice.

Optional `newBranch:"ai/task-name"` creates a real named branch.
Optional `commit:true` creates a real Git commit of reviewed source.
Commit/branch creation requires a clean named source baseline, so unrelated
dirty edits cannot silently enter the AI commit. Existing uncommitted work
must first be committed through the core Git UI. Core source preparation and
Git object creation occur outside SQL; a durable AI journal precedes atomic
repository publication. Current authority, source revision, lease fence, run
version, metadata, receipt and events finalize together with the source.
Recovery cannot publish under a revoked principal/policy; a fenced journal
requires restoring the originally authorized decision authority before retry.
The journal is never silently deleted to hide uncertain Git publication.

Run/proposal audit lives in AI tables independently of chat retention.
Source snapshots use real core history; AI proposals are not inserted into
generic human suggestions, which would offer an ungoverned acceptance route.
Error Fix regeneration is a new run; recompilation after review uses the
existing authenticated compiler endpoint on the resulting source revision.
This adapter does not silently compile or mutate source on a failed model call.

Citation Reviewer requires the actual references factory, explicit
`citationWebSearch:true`, and selected `citationProviders`.
Sources come only from that invocation's real retrieved publication IDs.
Exact response digests/endpoints/timestamps persist in `ai_run_provenance`
and the references blob-backed provenance store. Ordinary model text is not
represented as verified literature. Dimensions remains unavailable without
its licensed endpoint, credential and approved response contract; explicitly
selected alternatives retain their own provider labels.

## Conversation privacy and endpoints

Default chat messages/history are memory-only and keyed by session/project/
branch. Private Ask request prompts and selected text are redacted in SQL;
another session, even for the same user, cannot read the run's chat.
Agent prompts/proposals remain persisted audit material.

Sharing requires explicitly creating a project conversation, not merely
toggling an account preference. Shared reads require current ACL and chat
policy. Clear cancels late output, erases shared Ask messages/request text,
and leaves Agent audit intact. Retention defaults to 30 days; expiration
denies access at its deadline and purges on AI startup, run creation/read or
explicit `conversations.expire()`. Hosts may call that method in their owned
maintenance scheduler for deletion while the service is otherwise idle.
Session-local clear is `conversations.clearSession(actor, scope)`.

The parent-owned registry additions and exact callable signatures are
recorded in `docs/evidence/p2x-ai/contract-delta.md`. The AI module registers
all seven: image upload, explicit conversation creation/read, monthly usage,
security read/write, and session clear. Existing conversation deletion
provides shared clear. Authentication and CSRF use the real identity service.

## Verification

```sh
bun test tests/adapters/ai
./node_modules/.bin/tsc -p tests/adapters/ai/tsconfig.json
./node_modules/.bin/oxlint --type-aware --deny-warnings services/adapters/ai tests/adapters/ai
```

Fixtures use real HTTP, SQLite, encrypted runtime credentials, core source
and Git services. They use unique data roots/ephemeral ports and awaited
disposal. No fixed sleep, external paid inference or live provider success is
part of these tests. Consulted official sources and dated terminal evidence
are retained under `docs/evidence/p2x-ai/`.
