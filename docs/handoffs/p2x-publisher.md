# P2X publisher adapter

Owner: `st_01a17c55`. October 27, 2026.

**Status: assigned implementation and native acceptance complete.**
Publisher implementation, direct tests, static checks, archive/receipt
inspection, cleanup, and final interchange reconciliation are complete. This
accepts P30/X-PUBLISH native behavior and deterministic protocol evidence, not
a live publisher account submission or whole-application/browser acceptance.

The final `docs/handoffs/p2x-interchange.md` was read after its 33-test strict/
lint receipt and the references owner's 38-test composed-link receipt. Current
interchange retains sole import/link/export route ownership and installs the
real project exporter consumed here.

## Delivered behavior

The publisher contribution implements the registered actions `prepare`,
`submit`, and `status` through the shared configured-adapter runtime.

- `prepare` calls the real interchange `submission` exporter for an immutable
  snapshot. It retrieves the resulting operation ZIP under current project ACL,
  hashes the exact bytes, and transactionally records a durable
  `publisher_submissions` preparation. It performs zero publisher HTTP traffic.
- A prepared archive preserves interchange's `source/`, `generated/`, and
  `manifest.json` entries. Actual retained evidence contains `main.tex`, an
  unchanged four-byte binary source, and a compiler-produced PDF.
- `submit` requires a distinct explicit action with `confirmation: true` and
  current write authority. Direct mode sends the exact prepared ZIP once with
  bearer authorization, `application/zip`, `Idempotency-Key`,
  `X-Quire-Project-Id`, and `X-Quire-Archive-Sha256`.
- Manual mode sends nothing. It requires the destination-issued submission ID
  and receipt before Quire records `submitted`.
- Direct submission parses the configured response fields and commits the
  operation result, cursor, provider ID/status/receipt, and outbox event through
  the supplied transaction executor. Destination I/O and archive preparation
  occur outside SQL transactions.
- `status` makes an authenticated configured GET only for direct submissions
  with a remote ID. Manual and merely prepared submissions return durable local
  state without network traffic. Direct status receipts update transactionally.
- Adapter-level idempotency returns the stored operation without sending a
  second submission. Current ACL, grant version/state, provider configuration,
  and preparation ownership are rechecked at publication boundaries.
- Revoked grants, unauthorized actors, provider errors, changed destination
  contracts, reused preparations, missing manual receipts, invalid response
  bodies, and protected-secret leakage do not manufacture a submitted state.

No live publisher account, paid write, or third-party success is claimed.

## Public exports

Entry: `services/adapters/publisher/index.ts`.

```ts
const publisherModule: ServiceModule;
const publisherContribution: AdapterContribution;
const PublisherContractSchema: z.ZodType;
function parsePublisherContract(settings: ProviderSettings): PublisherContract;
function publisherRequirements(settings: ProviderSettings): readonly string[];
const migrations: readonly Migration[];

type PublisherContract =
  | {
      readonly version: 1;
      readonly mode: "manual";
      readonly credentialTestPath: string;
      readonly oauth: OAuthMapping;
    }
  | {
      readonly version: 1;
      readonly mode: "direct";
      readonly credentialTestPath: string;
      readonly oauth: OAuthMapping;
      readonly submitPath: string;
      readonly statusPath: string;
      readonly responseFields: {
        readonly submissionId: string;
        readonly status: string;
        readonly receipt: string;
      };
    };
type DirectPublisherContract = Extract<PublisherContract, { mode: "direct" }>;
```

`publisherModule` is lane X, order 66, ID `066-x-publisher`. It owns the
publisher migration only. The contribution is passed to
`createAdapterModules({ contributions })`; no shared registry file was edited.

Configuration and exact request/response mapping are documented in
`services/adapters/publisher/README.md`.

## Destination configuration

The current shared `ProviderConfig` has no typed destination-contract field, so
the versioned mapping is stored in the existing `model` string as JSON.
`baseUrl` is the authorized destination API root and `secret` is the encrypted
OAuth client secret. Paths must be relative and cannot contain traversal,
query, or fragment components. Direct status paths contain exactly one
`{submissionId}` placeholder.

Unconfigured state names every missing prerequisite:

- publisher destination API base URL;
- publisher OAuth client secret;
- publisher destination contract mapping in model JSON.

Invalid private mappings report a valid-contract prerequisite rather than
inventing endpoints. OAuth authorization-code enrollment uses the shared S256
PKCE/state/session/configuration binding and encrypted runtime grant storage.

## Migration

Migration ID: `066-x-publisher`.

It creates `publisher_submissions` with actor, grant, project, archive operation,
archive SHA-256, destination mode, local state, remote submission ID, provider
status, receipt, provider configuration version, and timestamps. It also adds a
project/creation index.

Explicit variants:

- SQLite STRICT SQL SHA-256:
  `38259d2fb2f705a3cdc9478611e98dfc67001d1ac759f4ee9726f3a2b032628a`
- PostgreSQL SQL SHA-256:
  `e138fa1212a8d8f1ceb9196079e6bdcefee649dc36960b5c3b145de3a497f431`

The new PostgreSQL variant is authored and directly asserted, but this publisher
task did not execute it against a live PostgreSQL server. No existing migration,
original input, or accepted migration digest was edited.

## Terminal verification

Native runtime: Bun `1.3.14 (0d9b296a)`.

Final behavioral command:

```sh
QUIRE_PUBLISHER_EVIDENCE=docs/evidence/p2x-publisher \
  bun test tests/adapters/publisher
```

Exit 0: **10 pass, 0 fail, 31 expectations, 2 test files, 62.48 seconds**.
Expected negative-path `request.failed` records contain only request IDs and
`GRANT_UNAVAILABLE` / `PUBLISHER_HTTP_ERROR` codes.

Owned strict TypeScript:

```sh
bunx tsc --project docs/evidence/p2x-publisher/tsconfig.json
```

Exit 0, no output.

Owned type-aware lint:

```sh
bun run lint -- services/adapters/publisher tests/adapters/publisher
```

Exit 0:

```text
$ oxlint --type-aware --deny-warnings services/adapters/publisher tests/adapters/publisher
```

Final LSP diagnostics reported zero errors across production and test
directories. The mandatory external no-excuse helper could not resolve its
required TypeScript 7 unstable API from this repository; no dependency was
installed because root dependencies are outside scope. The owned TypeScript and
type-aware lint gates above are clean.

The whole-repository incremental typecheck initially referenced a concurrently
removed remote-Git fixture. A clean whole-repository check then exposed both
publisher type findings and concurrent remote-Git failures. All publisher
findings were fixed; the exact owned project exits zero. Out-of-scope remote-Git
failures are not relabeled as a clean whole-project check.

## Direct test evidence

The protocol fixture is a stateful local OAuth/resource server, not a
success-only mock. It verifies authorization-code PKCE, client credentials,
bearer access, revocation, raw ZIP digest headers, provider idempotency,
submission receipts, status updates, and injected provider errors.

Covered outcomes:

1. Exact unconfigured prerequisites and invalid private mapping.
2. Explicit SQLite/PostgreSQL migration variants.
3. Actual compiler and interchange preparation with zero submission traffic.
4. Source manifest and unchanged binary byte preservation.
5. One explicitly authorized direct submit and one durable replay.
6. Durable remote ID/status/receipt publication.
7. Configured status refresh and receipt update.
8. Current project ACL denial before provider traffic.
9. Revoked-grant denial.
10. Provider HTTP failure retaining `prepared` without a receipt.
11. Manual receipt publication with zero archive traffic.

No fixed sleep or polling makes a test pass. The compiler terminal signal is
subscribed before enqueue and has a bounded timeout.

## Retained evidence

`docs/evidence/p2x-publisher/` contains:

- `test-final.log`: terminal 10-test result.
- `typecheck-owned-final.log`: exit-zero owned strict check.
- `lint-final.log`: exit-zero owned type-aware lint.
- `prepared-submission.zip`: exact prepared interchange archive.
- `prepared-manifest.json`: retained submission manifest.
- `submission-receipt.json`: direct submitted receipt.
- `status-receipt.json`: accepted status receipt.
- `archive-inspection.log`: historical ZIP listing and SHA-256, not the current artifact.
- `archive-current-inspection.md`: parent-verified current ZIP identity and attribution limits.
- `archive-bytes.log`: PDF magic and preserved binary bytes.
- `migration-digests.log`: migration ID and both exact SQL digests.
- `loc.log`: final pure line counts.
- `cleanup-final.log`: empty publisher temp-root and Bun-process audit.
- `tsconfig.json`: exact owned strict-check closure.

Current retained archive inspection (parent reconciliation, October 27, 2026):

- ZIP SHA-256:
  `8f142433c6268ee77dc1860d267b2d782647454e05629d0a9188ab809f28aefe`
- manifest snapshot: `de5704eb-d0b7-4c91-abac-8dda632a9bd8`;
- entries: `source/main.tex`, `source/source.bin`,
  `generated/output.pdf`, `manifest.json`;
- PDF first five bytes: `25 50 44 46 2d` (`%PDF-`);
- binary source bytes: `0 255 37 81`.

The final run refreshed the evidence artifacts; receipt IDs and archive hashes
are deterministic only within their retained run, not product constants.

## Contract deltas for parent integration

Shared/base deltas already documented in `docs/handoffs/p2x-base.md`:

1. `ExternalAdapter.test` must require `actorId`.
2. `ExternalAdapter.execute` must publish `actorId`, typed parameters, and
   `expectedVersion`.
3. The endpoint registry needs X-laned
   `GET /api/connections/availability`.

Publisher-specific deltas:

1. `ProviderConfig` needs a typed destination-contract mapping instead of
   overloading `model` with versioned JSON.
2. Capability reporting must be per action, so a manual destination can expose
   `prepare`/manual receipt as ready while direct `submit` is unavailable.
3. Shared connections need a non-OAuth enrollment path for API-key, partner
   token, or operator-issued manual destination credentials.
4. Core/interchange should export a public submission-export port. Publisher
   currently imports `delegatedExport` from
   `services/core/base/export-adapter.ts` because it is not exported from the
   core base index. The implementation still consumes the real registered
   interchange exporter; this is an integration-surface delta, not a fake ZIP.
5. Foundation/integration must assemble `publisherModule`,
   `publisherContribution`, shared connections/providers, and the interchange
   module in dependency order. Core precedes shared 60/61; remote Git 62 and
   references 64 precede interchange 65; publisher migration module 66 follows.
   Add `publisherContribution` to the one shared contribution registry rather
   than registering another connection/action route.

No casts, suppressions, or edits outside the assigned publisher scope were used
to hide these missing shared contracts.

## External prerequisites and live boundary

X-PUBLISH remains:

- destination-specific public or partner submission API contract;
- OAuth/app registration or approved alternative credential enrollment;
- authorized recipient user grant and scopes;
- exact API base URL, paths, response field mapping, and revocation behavior;
- journal/publisher recipient approval and any organization allowlisting;
- current user authorization before a real external submission.

Without these, the adapter and deterministic protocol fixture are complete, but
the real destination remains unconfigured. Quire never infers private endpoints
or records submitted without a provider receipt.

Official primary documents consulted October 27, 2026:

- RFC 9110, HTTP Semantics:
  `https://www.rfc-editor.org/rfc/rfc9110.html`
- RFC 6749, OAuth 2.0 Authorization Framework:
  `https://www.rfc-editor.org/rfc/rfc6749.html`
- RFC 7636, OAuth PKCE:
  `https://www.rfc-editor.org/rfc/rfc7636.html`

No destination-specific publisher documentation was supplied; therefore no
fictional provider endpoints or live success are represented.

## Cleanup and architectural review

Every fixture stops its ephemeral Quire and publisher listeners, compiler
worker, interchange converter, adapter operations, runtime, and unique temporary
root. The final command-name-filtered audit reports:

```text
--- temp roots ---
--- owned Bun processes ---
```

No publisher container or browser was created. Shared listeners 5173/3001 and
unrelated Docker images were not touched.

All final source files are at or below 249 pure LOC. The production
`contribution.ts` is in the 200-250 warning band; the next behavioral edit
should split action definitions by responsibility. Current files own contract
parsing, provider HTTP, durable storage, action orchestration, migration/module
registration, protocol fixture, fixture API/lifecycle, assertions, and scenarios
separately.

Boundary input and provider responses parse through Zod. Variant behavior uses
the publisher mode discriminant or exhaustive switch in upstream interchange.
There are no `any` annotations/assertions, non-null assertions, TS suppressions,
mutable exports, negative-form names, redundant post-action verification,
new logging framework, or fixed test sleeps. Helpers have multiple callers or
own a durable domain responsibility.

No workspace commit or push was made. Original inputs and unrelated concurrent
changes were not modified.

## Final interchange reconciliation

Final interchange entrypoint:
`services/adapters/interchange/index.ts`.

```ts
createInterchangeModule(options?: {
  readonly http?: SafeHttpClient;
  readonly converter?: PandocConverter;
  readonly remoteImport?: RemoteImporter;
  readonly bibliographyLinks?: ExternalLinks;
}): {
  readonly module: ServiceModule;
  readonly close: () => Promise<void>;
};
```

Relevant final exports include `InterchangeExports`, `PandocConverter`,
`InterchangeImports`, `fetchSource`, `resolveSource`, `UrlLinks`,
`sharedRemoteImporter`, `ImportUploads`, and interchange `migrations`.
Interchange module `065-x-interchange` calls `provideProjectExporter` exactly
once; core retains the sole HTTP export route. Publisher does not register an
export endpoint and consumes that installed exporter through `delegatedExport`.

The final submission contract remains behaviorally identical to the one tested
by publisher:

- immutable requested/current project snapshot;
- current `download` authorization and project policy;
- source entries under `source/`;
- only actual successful exact-snapshot PDF/BBL artifacts under `generated/`;
- required PDF magic validation;
- required BBL when bibliography source exists;
- independent source/generated manifest arrays;
- no implicit destination send.

Interchange's later exhaustive `switch` refactor, staged-upload migration
`066-x-interchange-uploads`, remote-import dispatcher, external-link
composition, and optional import settings do not alter the publisher-consumed
submission archive behavior. Per the user's instruction, the unchanged
publisher 10-test suite was not rerun after this dependency-only reconciliation.

Interchange terminal evidence is exit 0: **33 pass, 0 fail, 92 expectations,
9 files, 74.28 seconds**, strict TypeScript clean, type-aware lint clean, and
zero LSP diagnostics. The references owner's composed bibliography/link
acceptance is exit 0: **38 pass, 0 fail, 138 expectations, 10 files,
14.70 seconds**, with strict/lint clean. Interchange reports all owned
containers, processes, listeners, and temporary roots closed or absent; the
provisioned immutable Pandoc image remains intentionally installed.

No final interchange finding invalidates publisher evidence. The remaining
public submission-export port delta is accurately scoped: interchange publicly
exports its implementation class, but core's installed `delegatedExport`
function still is not exported from the core base index, so publisher imports
the core internal module directly.
