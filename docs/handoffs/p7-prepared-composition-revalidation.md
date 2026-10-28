# Prepared application composition revalidation: FINAL

October 27, 2026. Parent-owned scoped revalidation.

The original prepared-runtime FINAL remains historical and unchanged. Its
composition fingerprint was superseded by the documented signed update-client
and operation-reader injection in `p7-installation-integration.md`.
The other 11 original manifest entries still match exactly.

Current composition SHA-256:
`68f248ababd48eb6f0bc918f27d6f193d70ff7df872646255e8dac8d4ca21277`.

Current complete 12-entry admission manifest:
`docs/evidence/p7-prepared-runtime/composition-revalidation.sha256`.
All entries were measured before this run and verified afterward with
`sha256sum -c`; all 12 returned OK. The integration owner was asked to hold
composition edits during the revalidation.

The affected application checks ran on project-local Bun 1.4.4:

```sh
./node_modules/.bin/bun test tests/integration/prepared-runtime/application.test.ts &&
./node_modules/.bin/bun ./node_modules/typescript/bin/tsc --noEmit \
  -p tests/integration/prepared-runtime/tsconfig.json &&
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  apps/server/src/composition.ts tests/integration/prepared-runtime/application.test.ts
```

`mon_5CD6XN8C69AQ1SHB` completed exit 0. All six application tests passed,
44 assertions, 3.08 seconds. Strict types and type-aware deny-warning lint
completed silently with exit 0. Actual terminal output is retained in
`docs/evidence/p7-prepared-runtime/composition-revalidation.txt`.

The unchanged cases cover real pre-activation HTTP/SSE/Git/worker/WebSocket
denial, inactive getters, actual activation and SMTP delivery, default eager
compatibility, module replacement, failed activation and registration cleanup,
compiler child/reaper draining and retained detached SQL failures.

Unchanged runtime and PostgreSQL-specific tests were not repeated. Their
original FINAL evidence remains applicable to their unchanged inputs; this
receipt supersedes only the composition mismatch. It does not claim configured
all-role installation acceptance and does not exclude application-factory
cases from the independent supervisor gate.

The real child reported PID 1928456 cleaned with empty output. All seven exact
fixture roots were independently checked absent:

- `/tmp/quire-p7-prepared-Ccb8u7`
- `/tmp/quire-p7-prepared-6UzPxC`
- `/tmp/quire-p7-prepared-TEqvyE`
- `/tmp/quire-p7-prepared-kGkBw2`
- `/tmp/quire-p7-prepared-HdXZ3E`
- `/tmp/quire-p7-prepared-Ti6Ch9`
- `/tmp/quire-p7-prepared-OdpFm7`
