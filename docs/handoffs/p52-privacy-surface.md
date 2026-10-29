# P52 public privacy disclosure

October 28, 2026. FINAL bounded native-surface evidence; integrated production
validation remains with the active adapter work.

Expanded the existing `/privacy` copy in
`apps/web/src/features/marketing/index.tsx`, using the source inventory in
`docs/runbooks/privacy.md`. It now describes the sign-in cookie, browser
preferences and private draft retention, expiry versus removal, extension
networking, configured-provider boundaries, AI consent/logging, and the
difference between account metadata export and project backup.

The page explicitly says an installation-specific policy and processor list
are not published there. It adds no fake analytics switch, legal certification
or claim of reviewing a live deployment's providers.

## Surface and scope

The existing marketing shell, typography, prose width, document scrolling and
contact navigation are retained. Information priority is default data handling,
browser retention, then external processing and export/deletion. The contact
link remains the page action. No new CSS, components, dependencies, performance
instrumentation or server-side policy configuration were introduced.

This is a copy-only change, so no test pins the prose. The owned capture script
checks only structural/native behavior: one main heading, no horizontal
overflow or page errors, actual network destinations, and observed cookie and
local/session-storage state in fresh unauthenticated browser contexts.

## Executed evidence

`docs/evidence/p52-privacy-surface/capture.ts` runs the actual application with
owned ephemeral web/API origins and the installed browser. It captures 1440
and 390 widths in light/dark. No mocked marketing route or port 5173 is used.

Before:
`docs/evidence/p52-privacy-surface/before-fc4ad620-4a50-4369-9978-43e94d777614/`.
`before.log` records `P52_BEFORE_EXIT=0` under
`mon_M0QBG2DD5MXHD3QJ` / `bash_437`.
Parent opened the mobile-light and desktop-dark baseline before editing.

Final:
`docs/evidence/p52-privacy-surface/after-acd27938-b49f-445e-9231-3fceeda38afa/`.
All four final full-page screenshots were opened and inspected. Headings,
paragraphs and navigation remain legible, with no overlap, clipped text or
horizontal overflow. The final copy distinguishes a billing selection's
24-hour expiry from removal when next read.

Each capture's JSON retains actual requested URLs, observed cookies/storage,
page errors and layout measurements. Fresh unauthenticated visits to this
default-fixture route observed zero cookies, empty local/session storage,
zero external-origin requests and no page errors. This is not evidence for
every authenticated workflow, a customized proxy, a user-run script, live
providers or an arbitrary deployment.

`final.log` retains UTC start/end, matching pre/post source/capture-script
hashes, native observations and `P52_FINAL_EXIT=0`, from 17:30:00Z through
17:30:49Z. Monitor `mon_F0B8MAQ8TF15XV9E` / `bash_439` completed exit 0.
The executed chain used repository-local binaries:

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
./node_modules/.bin/oxlint --type-aware --deny-warnings \
  apps/web/src/features/marketing/index.tsx \
  docs/evidence/p52-privacy-surface/capture.ts
P52_PHASE=after bun docs/evidence/p52-privacy-surface/capture.ts
```

The preceding `after.log` additionally records the frontend draft guard clean
and a successful first expanded-copy capture. Those captures remain historical
after the retention sentence correction.

LSP initially returned no diagnostics after the expanded copy, but fresh
requests after the final sentence correction timed out. No fresh LSP success
is claimed. Type-aware lint and actual native rendering passed; final root
TypeScript and production bundles belong to the pending combined validation,
not a repeated check against unfinished sibling edits.

## Exact cleanup

All application/browser closures were awaited. Parent independently verified
these three roots absent:

- `/tmp/quire-ui-integrations-7c5uXX`
- `/tmp/quire-ui-integrations-qABKzr`
- `/tmp/quire-ui-integrations-bONv1N`

Their six web/API ports 45757, 44541, 44679, 35181, 41305 and 41195 refuse
connections. Screenshots and raw receipts remain in the evidence packet.
No unrelated service or original input was touched.
