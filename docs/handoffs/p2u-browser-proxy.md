# Shared editor browser proxy - VERIFIED

Parent follow-up, October 27, 2026. The real browser now opens authenticated
realtime connections through the same-origin editor web server. This releases
the shared fixture blocker; individual panels still need their own real UI QA.

## Observed failure and correction

The original fixture hosted Vite middleware and its Node HTTP proxy inside
native Bun 1.3.14. One browser with one actual login opened the direct API
WebSocket, but the proxied connection timed out. The API observed and accepted
both upgrades. This isolated the failure to the proxy response path, not CSRF,
project permission or the persistent Yjs protocol.

`tests/ui-editor/shared/application.ts` now launches Vite in an owned Node
subprocess through `web-server.ts` and `web-server.mjs`; the API stays on Bun.
Both listeners still use OS-assigned loopback ports. The unused fixture HMR/WS
listener is disabled instead of competing for port 24678.
`scripts/dev.ts` also runs the Vite CLI under Node. README records Vite's actual
Node requirement (`^20.19.0 || >=22.12.0`); the test host uses Node 24.20.0.

The Node helper announces the actual bound origin. Its parent drains output
with standard stream readers, has a bounded startup deadline, and awaits
process/stream completion during fixture disposal. Application shutdown closes
the API transports before the frontend proxy is stopped. No direct-API bypass
was added to production browser transport or panel tests.

## Regression and receipts

`tests/ui-editor/shared/websocket.test.ts` uses actual Chromium, a real seeded
session, and both direct/proxied sockets. The same test failed before the
runtime correction and passed afterward:

- `bash_112`: direct opened; proxy upgrade deadline; exit 1.
- `bash_113`: both opened. Static checking then found stream-iteration types.
- `bash_114`: standard-reader implementation, both opened; browser test passed
  in 64.35 seconds and strict UI TypeScript passed. Lint found one shadowed test
  variable, subsequently renamed without changing behavior.
- `bash_115`: strict UI TypeScript and touched-file type-aware lint exit 0.

Commands:

```sh
QUIRE_TEST_CHROMIUM=/home/norman/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
  bun test tests/ui-editor/shared/websocket.test.ts
bun node_modules/typescript/bin/tsc --noEmit -p tests/ui-editor/tsconfig.json
bun node_modules/oxlint/bin/oxlint --type-aware --deny-warnings \
  tests/ui-editor/shared/application.ts tests/ui-editor/shared/web-server.ts \
  tests/ui-editor/shared/web-server.mjs tests/ui-editor/shared/websocket.test.ts scripts/dev.ts
```

The test's awaited disposables close Chromium contexts/browser, native API,
the Node frontend process, proxy sockets and unique data/cache roots.
No unrelated listener or user browser was used or stopped.
