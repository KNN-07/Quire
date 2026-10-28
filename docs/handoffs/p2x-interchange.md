# P2X native interchange

Owner: `st_01a17c47`. Date: October 27, 2026.

**Status: assigned implementation and native acceptance complete.**
Native Bun **1.3.14** passed 33 interchange tests, strict TypeScript and
type-aware deny-warning lint. The references owner's final 38-test receipt
additionally accepts the actual composed bibliography/URL dispatcher, including
transaction rollback and journal recovery. No live third-party success,
whole-application/browser acceptance or PostgreSQL execution is inferred.

## Delivered behaviors

Matrix P09/P15/P16/P27/I42b; T04/T16; X-URL/X-TOOLS.

- ZIP imports reuse core's real central-directory/path/expanded-size/count/
  special-entry/CRC validation and persistent source/Git creation. Independent
  keys create independent projects; ordinary binary bytes survive restart.
- Open-in accepts actual multipart files, snippets, bounded data URLs, public
  direct-download URLs and real actor-owned staged upload IDs. DOCX/Markdown
  dispatch to Pandoc; TeX/ZIP use native source mechanics.
- Optional `mainPath`, `engine`, `environmentId` select settings before the first
  source publication. Invalid explicit selections do not silently fall back.
- Actual Docker-confined Pandoc performs DOCX/Markdown import and DOCX/
  Markdown/HTML export. Originals remain under `originals/`; assets are retained.
  The installed and tested version is Debian Pandoc **2.17.1.1**, not a claimed
  latest upstream version.
- URL links and manual refresh use the shared pinned-DNS/redirect/size/deadline
  client. Private/loopback/link-local/metadata destinations and HTML/login/
  Drive confirmation pages fail truthfully. Remote failures/conflicts preserve
  current child bytes. Linked TeX is noneditable and cannot be main.
- Submission ZIP packages real source separately from an actual successful
  exact-snapshot compiler job's PDF/BBL. Bibliography source requires generated
  BBL. No synthetic PDF, bibliography or implicit publisher send exists.
- Core retains one export route and one pair of link routes. Interchange owns
  unified `importCreate`, installs the real exporter and composed external-link
  delegate, and dispatches Git/GitHub to actual shared remote contributions.

## Exact exports and composition

Public entrypoint: `services/adapters/interchange/index.ts`.

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

type RemoteImporter = (
  actorId: Id, input: RemoteImport, receipt: HttpReceipt,
) => Promise<Operation>;
```

Other value exports: `PandocConverter`, `conversionLosses`,
`InterchangeImports`, `InterchangeExports`, `fetchSource`, `resolveSource`,
`UrlLinks`, `sharedRemoteImporter`, `ImportUploads`, `migrations`.
Other type exports: `NativeImport`, `RemoteImport`, `RemoteImporter`.
`NativeImport` includes native kind/name/source/workspace and optional
`mainPath`, `engine`, `environmentId`.

`PandocConverter` exposes `capability()`, `probe()`, `convert()` and `close()`.
Readiness requires actual isolated `pandoc --version`, not merely an image name.
Missing Docker/image configuration reports its exact installation/configuration
requirement. `ImportUploads.get/read` use the current actor ID and real persisted
metadata/blob bytes; no synthetic staged-upload resolver remains.

Module: `065-x-interchange`, lane X, order 65. Create fresh factories for each
runtime. Include core first, shared connections/providers 60/61, remote Git 62
and references 64, then interchange 65:

```ts
const references = createReferencesModules();
const remote = createRemoteGitIntegration(); // registerImportRoute=false
const shared = createAdapterModules({
  contributions: [...remote.contributions, ...references.contributions],
});
const interchange = createInterchangeModule({
  bibliographyLinks: references.links,
});
```

Include the returned modules, not another import/link/export route.
`references.links` is lazy-safe before registration and is the exact
`ExternalLinks` property, without an alias. Interchange selects URL versus
bibliography by actual link kind. Parent passes that property during assembly.
Core owns `provideExternalLinks` and `provideProjectExporter`; HTTP receipts
are attached to actual source publication.

Stop admitting work, await interchange `close()` (cancel/drain converters),
references `close()`, shared `close()`, then runtime `close()`. Also close
factories after construction failure. No scheduler or detached job starts here.
Routes consume runtime mutation admission; no backup admission bypass or
composition/scale ownership release is introduced. Parent retains application
composition and module 041 lifecycle integration.

## Staged-upload HTTP contract

Authorized shared edits: `packages/contracts/src/multipart.ts` and
`routes-adapters.ts`, preserving the parent's AI/connection routes.

| Endpoint | Actual contract |
| --- | --- |
| `POST /api/import-uploads` | Multipart `file`, identity/CSRF/Idempotency-Key; 201 `{id,filename,mime,bytes,sha256,expiresAt}` |
| `GET /api/import-uploads/:id` | Current actor-owned metadata; foreign/absent 404, expired 410 |
| `GET /api/import-uploads/:id/content` | Current actor-owned original bytes, attachment headers |
| `POST /api/imports` | Existing source union; `source:{kind:"upload",uploadId}` reads the actual stored bytes |

Each file is bounded by `QUIRE_UPLOAD_BYTES` (default 50 MiB); outstanding actor
staging is capped at four times that bound and `QUIRE_UPLOAD_ENTRIES` (default
180). IDs expire after 24 hours; expired-key replay instructs a fresh key.
Staging metadata and HTTP receipt commit together with the blob reference,
using the supplied transaction executor. Expiry does not delete shared
content-addressed blobs; operator retention/GC owns physical reclamation.
File MIME is Bun's parsed `File.type`, not a claim to preserve raw multipart
header MIME; the parent documents that native runtime limitation.

Conversion/download preparation happens before the finite core HTTP receipt
lease. A durable internal source receipt resumes an already-created project
after interruption, even if the external URL is subsequently unavailable.
Replay of a completed import does not download again.

## Migration preservation

Only new migration: **`066-x-interchange-uploads`**, exported from
`services/adapters/interchange/migrations.ts`.

It adds `interchange_uploads` and `interchange_upload_owner`, with actor and blob
foreign keys. SQLite uses STRICT/INTEGER; PostgreSQL has an explicit BIGINT
variant. Exact SHA-256:

- SQLite: `97e4a3f1e12769beb7213bba7a100f6b85fbcd34f804f051a1b3da805dd33c8e`
- PostgreSQL: `33615c3ce703a0defc98b4366076f7f64ffd11e033c6e1dbac610931dde6f3fc`

The real staged-upload restart test compares every applied migration row,
digest and timestamp before/after reopen. Existing SQLite SQL, applied hashes
and original research inputs were not edited. The new PostgreSQL SQL is
provided but was not executed against PostgreSQL by this task.

## Terminal evidence and commands

```sh
docker build -t quire-p2x-interchange:st_01a17c47 \
  -f services/adapters/interchange/Dockerfile .
export QUIRE_PANDOC_IMAGE="$(docker image inspect \
  quire-p2x-interchange:st_01a17c47 --format '{{.Id}}')"
QUIRE_INTERCHANGE_EVIDENCE="$PWD/docs/evidence/p2x-interchange" \
  bun test tests/adapters/interchange
bun x tsc --noEmit -p tests/adapters/interchange/tsconfig.json
bun x oxlint --type-aware --deny-warnings \
  services/adapters/interchange tests/adapters/interchange \
  packages/contracts/src/multipart.ts packages/contracts/src/routes-adapters.ts
```

| Gate | Terminal result |
| --- | --- |
| Owned image build | Exit 0; actual Pandoc installed and executed |
| `bun test tests/adapters/interchange` | Exit 0; **33 pass, 0 fail, 92 expectations, 9 files, 74.28 s** |
| Full owned strict TypeScript closure | Exit 0 |
| Type-aware deny-warning lint above | Exit 0 |
| LSP on 10 interchange implementation files | Zero diagnostics |
| Owner's actual composed bibliography integration | Exit 0; references **38 pass, 0 fail, 138 expectations, 10 files, 14.70 s**; strict/lint clean |
| Owned container/process/temp-root inventory | Empty; inventory command exit 0 |

Primary owned receipt: `docs/evidence/p2x-interchange/native-final.log`.
Earlier honest checkpoints/fixes: adjacent `terminal-history.md`.
References integration receipt:
`docs/evidence/p2x-references/link-final.log` and `link-contribution.md`;
these were read only after FINAL was confirmed.

Retained actual artifacts include `roundtrip.docx`, `roundtrip.tex`,
`roundtrip-input.md`, `roundtrip-output.md`, `submission.pdf`, `submission.bbl`,
`submission.zip`, `submission-manifest.json`. Their exact hashes and cleanup
probes are in `native-final.log`. Source and generated manifest arrays are
asserted independently. The bibliography owner additionally proved actual
SQLite-trigger finalization rollback, receipt/source atomicity and recovery
after transient claim release, with the same real dispatcher.

The isolated tool image ID is
`sha256:56b2ba7998178a73a2b3df1083e4cba2f0ee171232e5cc5a507dc54678d4d010`.
Runtime execution is `--pull=never`, unprivileged, networkless, read-only root/
source, no capabilities/new privileges, 512 MiB memory, one CPU, 64 PIDs,
64 MiB work tmpfs and 16 MiB temporary tmpfs, with bounded output and a 60-second
conversion deadline. Unique containers/source roots are removed on all outcomes.

## Configuration, loss boundaries and external prerequisites

Operational examples and limits are in `services/adapters/interchange/README.md`.
Pandoc installation was completed here, not left as a credential blocker.
Operators must configure an immutable locally installed image digest and
reachable Docker daemon. Submission export requires a successful installed
isolated compiler job for the exact snapshot, with real PDF/BBL artifacts.

Pandoc preserves supported structure, not exact pagination/fonts/layout or
arbitrary classes/macros/comments/tracked changes. Executable uploaded filters,
scripts and TeX shell commands are not selected as host conversion commands.
Original DOCX/Markdown bytes are preserved.

Google Drive support is public direct download/manual refresh, not OAuth or
two-way sync. Use actual `webContentLink`/Workspace `exportLinks` bytes or upload
manually; private/login/confirmation pages fail. No real Drive credential was
supplied or live account read claimed.

Remote Git requires its actual provider registration/user grant and repository
authority. Generic authenticated Git remains explicitly unconfigured pending
the remote owner's typed non-OAuth enrollment contract; no clone stub replaces
it. Bibliography requires actual references configuration/grants; Zotero's
typed key-admission delta and private-provider procurement remain owned external
prerequisites documented by references. These are not native interchange
implementation omissions or claims of live third-party success.

Official primary sources consulted **October 27, 2026**, fetched directly:

- https://pandoc.org/MANUAL.html
- https://developers.google.com/workspace/drive/api/guides/manage-downloads
- https://docs.docker.com/reference/cli/docker/container/run/

No SDK was added. No paid/live external account write, workspace commit/push,
nested agent, editor edit, unrelated listener cleanup or shared-image mutation
was performed.

## Architectural review and final cleanup

Files own conversion isolation, transport/source parsing, import publication,
export packaging, URL dispatch, staged storage, remote dispatch and assembly.
Every owned TypeScript file is below 200 pure lines; largest is converter at
131. Boundaries parse with Zod, tagged dispatch is exhaustive, semantic IDs use
shared brands, and no casts/suppressions/non-null assertions bypass missing
ports. Helpers have reused operations or explicit resource lifetimes; no
speculative fallback, redundant post-write verification, negative-form domain
flags, parameter smuggling or new logging framework was introduced.
Tests drive real HTTP/Git/Pandoc/compiler behavior and negative cases without
fixed sleeps or success-only service mocks.

All owned terminal checks ended before this handoff. Converter and probe
containers, native test processes, fixture listeners and temporary roots are
closed/absent. No browser was created. The installed owned image is retained
as the provisioned tool. Listeners 5173/3001 and shared Docker images were
untouched. No owned implementation dependency or pending terminal check remains.
