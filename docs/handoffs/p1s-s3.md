# P1S authenticated S3 BlobStore

Owner: `st_01a17b3d`. October 27, 2026. Status: COMPLETE for the assigned
adapter and real-service verification. Native Bun 1.3.14: 6 tests pass,
strict owned TypeScript and type-aware lint exit 0.

## Exported boundary

Direct import: `services/operations/storage/s3/index.ts`.

```ts
export type S3BlobStoreOptions = {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly virtualHostedStyle?: boolean;
};
export class S3BlobStore implements BlobStore {
  constructor(options: S3BlobStoreOptions);
  put(bytes: Uint8Array): Promise<Digest>;
  get(hash: Digest): Promise<Uint8Array>;
}
```

The unchanged `BlobStore` contract is consumed from `@quire/contracts`;
`StorageError` is consumed from `@quire/runtime`. The implementation uses
the native Bun 1.3.14 `S3Client`, not a new SDK dependency or an eval-only API.
There is no `close()` export: the BlobStore contract owns no lifecycle handle.

## Storage and integration

Object keys are `<first two digest characters>/<lowercase SHA-256 digest>`.
The adapter owns a copy of PUT input before hashing or awaiting upload.
`put` resolves only after the authenticated object upload completes. Consumers
must await it before calling `referenceBlob(tx, ...)` in their SQL transaction;
the adapter neither opens SQL transactions nor inserts blob metadata.
`get` validates its digest and verifies the actual downloaded bytes against it.
A mismatch throws `StorageError` with `code = "BLOB_CORRUPTED"` and
`resource = digest`. Backend failures propagate unchanged, including backend
codes for authentication, missing objects and missing buckets.

The operator must provision the bucket and supply explicit endpoint, bucket,
region and credentials. Optional temporary credentials and virtual-hosted
endpoints use Bun's corresponding S3 options. There is no public-read ACL,
bucket auto-creation, SQLite fallback, or profile claim.

No migrations, root configuration, package/lock edits or dependency additions.
Root composition must construct this adapter in its scale factory and pass it
as `RuntimeAdapters.blobs`; credentials/bucket provisioning remain integration
responsibilities. Native storage and accepted P1 behavior remain untouched.

## Checks and cleanup

Final commands, all with terminal exit code 0:

```sh
bun test tests/operations/storage/s3
bun node_modules/typescript/bin/tsc --noEmit -p tests/operations/storage/s3/tsconfig.json
bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings services/operations/storage/s3 tests/operations/storage/s3
```

Tests: **6 pass, 0 fail, 32 expectations, 2.65 seconds**. The actual
authenticated MinIO server verifies empty, non-UTF-8, subarray, Unicode and
11 MiB+3 bytes; immediate fresh-client reads after upload; caller-mutation
isolation; concurrent identical uploads; retained source/history/artifact
bytes after actual service/client replacement; corruption detection; missing
objects/buckets; wrong credentials; anonymous access denial; and invalid
configuration/digest rejection. These are storage byte fixtures, not a claim
that two APIs, domain metadata transfer or compiler replacement are integrated.

Tests create a uniquely named container and volume from
`minio/minio:RELEASE.2025-09-07T16-13-09Z`, bind an automatically assigned
loopback port, require authenticated access, restart the actual server with
its retained volume, and remove owned resources in teardown. The final run
owned `quire-p1s-s3-b2ce7eac-68dd-4eb5-8d0d-7667df36c7b0` and ports 32908,
then 32909. Container, volume and listener cleanup completed before test exit;
the final Docker inventory contained no `quire-p1s-s3-` resources.
All earlier attempt resources were also cleaned.

Production/test LSP diagnostics were clean. Scoped whitespace checking exited
0. Retained terminal output, image digest and cleanup receipts:
`docs/evidence/p1s-s3/verification.md`; honest intermediate failures and their
corrections: `docs/evidence/p1s-s3/attempts.md`.

No unresolved producer dependency blocks this adapter. Root integration still
owns scale configuration/factory wiring, protected real operator credentials,
bucket provisioning, domain/two-API acceptance and whole-repository gates
after consumers migrate. Those checks were not run in this assigned subtree.
No package dependency is requested. No commits/pushes, migration edits,
original input changes, sibling edits or unrelated resource cleanup.
