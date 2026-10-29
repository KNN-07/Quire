# FINAL P71 reference lookup lifecycle

Completed 2026-10-29 in `/home/norman/Repos/Quire` against checkpoint
`7d51bfeaf2e8e1d74a66c9c008aed0c9bbabcebc`, repository-local Bun 1.4.4.
This handoff was the last file written by this lane.

## Delivered behavior

`services/adapters/references/index.ts` forwards the real
`request.request.signal` to PublicationRetrieval.search.
`retrieval.ts` composes that signal with its 30,000 ms provider deadline using
AbortSignal.any. The existing SafeHttpClient deadline remains in force.

Cancellation is checked before dispatch, before retention, within the retention
transaction before and after writes, and before returning the result. A held
successful transport response released after abort cannot become a success
response or retained provenance. Existing EGRESS_TIMEOUT behavior is preserved.

Actor activity, provider configuration version/enabled state, project read
authority, and selected Mendeley grant readiness/version/expiry are rechecked
before retention/publication. Transactional checks use the transaction executor,
including a transaction-bound CoreProjects instance, following existing adapter
practice. A stale membership no longer leaves provenance behind. The optional
retention verifier preserves existing DOI and explicit bibliography callers.

No shared contracts, endpoint shapes, frontend files, provider payload parsers,
or citationCreate behavior were changed. ReadCube and Dimensions remain honestly
unconfigured. Explicit search still retains usable response provenance.

## Exact checks and retained results

All commands below ran from `/home/norman/Repos/Quire`.

| Command | Exit | Result |
| --- | ---: | --- |
| `./node_modules/.bin/bun --version` | 0 | 1.4.4 |
| `./node_modules/.bin/bun test tests/adapters/references/inline-lifecycle.test.ts --test-name-pattern "discards\|authority becomes stale"` | 1 | Pre-fix: 1 pass, 4 fail, 3 filtered; 3.90 s |
| `./node_modules/.bin/bun test tests/adapters/references/inline-lifecycle.test.ts` | 0 | First fix: 8 pass, 0 fail, 21 assertions; 6.20 s |
| `./node_modules/.bin/oxlint --type-aware --deny-warnings services/adapters/references/index.ts services/adapters/references/retrieval.ts tests/adapters/references/inline-lifecycle.test.ts tests/adapters/references/inline-lifecycle-provider.ts` | 1 | Initial test-only no-misused-promises/unbound-method failures, retained and corrected |
| `./node_modules/.bin/bun test tests/adapters/references/inline-lifecycle.test.ts` | 0 | Final strengthened tests: 8 pass, 0 fail, 21 assertions; 6.61 s |
| `./node_modules/.bin/oxlint --type-aware --deny-warnings services/adapters/references/index.ts services/adapters/references/retrieval.ts tests/adapters/references/inline-lifecycle.test.ts tests/adapters/references/inline-lifecycle-provider.ts` | 0 | Final scoped lint clean |
| `./node_modules/.bin/bun test tests/adapters/references/retrieval.test.ts` | 0 | Existing acceptance: 4 pass, 0 fail, 22 assertions; 2.90 s |
| `./node_modules/.bin/tsc --noEmit --project tests/adapters/references/tsconfig.json` | 0 | No output |
| `git diff --check` | 0 | No whitespace errors |
| `git diff --quiet HEAD -- "Quire — LaTeX Editor.html" research.zip` | 0 | Original inputs unchanged |

The red command is written without table escaping in
`docs/evidence/p71-reference-lifecycle/results.md`, which retains failure
output, final passing output, exact error text, command handles and exit codes.
No unchanged passing check was rerun solely for this handoff. The second full
lifecycle run followed lint fixes and a stronger HTTP assertion.

Initial LSP error diagnostics were clean on all four changed TypeScript files.
Later fresh test-file diagnostics timed out after 3000 ms each; the completed
scoped tsc check above supplies the replacement evidence. No root build or full
suite was run; the verifier owns those checks.

## Observable proof

The controlled node HTTP provider holds its response. Tests subscribe to provider
entry and socket close before triggering lookup/abort, then await the actual
disconnect before releasing the provider response. Request cancellation and a
manually triggered retrieval deadline each yield HTTP 502 / EGRESS_TIMEOUT with
no provenance. No sleep, elapsed-time assertion, or polling is used.

A separate test performs a real successful HTTP provider request, holds its
transport return, aborts, then releases it; the route rejects and retains
nothing. Before the fix this returned HTTP 200.

Provider configuration replacement, membership removal, actor suspension, and
Mendeley grant revocation during provider handling reject with their respective
authority errors and no retained provenance. A denied project causes no outbound
provider disclosure. The successful explicit-search case retrieves one item and
retains its provenance. Existing DOI/restart/idempotency and private-provider
availability acceptance remains green.

## Ownership and exact cleanup

Owned test resources use `await using`. The new HTTP provider releases its held
callback, calls `server.close()` and `server.closeAllConnections()`, and awaits
the pre-registered close event with a bounded 3000 ms subscription. Existing
referenceProvider disposal awaits `server.stop(true)`.

Each existing referencesFixture owns a unique
`mkdtemp(join(tmpdir(), "quire-p2x-references-"))` directory, runtime, adapters,
scheduler and port-0 server. Its awaited disposer stops the server, closes
interchange if present, references, shared adapters and runtime, then removes
only that fixture directory. Spies restore in finally blocks. Command sessions
`bash_2`, `bash_3`, `bash_4`, `bash_6`, `bash_7`, `bash_8`, `bash_9` have exited;
their monitors ended with their commands. No standing monitor or owned process
remains. No environment override or temporary instrumentation was created.

Port 5173/FastShort was untouched; every listener used 127.0.0.1 port 0.
No live provider, commit, push, deployment, or production service was used.
Concurrent frontend edits and the pre-existing untracked `1` were preserved.
Evidence under `docs/evidence/` is ignored by the existing .gitignore.

## Hashes and review

Exact command: `sha256sum` followed by each path below, with the HTML path quoted.

```text
da9daaafd1c86d72c666374ecb616064f1149b3421ddb5cb9ed44992a88b0cb1  services/adapters/references/index.ts
8f0054d6f7bce92feb2160cb5029a6333ae0b3b3cc0603d2827bf076b971e9dd  services/adapters/references/retrieval.ts
637d0e01c3110a284dd587b2d03680ca80633f0cfa8ce7f765a5758e4c43a216  tests/adapters/references/inline-lifecycle.test.ts
253b0e1ff58c675a940b26e5750ac6a25055dd624f6f9859c8cbb6b1eecd1316  tests/adapters/references/inline-lifecycle-provider.ts
9bafc62657f71086891abf8197f3cff01c894776379b279a944dcabf3835edf7  docs/evidence/p71-reference-lifecycle/journal.md
b2cf03aec9208deb62345c0d2f626d7e7347f4b873b7ecb1d85a7252f260c203  docs/evidence/p71-reference-lifecycle/results.md
3c142cd472c611f01305926389edf2a820d982e3463a63c58158522b00da625a  Quire — LaTeX Editor.html
fe5fc30d34a363e05616f633feab19b643399be7acd7f7229c3fcd991506be63  research.zip
```

Production diff: index.ts +1/-1, retrieval.ts +32/-6.
Pure LOC via `awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(\/\/|#|--)/' "$f" | wc -l`:
index 113; retrieval 146; lifecycle test 137; provider helper 49.
Each file has one responsibility; existing schema boundaries and exhaustive
variant handling remain intact. No new type escape, suppression, unrelated
fallback, logging, parameter bloat, negative naming, or redundant mutation
verification was added. The journal records the full architectural review.

Assumption resolved from existing behavior: search cancellation uses the existing
EGRESS_TIMEOUT error contract, not a new endpoint contract or frontend flag.
Automatic and explicit lookups share the same authenticated search endpoint.
No out-of-scope seam was needed, and no P71 behavior is deferred.
