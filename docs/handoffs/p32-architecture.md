# P32 reported architecture

October 28, 2026. FINAL scoped reported-component rendering.

`admin/Architecture.tsx` no longer draws a fixed local SQLite/disk diagram
above an unrelated raw topology response. Its diagram and responsive list now
use the actual `adminOverview.topology` role/backend/state values. The API's
reported adapters are shown as application composition, not inferred network
links, replication or provider health. Missing coordination/ingress/worker/
identity/model topology is explicitly not invented.

The backend's existing `adapterTopology` reports API, database, blob and
repository adapter identities. This change does not expand those observations
or turn the configured state into a health probe. Existing tokens and
desktop-diagram/mobile-list styles are reused.

The new scoped tests distinguish two evidence layers:

- A component projection test supplies explicit PostgreSQL/S3/remote-Git DTO
  values and checks that rendering uses them rather than hard-coded local names.
  This is not execution against those services or a live scale browser proof.
- The real mounted native application is authenticated as operator, reads its
  actual overview response and compares the visible diagram/list against every
  reported component at 1440/390 in light/dark.

LSP reported no errors. Strict TypeScript, typed deny-warning lint and the
scoped tests passed under `mon_VEAKZ56XXYQB3J5N`, session `bash_393`,
completed exit 0. The sequential command used `&&` and `pipefail`.
Raw receipt: `docs/evidence/p32-architecture/verification.log`.
Two tests passed with 63 assertions in 46.37 seconds.

Parent opened all four 1440/390 light/dark captures in
`docs/evidence/p32-architecture/a03ca215-5386-4c7e-81ab-8c13145c9754/`.
The desktop API/adapter diagram and mobile list match the native response:
Bun 1.4.4, SQLite, local content-addressed disk and local Git object store.
Labels and states are readable without overlapping controls. A raw-pixel
light/dark crop confirms the API title/backend text is present in both images;
the repeated-image inline display initially omitted unchanged text.

The root `/tmp/quire-ui-integrations-WGIWkT` is independently absent, and
web/API ports 39433 and 44275 refuse connections. No unrelated service was
stopped. Scale values were tested as component inputs, not a second deployed
browser profile. No whole-product build, full D18/D19 visual parity or new
health/topology instrumentation is claimed.
