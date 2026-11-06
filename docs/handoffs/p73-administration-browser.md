# P73 administration browser evidence

November 6, 2026. The lead drove an isolated composed application through
omowright using a task-owned Chromium profile. No existing installation,
user data or external support/collector service was used.

## Executed workflows

The seeded operator signed in through `/sign-in`. On `/admin/support`,
clicking **Generate diagnostics** created operation
`43fb657a-625f-469d-bffe-5888071ce10d`, which reached `succeeded`.
**Download output** was clicked. Reading its actual download endpoint returned
HTTP 200, `content-type: application/json`, and 2,747 bytes.
The payload was `quire-support-v1`, marked redacted, and contained actual
database/repository/tool/sandbox observations with a manifest of omissions.
It was JSON, not a ZIP; the artifact extension was corrected accordingly.

On `/settings/organizations`, the operator created `P73 Admin QA` using the
real form. `/admin/audit` then displayed its persisted `organization.created`
event. Entering that event filter, clicking **Apply filters**, then **Export
ZIP** produced the displayed `Audit export downloaded.` result.
Operation `14d9d354-189d-4fd6-abb5-9a0d24974648` returned HTTP 200,
`content-type: application/zip`, 276 bytes. `unzip -p` showed exactly the CSV
header and one matching organization-created row, with the fixture operator
and created organization identifiers.

Artifacts are under `docs/evidence/p73-admin-lead/`:

- `diagnostics.json`
- `audit.zip`
- `support-desktop.png`, `support-mobile.png`
- `audit-desktop.png`, `audit-mobile.png`

All four retained screenshots were opened. The actual desktop and 390px
mobile pages are populated and usable without horizontal overflow or
overlapping controls. Mobile uses the existing administration selector and
stacked data presentation.

## Setup findings and limits

The first application startup failed because the concurrently added billing
usage handler had not yet been included in the shared endpoint registry.
After registry integration, a fresh process started successfully. The first
read targeted nonexistent `/login`; the actual route is `/sign-in`.
A short organization-render observation timed out, but the subsequent page
inspection showed the successful creation and persisted audit entry.

An initial mobile support capture retained desktop emulation after navigation;
another was taken before page readiness. Both were replaced with a loaded
390px capture, checked against viewport width and `succeeded` text.
Neither discarded capture is acceptance evidence.

This closes the specific native support-download and audit-filter/export
journeys. It does not establish live SIEM delivery, external support delivery,
worker drain/remove, image build/admission, or all administration panels.
Those retain their independent receipts and configured prerequisites.

## Cleanup

The owned browser was closed. The application received SIGTERM and exited 0,
emitting adapter/runtime/web closure and `ADMIN_QA_CLEANED`.
The readiness and cleanup monitors exited 0.
The fixture directory, owned browser profile, disposable credential metadata,
and temporary application script were removed and absence checked.
The lead run root remains for later integrated checks.
