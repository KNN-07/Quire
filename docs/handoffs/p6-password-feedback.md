# P6 password feedback

Owner: `st_01a17e24`. October 27, 2026. Status: FINAL.

Recovery: original browser/static monitor sessions were recovered as completed
with exit code 0, without rerunning either gate. See
`docs/evidence/p6-password-feedback/recovery.md` for exact handles, durable log
hashes, cleanup reconciliation, and the distinction from unrelated missing or
in-progress identity work. DAG completion is not the acceptance evidence.

## Result

Live, accessible, length-only feedback is present on actual sign-up and reset
password creation fields. `auth.tsx` changes only by an import and two field
substitutions. `PasswordStrength.tsx` uses the existing Field hint, brand/border
tokens, four decorative segments, and an associated polite atomic status region.
It keeps only length in React state; the password remains masked and uncontrolled.

The bounded assessment is explicit:

| Input length | Filled segments | Guidance |
| --- | --- | --- |
| 0 | 0 | Use at least 12 characters |
| 1-11 | 1 | Below the 12-character minimum |
| 12-15 | 2 | Minimum length met |
| 16-23 | 3 | Long password |
| 24-1024 | 4 | Very long password |

Every state explains that the feedback measures length, not security. It adds no
composition rule, rejection, strength estimator, crack-time claim, network check,
dependency, backend change, or policy change. Existing required, 12-character
minimum, 1024-character maximum, autocomplete, availability gates, confirmation,
and single-use token submission are preserved. Sign-in stays a current-password
field without creation guidance.

## Reference and source provenance

Read `docs/discovery/design.md`, the exact embedded templates in
`docs/discovery/design-source/23-reset-password.html:388` and
`docs/discovery/design-source/16-settings.html:388`, actual auth fields, Field,
contract schemas, and credential handlers before implementation.

The reset reference has four decorative segments, masked new/confirmation
fields, and an illustrative 10-character caption. The actual server contract
requires 12-1024, so that remains authoritative. Settings has disabled Set
password and no actual enabled creation field; no settings form was invented.

Before/after hashes are retained in
`docs/evidence/p6-password-feedback/provenance.md` and
`cleanup-provenance.log`. The original board and both exact design-source files
retain identical hashes. No files belonging to FINAL `p3-connections.md` were
edited. Backend/shared contracts, root dependencies, shared CSS and shared UI
were not edited by this task.

## Verification

Project-local Bun **1.4.4**:

```sh
QUIRE_TEST_CHROMIUM=/home/norman/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
  ./node_modules/.bin/bun test tests/ui-product/account/strength
./node_modules/.bin/tsc --noEmit -p tests/ui-product/account/strength/tsconfig.json
./node_modules/.bin/oxlint --type-aware \
  --tsconfig tests/ui-product/account/strength/tsconfig.json \
  apps/web/src/features/account/auth.tsx \
  apps/web/src/features/account/PasswordStrength.tsx \
  tests/ui-product/account/strength/feedback.test.ts
```

Authoritative retained receipts:

- `docs/evidence/p6-password-feedback/acceptance-verified.log`: **1 pass, 0 fail,
  113 assertions, 49.95 seconds**, completed exit code **0**.
- `docs/evidence/p6-password-feedback/statics-verified.log`:
  `STATIC_EXITS types=0 lint=0`, completed exit code **0**.
- Language-server diagnostics: no errors on `auth.tsx`,
  `PasswordStrength.tsx`, or the focused test. Owned auth diff check passes.

The focused browser test drives the real application, identity service and
same-origin local Vite proxy using the existing `connectionApplication` fixture.
No endpoint is mocked, success is not fabricated, and no external provider or
real account is operated. It verifies:

- Both fields at lengths 0, 1, 11, 12, 16, 24, and 1024, including clearing.
- Required/min/max attributes, native validity, masking and new-password
  autocomplete, four bounded segments and associated accessible descriptions.
- A live-region MutationObserver registered before keyboard typing, with a
  bounded failure timeout; polite/atomic semantics and keyboard Tab from new
  password to confirmation. No sleeps or polling assertions.
- Typing alone causes no POST requests.
- Real registration with a repeated-character 12-character password, local mail
  verification, then real successful login with that exact password. This proves
  no additional composition restriction was imposed.
- Real reset request and locally delivered token; confirmation mismatch causes
  no reset-confirm POST; matching minimum-length input succeeds.
- Reset token replay returns **400**, old password login returns **401**, and
  new password login returns **200**.

Earlier diagnostic logs are retained, but are not passing receipts:
`acceptance.log` caught unreliable Playwright request-body introspection;
`acceptance-final.log` caught an incorrect test assumption of 422 instead of the
existing 400 token contract. The final test proves submitted passwords through
real verification/login instead. Initial lint findings in `statics.log` were
corrected; no production policy or failing existing test was altered.

## Visual evidence

All files below are in `docs/evidence/p6-password-feedback/` and were visually
inspected. Each form has 1440px desktop and 390px mobile captures in light/dark:

- `signup-1440-light.png`, `signup-1440-dark.png`
- `signup-390-light.png`, `signup-390-dark.png`
- `reset-1440-light.png`, `reset-1440-dark.png`
- `reset-390-light.png`, `reset-390-dark.png`
- `reset-complete.png`: actual successful reset completion.

The compact indicator stays within the existing field, readable in both themes,
without overlap or horizontal page overflow. Mobile hint copy wraps within the
card. Existing provider-configuration notices make the signup page long; that
pre-existing provider presentation is outside this task and remains unchanged.
Accessibility verification covers browser semantics, associated descriptions,
live DOM updates and keyboard behavior; no spoken screen-reader audio was tested.

## Exact owned cleanup

Each run used a unique local SQLite/data directory with disposable adapters,
runtime/API listener, Vite child, browser, and browser context. The fixture closes
those exact owned resources through AsyncDisposableStack/await using/finally,
including failed test attempts. All three directories were independently checked
absent afterward:

- `/tmp/quire-ui-integrations-TInEur`
- `/tmp/quire-ui-integrations-FUO3VH`
- `/tmp/quire-ui-integrations-lRYrTX` (passing run)

The passing run logged adapter/runtime/web closure and
`PASSWORD_FEEDBACK_CLEANED`; its web origin `http://127.0.0.1:36587` was checked
closed afterward with `ECONNREFUSED`. No broad process kill, shared-state cleanup,
global install, commit, or real password operation occurred.

## Owned files

- `apps/web/src/features/account/auth.tsx`
- `apps/web/src/features/account/PasswordStrength.tsx`
- `tests/ui-product/account/strength/feedback.test.ts`
- `tests/ui-product/account/strength/tsconfig.json`
- `docs/evidence/p6-password-feedback/**`
- This handoff.

No requested behavior is deferred. Existing unchanged passing tests stand; the
full unrelated repository suite was not rerun.
