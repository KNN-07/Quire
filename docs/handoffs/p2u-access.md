# Effective editor access

Parent-owned contract delta, October 27, 2026. Status: VERIFIED.
This closes the shared editor contract gap without restricting the phase
to named membership or exposing the owner's collaborator management data.

## API

`endpoints.projectAccess`: `GET /api/projects/:p/effective-access`, query
`{branch}`. `endpoints.projectJoin`: `POST /api/projects/:p/join`, body
`{scope:{projectId,branch}}`. Both return:

```ts
{
  actorId: Id | null;
  role: "owner" | "editor" | "reviewer" | "viewer";
  source: "owner" | "member" | "link";
  branchRevision: number;
  capabilities: {
    read: boolean;
    edit: boolean;
    compile: boolean;
    review: boolean;
    chat: boolean;
    manageAccess: boolean;
    join: boolean;
  };
}
```

Use the exported endpoint's inferred response type. Both responses are
`private, no-store`. GET never adds membership. `source=link` includes a
previously admitted editor-link member. A signed-in, nonmember editor-link
reader must explicitly call `projectJoin`, with the usual session CSRF token,
before the existing realtime writer will accept source edits. Anonymous link
readers never receive edit/join permission. Admission uses the existing
transactional link enrollment, capacity, maintenance and live-policy checks.

The role describes the current grant; capabilities describe usable actions
now. An anonymous editor-link reader can therefore have `role=editor` but
`edit=false`. The `review` flag denotes comment/thread permission; tracked
suggestions still require their separate current policy. Chat reflects policy
and named/admitted membership. Organization membership alone is not a project
grant in the existing authorization model. Every mutation continues to
recheck authorization; this snapshot is not a reusable authority token.

Extract a browser share URL's credential and send it as `x-project-token`
on HTTP API requests. Strict endpoint query DTOs do not accept an additional
`share` query field. Realtime upgrade handles its own share query.

## Implementation and evidence

Contract: `packages/contracts/src/routes-core.ts`.
Backend: `services/core/base/effective-access.ts`, registered by
`services/core/base/access-routes.ts`.
Regression: `tests/core/base/effective-access.test.ts`.

Final command sequence exited 0:

```sh
bun test tests/core/base/effective-access.test.ts
bun node_modules/typescript/bin/tsc --noEmit -p tests/core/base/tsconfig.json
bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings \
  services/core/base/effective-access.ts services/core/base/access-routes.ts \
  packages/contracts/src/routes-core.ts tests/core/base/effective-access.test.ts
```

Three tests, 32 assertions, 2.02 seconds: owner/editor/reviewer/viewer,
outsider denial, anonymous link read, no membership on GET, CSRF denial,
explicit admission, restart, sharing-policy revocation, Viewer write denial,
maintenance and revoked-token denial. The preceding four existing share
regressions also passed unchanged. Their first combined run retained one new
test failure caused by using a share query rather than the HTTP token header;
that test input was corrected, not its authorization assertions. An initial
type-only import lint finding was also corrected.

Receipts: parent sessions `bash_102` (initial combined run), `bash_103`
(initial static run), `bash_104` (final focused tests/types/lint, exit 0).
Real fixture listeners and unique temporary roots are disposed by awaited
fixture teardown. No independent long-running process remains.

The preview producer owns affected registry-count tests and has been told
these two registered routes are additive to its own new compiler route.

## Canonical request authorization follow-up

`ProjectPort` now exposes the existing concrete signature:
`authorizeRequest(request: Request, scope: Scope, action: string): Promise<Id | null>`.
This lets compiler reads use the same token-aware authorization without a
concrete-class cast. The compiler producer owns its only typed fixture double;
the real source service already implements the method.

`AccessStore.role` now checks the live share token and current sharing policy
for admitted link members, so a previously granted membership cannot bypass
link policy through ordinary file or compile authorization. Named memberships
are unaffected. The added regression verifies denial on the actual file read
route and compiler authorization after the sharing policy changes.

Final follow-up command (`bash_105`) exited 0: 26 tests passed across
`effective-access`, `share`, `access`, review `links` and `permissions`,
followed by the base strict TypeScript gate and type-aware lint on the touched
port/access files. This includes actual realtime closure on token revocation.

## Typed share credential transport

`MutationHeadersSchema` in `packages/contracts/src/endpoint.ts` now includes
optional `x-project-token`. The existing typed client and router preserve this
header through their schema validation; clients need no cast or raw-fetch
bypass. A new real HTTP test in `tests/contract/http.test.ts` verifies both
the wire header and parsed handler input, then checks the same client's next
request does not retain the credential.

`bash_106` exited 0: all seven HTTP contract tests passed, followed by
`bun run typecheck` and type-aware lint on the two touched files.

## Canonical share URL

`accessLinkPut` now emits `/projects/:id/edit?share=...`, matching the actual
router and editor route parser, rather than the unmounted singular
`/project/:id` path. The existing real share-token test asserts the returned
pathname. `bash_107` exited 0: four share regressions, base strict TypeScript
and touched-file type-aware lint. A service-source search found no remaining
`/project/` links. Tests consume the server-generated URL without rewriting it.
