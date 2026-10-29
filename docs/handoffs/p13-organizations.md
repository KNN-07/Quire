# Organizations settings: FINAL

October 28, 2026.

## Delivered

`/settings/organizations` is a real account settings consumer. The existing
Profile, Sign-in & SSO, Editor, AI assistant, Git & integrations, Notifications,
and Billing tabs remain in the shared shell. The implementation uses the
existing settings layout, fields, buttons, tokens, and light/dark themes; the
original settings design is documented in `docs/discovery/design.md`
(`16-settings` and `05-billing`).

Owned source:

- `apps/web/src/features/account/settings.tsx`: tab and consumer integration.
- `apps/web/src/features/account/organizations/index.tsx`: paginated native
  organization list, selection, empty/loading/error states, and creation.
- `apps/web/src/features/account/organizations/organization.tsx`: native detail,
  authoritative access, existing-account admission, membership roles/licensing
  and removal, current policy editing, and refresh after mutations/conflicts.
- `apps/web/src/features/account/organizations/reports.tsx`: native interval
  metrics, paginated audit history, and audit export result/download.
- `apps/web/src/features/account/organizations/organizations.css`: scoped
  organization layout using the existing settings tokens.
- `tests/ui-product/account/organizations/{browser.test.ts,access.test.ts,tsconfig.json}`.

Creation uses the existing authenticated organization-create contract. Admission
adds an active verified account immediately by its email; it is explicitly not
a pending invitation or an email-invitation operation. Member CSV is the native
download endpoint. Policy editing exposes every current PolicySchema field,
including nullable numeric limits, without inventing effective project benefits.

Organization membership and installation operator authority are separate:
`endpoints.organizationAccess` returns `{ role, operator }`. The consumer reads
that endpoint and labels both dimensions. It does not scan membership to infer
authority, and an ordinary member does not trigger a denied directory probe.
Operators retain administrator controls when their membership is member or
manager. Managers without operator authority manage ordinary members only;
ordinary members receive read-only policy and no directory controls.

Mutations submit the native organization or membership version. Service errors
remain visible, including account admission failures, version conflicts, and
last-administrator protection. Refresh retrieves current access and resource
state; stale writes are not presented as successes.

## Terminal verification

All commands used repository-local Bun 1.4.4. Both browser cases use
`connectionApplication`, native HTTP services, real authenticated browser
contexts, and the actual application bundle. There are no successful-response
mocks or fixed sleeps. Response subscriptions precede mutations.

| Check | Exact result |
| --- | --- |
| Original scoped strict types and type-aware deny-warning lint | PASS, exit 0, `mon_8RYXH5HDZQ37TAQ8` / `bash_4`. |
| Native organization workflow | PASS, 1 case, 31 assertions, 0 failures, 51.96 seconds; exit 0, `mon_SN7FDFYZMQMSTBMV` / `bash_8`. |
| Changed access-consumer strict types and touched-test/source lint | PASS, exit 0, `mon_HZF1Y15PGBVR7EJ0` / `bash_12`; changed-file LSP diagnostics also clean. |
| Native operator/membership cross-role regression | PASS, 1 case, 21 assertions, 0 failures, 50.09 seconds; exit 0, `mon_4A3NW2BD4M15AV0D` / `bash_11`. |
| Parent-owned organizationAccess backend matrix | Parent supplied terminal PASS: 7 native cases, 26 assertions; member/manager/admin, operator without membership, operator+member, operator+manager, anonymous 401 and unrelated-account 403. Parent's scoped account strict types and touched-source type-aware lint also exited 0 under `mon_MSZGHD03YRJTENVH`. |

Commands:

```sh
./node_modules/.bin/bun node_modules/typescript/bin/tsc --noEmit \
  -p tests/ui-product/account/organizations/tsconfig.json

./node_modules/.bin/bun node_modules/oxlint/bin/oxlint \
  --type-aware --deny-warnings \
  apps/web/src/features/account/organizations \
  apps/web/src/features/account/settings.tsx \
  tests/ui-product/account/organizations

./node_modules/.bin/bun test \
  tests/ui-product/account/organizations/browser.test.ts \
  --reporter=junit \
  --reporter-outfile=docs/evidence/p13-organizations/native.xml

./node_modules/.bin/bun node_modules/oxlint/bin/oxlint \
  --type-aware --deny-warnings \
  apps/web/src/features/account/organizations/organization.tsx \
  tests/ui-product/account/organizations/access.test.ts \
  tests/ui-product/account/organizations/browser.test.ts

./node_modules/.bin/bun test \
  tests/ui-product/account/organizations/access.test.ts \
  --reporter=junit \
  --reporter-outfile=docs/evidence/p13-organizations/access.xml
```

The original browser receipt covers creation, direct verified-account admission,
native ACCOUNT_REQUIRED rejection, licensed-member updates, member CSV,
persisted policy changes, VERSION_CONFLICT and refresh, metrics, audit history,
audit export CSV, ordinary-member and manager restrictions, operator access
without membership, LAST_ADMIN rejection, and navigation back through
Notifications and Profile. It also records no page errors.

That accepted workflow predates the authoritative-access migration. Its stale
access-label locators were updated, but the unchanged workflow was not rerun.
Only the affected access case ran after migration: it proves a real policy write
by operator+member, continued administrator controls after membership changes to
manager, all role options for that operator, and ordinary-member access without
directory requests. It also records no page errors. The two XML files are
separate passing receipts, not a claim that a combined suite ran.

Earlier failures are resolved: the first lint attempt rejected FormData's
generic string conversion; the consumer now uses the existing typed value
helper. Two initial browser attempts failed on test locators: CSS-capitalized
innerText and exact wrapping-select labels. Raw access text and accessible
combobox role locators corrected those boundaries. Native responses were not
mocked or weakened. The parent subsequently identified the independent
operator/membership inference bug; the authoritative access read replaces it.

## Inspected captures

Every image below was opened and visually inspected. The shell, member forms,
policy controls, and report actions remain readable with no overlapping controls
or horizontal overflow. The long settings page scrolls naturally. Browser
assertions also verify document width does not exceed the viewport.

Accepted full workflow packet:

`docs/evidence/p13-organizations/a400a47a-d32e-4fd0-8de1-f66391beeeb6/`

- `organizations-1440-light.png`, `organizations-1440-dark.png`: 1440 x 5122.
- `organizations-390-light.png`, `organizations-390-dark.png`: 390 x 6493.

Final authoritative-access packet:

`docs/evidence/p13-organizations/access-0ec29a70-59b6-4e67-a4fc-2d972c42f237/`

- `access-1440-light.png`, `access-1440-dark.png`: 1440 x 3023.
- `access-390-light.png`, `access-390-dark.png`: 390 x 4053.

The final packet shows organization membership Manager and installation operator
Yes simultaneously, with policy and privileged-membership controls available.
These are Chromium viewport captures at 1440 x 900 and 390 x 844 before
full-page capture; mobile touch/DPR emulation and other browsers are not claimed.

## Exact cleanup

Awaited fixture disposal closed browser contexts, Chromium, adapters, application
runtime, and web/API services. Independent filesystem checks confirmed all four
owned fixture roots absent; `ss` showed no listeners on their exact web/API ports:

| Fixture root | Web / API ports | Result |
| --- | --- | --- |
| `/tmp/quire-ui-integrations-HVlN70` | 35885 / 41755 | Absent / no listeners |
| `/tmp/quire-ui-integrations-wAxvVe` | 39075 / 34851 | Absent / no listeners |
| `/tmp/quire-ui-integrations-jBSaSq` | 33835 / 36431 | Absent / no listeners |
| `/tmp/quire-ui-integrations-x83euG` | 33959 / 39031 | Absent / no listeners |

The successful tests additionally assert ENOENT after disposal. Only the two
exact empty failed-run evidence directories, `dba68642-dce7-4aa5-adea-693de5b545a1`
and `0e7e0061-8c8b-4318-98f0-238eb0394016`, were removed. Passing XML receipts
and both capture packets remain. No shared or parent-owned runtime was stopped.

## Backend boundaries and verification limits

- The missing authoritative access seam was supplied and verified by the parent;
  role/operator inference is no longer a remaining boundary.
- Membership output supplies account IDs, roles, licensing, and versions, not
  names or email addresses. The directory displays those IDs rather than
  fabricated identity data.
- Existing-account admission is supported. Pending organization invitations and
  their list/resend/accept lifecycle are not exposed by these governance
  contracts and are not invented here. Parent-owned project invitations are a
  separate workflow.
- Metrics are native counts for the selected UTC interval; the displayed storage
  value counts retained files created within that interval, not total storage.
  Audit export consumes the actual Operation status and succeeded CSV result.
- Paid-seat exhaustion and managed-member removal were not induced by these
  browser cases. Their native denials use the same displayed service-error path;
  no successful coverage of those scenarios is claimed.
- This child changed no router, account index/auth, notification consumer,
  backend/contracts, dependencies, or installation files. No commits or pushes
  were made. This handoff is the final file artifact.
