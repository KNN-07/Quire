# P74 publisher scenarios recorded before implementation

HTTP acceptance uses actual Bun HTTP listeners and an explicitly admitted owned
publisher protocol fixture, never private destination endpoints.

1. Operator PUT /api/admin/providers/publisher with If-Match "0", policy,
   baseUrl, and publisherContract containing version 1, manual mode,
   credentialTestPath api/me, authentication bearer. Expect 200, typed
   round-trip, no operator secret required, three ready action capabilities.
2. GET provider configuration preserves that typed contract; a subsequent PUT
   omitting publisherContract retains it. Legacy OAuth model JSON remains
   usable and unchanged. Conflicting typed/model mappings and invalid paths
   fail without changing the stored version.
3. POST /api/connections/publisher/credentials with label and accessToken
   verifies GET api/me using Bearer authorization before grant creation.
   Invalid token, missing CSRF, wrong enrollment mode, and unauthenticated
   requests cannot create a grant. Configuration changes during verification
   prevent grant creation. Responses/list contain no submitted token.
4. OAuth start for bearer configuration fails explicitly. Existing OAuth start,
   callback, test and remote disconnect still work.
5. Per-action flags disable submit while prepare/status remain ready. Provider
   DTO and adapter port agree; action dispatch rejects before provider traffic.
   Publication rechecks the action capability and configuration fence.
6. Manual submit still needs an explicit provider receipt and a ready grant.
   Manual status returns durable local state without destination traffic.
   Existing direct preparation, submit replay and status tests remain passing.
7. DELETE bearer connection forgets locally, disables encrypted credentials,
   and performs no remote revocation request. Other actors cannot test/delete it.

Browser acceptance uses the actual account route /settings/git and aggregate
application. At widths 1440 and 390, show publisher requirements when absent,
then configured bearer enrollment. Click Connect Publisher, fill a label and
masked token, save, observe the real credentials response and cleared input,
test the saved grant, confirm wording explicitly says local forgetting and
upstream validity, remove it, observe disabled grant and no remote revocation.
Retain full-page screenshots and check horizontal overflow and page errors.
Also exercise the configured OAuth Connect Publisher redirect/callback.

Commands to run after implementation:

```sh
./node_modules/.bin/bun test --timeout 240000 ./tests/adapters/shared ./tests/adapters/publisher
./node_modules/.bin/bun test --timeout 180000 ./tests/ui-integrations/publisher.test.ts
./node_modules/.bin/bun run typecheck
./node_modules/.bin/bun run lint
```

Each command exports the unit's RUN_TMP, TMPDIR, XDG_CACHE_HOME,
BUN_RUNTIME_TRANSPILER_CACHE_PATH and BUN_INSTALL_CACHE_DIR. Runtime listeners,
browsers and temporary fixture data must be disposed by their fixtures.
