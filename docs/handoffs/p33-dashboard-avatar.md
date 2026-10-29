# P33 authenticated dashboard avatar

October 28, 2026. FINAL scoped authenticated dashboard avatar.

The dashboard account action now uses the actual `/api/me` user. It shows
initials from that name when no photo exists, or the authenticated `/api/me/avatar`
bytes when a saved photo exists. The endpoint is already private/no-store.
The action retains its Account settings accessible name and navigates to the
existing profile page. Account-read errors remain visible with retry; an image
failure shows a notice and the actual account initials.

Only `ProjectsPage.tsx`, its scoped avatar rule in `projects.css`, and
`tests/ui-product/projects/avatar/` changed. Workspace filtering and the active
custom-environment creation dialog are not part of this change.

The native browser scenario uses two independently authenticated sessions,
different account initials, a real PNG upload with the existing version/CSRF
contract, reload and successful image decoding, isolation from the second
account, four desktop/mobile theme captures, and profile navigation.

Source hashes are printed before execution in
`docs/evidence/p33-dashboard-avatar/verification.log`. LSP is clean and scoped
strict TypeScript plus typed deny-warning lint passed (`P33_STATIC_EXIT=0`).
The browser passed under `mon_SK4QDJT8NS0856F2`, session `bash_394`:
one test, 16 assertions, 63.09 seconds, explicit `P33_BROWSER_EXIT=0` and
completed process exit 0. It verified KN/MT initials in two independent sessions,
real PNG upload/reload and image decoding, the second account's absent photo
and HTTP 404, responsive bounds, and actual profile navigation.

Parent opened all four 1440/390 light/dark screenshots in
`docs/evidence/p33-dashboard-avatar/79ddea65-13bc-4f39-af4b-3db5b9f288f7/`.
The uploaded orange/navy fixture image is visible in the account action and
fits alongside dashboard search and workspace controls without overlap.
It is a deliberately generated upload fixture, not a claimed personal photo.

The root `/tmp/quire-ui-integrations-yLSjsf` is independently absent and owned
web/API ports 35033 and 35303 refuse connections. No unrelated service was
stopped. No whole-dashboard, complete D07, cross-browser or whole-product
build acceptance is claimed.
