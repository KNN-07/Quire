# P34 persisted onboarding: FINAL

October 28, 2026. Owner: `st_01a1823e`. The elected D14 flow is complete:
real account creation, email verification, sign-in, persisted starting choices,
retry-safe blank/template creation, and resumable real ZIP import into a
writable editor. Selected billing plans also survive new-account signup and
cross-tab verification without requiring project creation or initiating payment.

## Delivered behavior

Anonymous progress is a screen hint, not account or verification evidence.
Registration advances the URL durably; verification uses the existing one-time
token endpoint and then requires sign-in. No password, email address,
verification/reset token or credential is saved as onboarding progress.

Authenticated state is scoped to the actor, schema-versioned and CAS-versioned.
It retains writing kind, project name, blank/template/import choice and editor
view. Queued writes carry an explicit actor ID, so a changed login cannot apply
the previous actor's draft. Responses are private/no-store. Native tests cover
anonymous/CSRF rejection, actor isolation, stale/concurrent writes, exact replay
and restart.

Blank/template start freezes a server-generated creation key before calling
the existing project writer. Completion consumes its actor/key/body-bound
durable HTTP receipt. The real project ID is retained before preference or
navigation work. Dropping a real create response, reloading, retrying and then
failing a preference request still produced exactly one project.

The template case publishes and approves an actual public template through
native routes. Its resulting project preserves all source paths and blob
digests, opens the writable visual editor and reloads without duplication.

## Import contract and recovery

The existing importer is used, not a duplicate UI or project writer.
`ProjectsPage` elects the bridge only for
`/projects?new=import&onboarding=1`. Its optional dialog contract is:

```ts
type OnboardingImportContinuation = {
  draft: OnboardingImportDraft;
  locked: boolean;
  pending: boolean;
  error: string;
  operation: Operation | null;
  requiredFile: OnboardingImportFile | null;
  saveDraft(draft: OnboardingImportDraft): Promise<void>;
  submit(body?: FormData | OnboardingImportRequest): Promise<Operation>;
};
```

The draft retains mode/name/workspace, repository URL/branch/saved connection
ID, and existing main-path/engine/environment selection fields. Credential
URLs are rejected rather than persisted. Actual file bytes are never browser
progress.

Before upload or dispatch, the identity transaction freezes the draft, distinct
server-generated upload/import keys, and the ZIP filename/MIME/size/SHA-256.
The bridge uses the existing staged-upload endpoint. A lost upload response is
recovered from its actor/route/key receipt; the real upload ID then becomes an
immutable JSON import source. Reselecting the identical file is required only
if staging never committed.

Import recovery reads the canonical import receipt and the actor/key operation
row. It retains the actual operation identity instead of accepting a
client-supplied success or project ID. Interrupted source publication replays
the same request/key through the existing `importCreate:source` recovery.
The native test proves that case even after the staged upload expires, without
rereading the expired source or creating another project.

Mounted acceptance independently dropped real successful upload and import
responses. Reload recovered the upload without a selected `File`, then the
actual operation and project: **one upload request, one import request, one
project**. The existing operation action opened a writable editor; editor
reload and returning to onboarding retained completion.

The existing 24-hour staged-upload expiry remains authoritative if no source
or operation has committed. Keys are never silently rotated to bypass it.
The bounded browser proof uses ZIP import; live hosted Git providers are not
claimed by these receipts.

## Billing and provider continuation

Pricing's exact contract remains
`/settings/billing?plan=<plan.id>&period=<month|year>`, carried in the existing
sign-in `returnTo`. Signup reuses the same-origin validator. Only canonical
public plan/period data is retained as a versioned, 24-hour browser hint so a
verification link opened in another tab can continue the selection.

The real signup case verifies email, signs in and reaches the selected annual
catalog plan with **zero projects, zero organizations and zero quote/checkout
requests**. Billing still validates the selection against its current catalog
and reports that the new user has no organization billing account. An
authenticated starting-point action reaches billing while preserving the
writing-kind draft. No organization, personal subscription or payment is
invented.

With explicit parent approval, `services/adapters/identity/state.ts:returnPath`
admits exactly the raw canonical `/sign-up?step=start` destination. Existing
relative-path, backslash, control-character, origin and fragment protections,
and the projects/settings allowlist, remain. Focused tests deny foreign and
protocol-relative destinations, other steps, fragments, extra/duplicate query
parameters and noncanonical spellings. Native LDAP returns 200; the actual
controlled OIDC start/callback return 302/303 and resume distinct actors'
onboarding after reload.

## Registration, ownership and preservation

`services/accounts/identity/index.ts` appends migration `013-a-onboarding` and
registers the onboarding handlers. The migration adds the independent
`identity_onboarding` table with SQLite/PostgreSQL variants. Accepted account
data and earlier migration receipts remain unchanged.

The contracts add only onboarding DTOs/routes in `accounts.ts` and
`routes-accounts.ts`. Policy and Preferences DTOs were not changed by this lane.
The account implementation is in `auth.tsx`, `starting-point.tsx`,
`onboarding-progress.ts`, `onboarding-return.ts`, `onboarding-import.ts` and
`OnboardingImportDialog.tsx`.

Parent-approved shared edits are the optional hooks in `NewProjectDialog.tsx`
and `ProjectsPage.tsx`, plus the exact OAuth exception above. Normal creation,
P27 admission checks, P33 avatar/workspace behavior and the P36 operation
consumer are preserved. No core writer, import authorization, signing
authority, editor source, installation code, original input or global matrix
was edited. Pre-existing workspace changes were preserved. No commits were made.

## Accepted verification

Packet: `docs/evidence/p34-onboarding/`.

| Receipt | Result |
| --- | --- |
| `2026-10-28T13-16-28.267Z-integrated.log` | 18 tests, 403 assertions, 94.53 s, exit 0 |
| `2026-10-28T13-16-28.285Z-integrated-types.log` | Strict TypeScript, exit 0 |
| `2026-10-28T13-16-41.393Z-integrated-lint.log` | Typed deny-warning lint, exit 0 |
| `2026-10-28T14-06-21.115Z-footer-after.log` | Focused real-operation footer/name case: 1 test, 21 assertions, 51.33 s, exit 0 |
| `2026-10-28T14-06-21.129Z-presentation-types.log` | Final scoped strict TypeScript, exit 0 |
| `2026-10-28T14-06-33.635Z-presentation-lint.log` | Final scoped typed deny-warning lint, exit 0 |
| `2026-10-28T14-06-35.751Z-presentation-diff.log` | Final affected-path diff check, exit 0 |

Each receipt retains the raw command, cwd, Bun version, output, exit and
contemporaneous START/END source hashes. All 28 integrated hashes and all
29 focused-run hashes remained unchanged during their respective runs.

The integrated command was:

```sh
./node_modules/.bin/bun test tests/accounts/onboarding \
  tests/ui-product/account/onboarding \
  tests/adapters/identity/onboarding-return.test.ts \
  tests/accounts/identity/lifecycle.test.ts \
  tests/accounts/identity/composition.test.ts tests/accounts/migrations.test.ts
```

After the two presentation-only corrections, only
`tests/ui-product/account/onboarding/import-layout.test.ts` and scoped strict
checks were run. The accepted integrated suite and parent's separately
reported admission 1-test/80-assertion pass were not replayed.

Earlier failures remain in the packet: initial type/label issues, a test's
incorrect file-store query, the integration fixture's missing WebSocket
lifecycle forwarding, the removed LDAP image, the original OIDC return denial
and the measured mobile footer clipping. They were corrected rather than
suppressed. Editor acceptance uses the existing full native WebSocket fixture,
not a shell merely displaying source while still connecting.

## Pixels, final hashes and cleanup

The full journey produced 64 captures at 1440x900 and 390x844 in light/dark.
Eight inspected post-fix captures supersede the recovered-operation and
completed-import-name images:
`import-operation-footer-{1440,390}-{light,dark}.png` and
`import-complete-name-{1440,390}-{light,dark}.png`.

The mobile footer previously ended at 862px beyond the 828px dialog. It now
ends at 736.25px inside the 753.25px dialog. Completed onboarding displays the
persisted import name, not the earlier setup name. These final source changes
are one presentation line each in the following first two files; persistence,
authorization and normal admission paths did not change.

```text
7d7e211c92cbdb65024eabaf55b985c8cdb28f08cb5b7b98afd4c8f758e1ec67  apps/web/src/features/account/starting-point.tsx
305ae5ee669c2c4475e96dd3268ba3b0ce8f42f9ed56214a6ce012c5bd3ad02a  apps/web/src/features/projects/NewProjectDialog.tsx
b79a0c6b4a973f1c4b134eceee90b50c5c61bbedf1d6c714d10368b8cfb4c713  apps/web/src/features/projects/ProjectsPage.tsx
5f2277f343a4a2d57b8f19b532f0739a76e8a5e2f801b4a9a9d54c14ad6e845f  services/adapters/identity/state.ts
```

`inspection.md` records the inspected pixels and retained failures.
`cleanup.md` lists exact owned roots, process cleanup, container and image
removal. The final focused root `/tmp/quire-ui-editor-To3g0m` was independently
confirmed absent. All owned test runs have settled; the temporary LDAP image
was removed only after its exact ID and absence of users were verified. No
shared installation resource was removed.

These are controlled local-mail, LDAP/OIDC and billing fixtures, not claims of
live-mail delivery, live hosted checkout or scale deployment acceptance.
The unmodified mobile editor's last status line is partly cropped at 844px;
its writable document and navigation are visible, and editor source was
outside this lane. Parent owns any root-validation refresh against the final
hashes above. No required onboarding, import or billing continuation remains
deferred.
