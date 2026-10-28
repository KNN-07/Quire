# P1S catalog

Owner: `st_01a17b7d`. October 27, 2026. Status: COMPLETE for assigned catalog
conversion. Native Bun 1.3.14: 45 tests pass; strict owned source/tests and
type-aware lint pass. Real PostgreSQL catalog domain checks pass. No complete
scale-profile or whole-repository acceptance is claimed.

## Exported consumer signatures

`services/core/catalog/index.ts` continues to export `Library`, `Templates`,
`cite`, `migrations`, `parseBibtex`, `singleRecord`, and
`register(context: ModuleContext): void`. All storage consumers must await:

```ts
// library.ts
type LibraryInput = {
  readonly bibtex: string; readonly origin: LibraryEntry["origin"];
  readonly providerId?: string | undefined;
};
class Library {
  constructor(context: ModuleContext);
  get(actorId: Id, id: Id): Promise<LibraryEntry>;
  list(actorId: Id): Promise<readonly LibraryEntry[]>;
  create(actorId: Id, input: LibraryInput, receipt?: HttpReceipt): Promise<LibraryEntry>;
  patch(actorId: Id, input: {
    readonly [K in keyof LibraryInput]?: LibraryInput[K] | undefined;
  } & { readonly id: Id; readonly expectedVersion: number }): Promise<LibraryEntry>;
  delete(actorId: Id, input: {
    readonly id: Id; readonly expectedVersion: number;
  }): Promise<{ ok: true; version: number }>;
  import(actorId: Id, file: File, receipt?: HttpReceipt): Promise<readonly LibraryEntry[]>;
}
// templates.ts
type TemplateFields = {
  readonly name: string; readonly category: string; readonly description: string;
  readonly license: string; readonly visibility: TemplateVersion["visibility"];
  readonly sourceProjectId: Id;
};
class Templates {
  constructor(context: ModuleContext);
  withTransaction(tx: Transaction): Templates;
  template(id: Id): Promise<Template>;
  version(template: Template, id: Id): Promise<TemplateVersion>;
  member(actorId: Id, organizationId: Id | null): Promise<boolean>;
  role(actorId: Id, role: "curator" | "template-publisher",
    organizationId: Id | null): Promise<boolean>;
  author(actorId: Id, template: Template): void;
  visible(actorId: Id | null, template: Template): Promise<TemplateVersion | null>;
  get(actorId: Id | null, id: Id): Promise<TemplateVersion>;
  list(actorId: Id | null): Promise<readonly TemplateVersion[]>;
  administration(): Promise<readonly TemplateVersion[]>;
  validate(fields: Pick<TemplateFields, "name" | "license" | "visibility">,
    organizationId: Id | null): void;
  insertVersion(tx: Transaction, template: Template, snapshotId: Id): Promise<TemplateVersion>;
  create(actorId: Id, fields: TemplateFields, receipt?: HttpReceipt): Promise<TemplateVersion>;
  patch(actorId: Id, input: {
    readonly [K in keyof TemplateFields]?: TemplateFields[K] | undefined;
  } & { readonly id: Id; readonly expectedVersion: number }): Promise<TemplateVersion>;
  newVersion(actorId: Id, input: {
    readonly id: Id; readonly snapshotId: Id; readonly expectedVersion: number;
  }, receipt?: HttpReceipt): Promise<TemplateVersion>;
  delete(actorId: Id, input: {
    readonly id: Id; readonly expectedVersion: number;
  }): Promise<{ ok: true; version: number }>;
}
// citations.ts
cite(context: ModuleContext, actorId: Id, input: {
  readonly scope: Scope; readonly publication: Publication;
  readonly targetFileId?: Id | undefined;
  readonly command: "cite" | "citet" | "citep"; readonly expectedVersion: number;
  readonly http?: HttpReceipt | undefined;
}): Promise<FileEntry>;
// publication.ts (direct module export)
transition(root: Templates, actorId: Id, input: {
  readonly id: Id; readonly expectedVersion: number; readonly versionId?: Id | undefined;
  readonly workspaceId?: Id | undefined; readonly status: TemplateVersion["status"];
}): Promise<TemplateVersion>;
```

`Template` remains `z.infer<typeof templateRow>` from `storage.ts`; its snake-case
internal fields are unchanged. `HttpReceipt` is the verified base export from
`p1s-core-base.md`, not an HTTP DTO. Constructors retain readonly `context`.
`migrations: readonly Migration[]`; pure parser signatures remain
`parseBibtex(source: string): readonly BibRecord[]` and
`singleRecord(source: string): BibRecord`, where
`BibRecord = { readonly citationKey: string; readonly bibtex: string }`.
No shared/public request or response schema changed.

## Transactions, authority and migrations

Every catalog mutation uses `uow.run(async tx => ...)`, acquiring
`quire:accounts` then `quire:catalog` before authority/version decisions.
This deliberately coarse portable lock replaces implicit SQLite writer
exclusion, including concurrent publication and version allocation. Transaction
helpers use the supplied executor or an immutable bound service; there is no
root SQL, nested UOW, synchronous native statement or ambient transaction.
`insertVersion` requires `Transaction`; callers hold those locks.

Template snapshot creation and citation Git/blob work remain outside SQL.
Catalog reauthorizes source reads in its final metadata transaction using
`CoreProjects.withTransaction(tx)`. Citations pass the actual lease from
`serialized` to `commitSource`; optional HTTP receipt identity joins durable
source finalization. Library create/import and template create/new-version
receipts join their aggregate transaction through base `saveHttp`.
Fault injection proves failed receipt insertion rolls back catalog metadata.

Submission, independent curator approval, publisher authority, approved-copy
policy, exact snapshot/version selection and optimistic guards remain intact.
Operator administration can discover submissions without gallery disclosure.
Private/organization/public gallery boundaries and independent bibliography
copies across Library and two projects survive native restart.
Concurrent native and PostgreSQL tests admit both contenders before either
transaction begins; each shared expected version produces one success and one
`STALE_VERSION`. A new draft does not replace the published gallery version.

Migration `024-k-catalog-publication` now has an explicit PostgreSQL variant.
Its original SQLite `sql` string is unchanged, including whitespace and STRICT.
No additional migration ID is needed. Catalog queries use portable ordinary
SELECT/INSERT/UPDATE/DELETE with `?` parameters; none require divergent SQL.
The accepted `3fe3a23` fixture reopens through this migration with all 12
previous migration rows/digests/timestamps unchanged and no FK violations.

## Verification, dependencies and cleanup

Evidence: `docs/evidence/p1s-catalog/{native-final.log,postgres-final.log,
strict-final.log,verification.md,cleanup.md}`.

- `bun test tests/core/catalog tests/core/library-templates.test.ts`: exit 0,
  **45 pass, 0 fail, 74 Bun expectations, 11 files, 16.98 seconds**; additional
  Node assertions cover concurrency and atomic receipts.
- `bun node_modules/typescript/bin/tsc --noEmit -p tests/core/catalog/tsconfig.json`:
  exit 0, strict production and owned tests, no diagnostic filtering.
- `bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings
  services/core/catalog tests/core/catalog tests/core/library-templates.test.ts`:
  exit 0. Source/test LSP both report zero diagnostics; scoped diff check exits 0.
- `QUIRE_CATALOG_POSTGRES_URL=... bun tests/core/catalog/postgres-domain.ts`:
  exit 0 against real PostgreSQL 17 with native Git/disk blobs and portable SQL
  events. Covers concurrent bibliography/publication/version CAS, snapshot
  pinning, HTTP receipt replay after restart, private gallery, operator discovery
  and approved exact-snapshot project copy. It is not a fake scale factory.

Consumed and verified named `p1s-contract.md`, `p1s-accounts.md`,
`p1s-core-base.md` and `p1s-postgres.md`; implemented exports agree with them.
The base receipt helpers are consumed directly from `base/receipts.ts`.
No unresolved owned dependency remains. Root integration still owns full
repository gates, Redis/S3/repository-service composition and two-API acceptance;
this lane does not claim those checks or modify sibling consumers.

Initial native check had 44 pass and one test-only transaction-wrapper failure
(`tx.lock is not a function`); explicit forwarding fixed it. An initial strict
check found optional migration-SQL narrowing, and lint found a type-only import.
Both were fixed without suppression. Intermediate receipts remain in
`verification.md`; no passed/still-running check was repeated unchanged.

All fixture listeners/adapters/roots are closed/removed. Real test database
`quire_catalog_c5d68d35650e4758abd2238242e4e433` was dropped before adapter close.
Container `quire-p1s-catalog-st01a17b7d`, its anonymous volume and loopback port
32915 were removed; readiness monitor was terminated. Terminal cleanup receipts
are in `cleanup.md`. No asynchronous work remains. No commit/push, dependency
change, original-input edit, sibling edit or unrelated cleanup occurred.
The repository ignores the evidence directory; retain/include it explicitly
when root is authorized to commit.
