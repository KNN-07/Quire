# P48 correlated publisher preparation and receipts

October 28, 2026. FINAL parent proof of one controlled publisher lifecycle.
This closes P30's missing archive-invocation and receipt-correlation evidence;
it does not certify a live destination or submission UI.

`tests/adapters/publisher/lifecycle.test.ts` uses the existing real compiler,
interchange exporter, authenticated routes and owned loopback publisher.
Preparation causes zero submissions. One explicit confirmed submission sends
the prepared ZIP; replay returns the same operation without another send.
The fixture then accepts that same remote submission and its status request
persists the accepted receipt. The destination independently hashes the
received archive and derives its receipt from the submission ID and digest;
the test compares that receipt with the retained preparation's digest.

## Unique evidence packet

All artifacts are under
`docs/evidence/p48-publisher-correlation/9b8b5b37-82c8-425e-9f5e-42c3ffb780db/`.
The old fixed-path P2X archive and unrelated receipts remain unchanged.

- `acceptance.log`: exact command, cwd, UTC start/end and identical pre/post
  hashes for the new case, four fixture helpers and six publisher source files.
- `prepared-submission.zip`, `prepared-manifest.json`, `compiled-output.pdf`:
  actual prepared bytes, immutable snapshot manifest and compiled output.
- `correlation.json`: preparation, archive operation, submit operation,
  status operation, remote submission, receipt and both artifact digests.
- `static.log`: selected strict TypeScript and type-aware deny-warning lint,
  `P48_STATIC_EXIT=0`.
- `compiled-output.png`: rendered PDF, inspected by the parent. The expected
  single-page document displays "Publisher fixture." and page number 1,
  without clipping or missing content.

The executed command was:

```sh
QUIRE_PUBLISHER_EVIDENCE=docs/evidence/p48-publisher-correlation/9b8b5b37-82c8-425e-9f5e-42c3ffb780db \
  ./node_modules/.bin/bun test tests/adapters/publisher/lifecycle.test.ts
```

It passed one case with 14 assertions in 44.67 seconds, exit 0, ending at
16:45:54Z. Monitor `mon_V7EPMA7DM59NP5YY` / `bash_432`.
The selected static commands were
`./node_modules/.bin/tsc --noEmit -p docs/evidence/p2x-publisher/tsconfig.json`
and `./node_modules/.bin/oxlint --type-aware --deny-warnings tests/adapters/publisher/lifecycle.test.ts`.
Monitor `mon_VFV70ME40JZNZRKM` / `bash_433` completed exit 0.
The new file also had no LSP diagnostics.

## Correlated identities

| Fact | Actual value |
| --- | --- |
| Project | `c52e287c-8860-44d0-a21a-69e0cd762f33` |
| Snapshot | `ac8ab8db-4275-4a59-9d11-22280dc52c8d` |
| Preparation in prepare, submit and status | `d8936bb8-f990-4f60-8f53-c83140bdd362` |
| Archive operation | `b0b9ccf5-e83b-453f-a866-8937ee0224ce` |
| Submit operation | `e186526c-07af-4da9-a410-b9a14d061be1` |
| Status operation | `f511a78c-0270-4f28-9976-d1ccf2f53885` |
| Remote submission in both receipts | `publisher-1` |
| ZIP SHA-256 | `162fd41672bbcbffe7558aedbd75e84e5f050b44314eb7aefbb49050c70d2903` |
| PDF SHA-256 | `fdebdd45f0422bde7923c583e6d2975946d53b22febeead8fce0db120e47b185` |

The actual provider request log contains OAuth authorization/token exchange,
one `POST /api/submissions` and one `GET /api/submissions/publisher-1`.
The archive preserves the binary source bytes `[0,255,37,81]`.
No live publisher, merchant, recipient or external submission was used.

## Cleanup and scope

The awaited fixture disposal stops its API, compiler worker, adapters, runtime
and provider and removes its root. Parent independently observed
`/tmp/quire-publisher-jLgeQf` absent and provider port `127.0.0.1:44449`
refusing connections. The PDF rendering command also completed exit 0.

The test's single responsibility is cross-step artifact identity. Existing
helpers own protocol behavior; the new test adds no production layer, type
escape or polling delay. Production source did not change, so the accepted
negative/provider suites and production build were not replayed.
