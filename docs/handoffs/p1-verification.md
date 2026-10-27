# Independent P1 verification

Date: October 27, 2026. Verifier: `st_01a17ae2`. Native execution: Bun
**1.3.14**, not the eval runtime. Checked shared working tree based on
`48b7caec2a3624551587c38e7a5d31058ad0e080`; P1 modules and integration were
uncommitted. This is evidence for that working tree, not a clean-commit receipt
or full-product/P4 acceptance.

**Result: required commands and the requested native workflow PASS; P1 has
unresolved diagnostic correctness and native administration UI gaps. Do not
interpret the green suite as unconditional P1 acceptance.**

Only this handoff and `docs/evidence/p1-verify/**` were authored. Production,
contracts, package configuration, original inputs and discovery were not edited.
No commit, push, nested agent or permission bypass was used.

## Required command receipts

Executed once from the repository root with an owned `mktemp` root,
`TMPDIR=/tmp/quire-p1-verify.jRzgIb` and
`BUN_INSTALL_CACHE_DIR=/tmp/quire-p1-verify.jRzgIb/cache`.
Raw output is retained under `docs/evidence/p1-verify/`.

| Command | Result | Evidence |
| --- | --- | --- |
| `bun run typecheck` | PASS, exit 0 | `typecheck.log`: `$ tsc --noEmit` |
| `bun run lint` | PASS, exit 0 | `lint.log`: `$ oxlint --type-aware --deny-warnings` |
| `bun test tests/contract tests/core tests/accounts tests/compiler tests/integration` | PASS, 331 pass, 0 fail, 1,025 assertions, 83 files, 293.51 seconds | `tests.log` |
| `bun run build` | PASS, exit 0; 200 web modules and 258 server modules | `build.log` |
| `bun docs/evidence/p1-verify/runtime.ts` | PASS, exit 0; independent HTTP/WebSocket, actual PDF text and browser proof | `runtime.log`, retained executable `runtime.ts` |

Build emitted Vite's existing larger-than-500-kB chunk warning; the JavaScript
entry was 530.73 kB / 147.13 kB gzip. This was not suppressed.
The automated runner `bash_3` completed with exit 0. The original build-log
watch reached its deadline before the full test/build chain finished; the
actual runner was not killed, and its completion was consumed without rerunning
any check. The later runtime runner `bash_6` and its completion monitor both
completed with exit 0.

Exact suite summary:

```text
331 pass
0 fail
1025 expect() calls
Ran 331 tests across 83 files. [293.51s]
```

The run includes real Git CLI clone/push/staged commits and recovery, actual
compiler engines/bibliographies/confinement/worker leases, durable collaboration
and revocation, identity, governance and default application assembly. These are
executed tests, not imported producer pass counts. They do not prove every
browser control or an unavailable external integration.

## Independent live workflow

The retained probe assembles the actual default `createApplication`, seeds real
SQLite/blob/Git data with a fresh random password, and serves production assets
and API on **127.0.0.1:34205**, an ephemeral port. It does not mock endpoints.
All requests use the real Origin, session cookie and CSRF token.

| Check | Observed result |
| --- | --- |
| Login | PASS: owner, Viewer and operator HTTP logins each returned 200 and a session cookie; `/api/me` supplied the live CSRF token. |
| Create | PASS: HTTP example-project creation returned 200, project `8fe6b557-de16-4653-943d-edd379b74956`, with actual main source and pdfLaTeX settings. |
| Edit | PASS: WebSocket source synchronization returned actual Yjs state; inserting `Independent P1 persisted marker` before `\end{document}` received durable client-sequence acknowledgement, revision 2. |
| Reopen | PASS: after closing and recreating the full application against the same data, authenticated HTTP source download still contained the edited marker. |
| Viewer source write | PASS: real Viewer `alex@quire.local` received `403 FORBIDDEN`, `Role viewer cannot files.write`, on seeded-project file creation. |
| Viewer compile | PASS: the same real Viewer received `403 FORBIDDEN`, `Role viewer cannot compile`. |
| Native operator read | PASS: real operator project discovery returned 200. |
| Compile | PASS: revision-2 snapshot admitted with 202; actual isolated native job `4ba3df11-0f54-4e03-8884-1eedfa931b3b` finished `succeeded`, `failureCode: null`. |
| Download | PASS: downloaded artifact began `%PDF-`; the recomputed SHA-256 matched the published artifact. |
| Artifact content | PASS: actual `pdftotext - -` exited 0 and extracted `Hello, Quire! Independent P1 persisted marker`. |

Retained PDF: `docs/evidence/p1-verify/edited-source.pdf`, **43,884 bytes**,
SHA-256
`87fac024a980aa7a77f2bfeb8afb44f52b99c8092a9ef2fe0ca094086d209527`.
The raw native log reports pdfTeX-1.40.28, one page, and service exit
`status=0/SUCCESS`. The independent probe verifies edited text inside the
artifact rather than accepting PDF magic or a producer's hash alone.

## Desktop and mobile browser evidence

PASS: actual Playwright Chromium, actual built React router and native API,
at **1440x900** and **390x844**, DPR 1; mobile context enables touch/mobile.
Both contexts performed password login through the UI and displayed the newly
persisted project alongside the seeded paper.

All eight screenshots were opened and visually inspected:

- `auth-1440.png`, `auth-390.png`
- `projects-1440.png`, `projects-390.png`
- `settings-1440.png`, `settings-390.png`
- `admin-1440.png`, `admin-390.png`

Auth, projects and profile settings are nonblank, have readable labels and
reachable form content, and reflow without overlapping fields. Phone projects
are cards, not a clipped desktop table. Phone auth/settings require document
scrolling; full-page screenshots show the complete forms. Projects and settings
also passed explicit horizontal-overflow assertions at both widths. Neither
context emitted an uncaught page error.

Admin screenshots prove an honest **unavailable state**, not functioning admin
controls. They are a PASS for truthful error rendering and a FAIL for native
administration usability, detailed below. This probe did not claim dark-theme,
all-dialog, keyboard-accessibility, pixel-diff or full P4 browser acceptance.

## Unresolved P1 findings

### 1. Native administration controls are unreachable behind a P2 overview

**FAIL: P1V native administration workflow usability.**
`apps/web/src/features/admin/index.tsx:46` requests `adminOverview` for every
section, and its render gate at line 77 blocks all section controls without it.
The independent real operator request to `/api/admin/overview` returned:

```text
501 NOT_IMPLEMENTED
GET /api/admin/overview is not registered
```

In the same runtime, operator `/api/admin/projects` returned 200. Both browser
widths display "Administration unavailable". Thus native user/project,
governance, audit and template handlers being registered does not make their
P1 administration screens usable. The integration handoff documents this
dependency, but assigning overview to O/P2 does not satisfy P1V's requirement
that local operation routes be useful before external configuration.
Lead must explicitly resolve the phase dependency or acceptance boundary;
this verifier did not fabricate overview data or remove the authorization gate.

### 2. Successful compilation reports PDF timestamps as errors

**FAIL: C13 diagnostic classification correctness.**
`services/compiler/diagnostics.ts:22-24` treats any `text:digits:` pattern as a
located source error. In the successful native job, raw `pdfinfo` output has:

```text
CreationDate:    Tue Oct 27 01:13:37 2026 UTC
ModDate:         Tue Oct 27 01:13:37 2026 UTC
```

The actual `compileGet` response contains two error diagnostics with
`fileId: null`, `line: 13`, `message: "37 2026 UTC"`, and raw spans
3768-3813 and 3814-3859. These are metadata timestamps, not source errors.
The PDF genuinely succeeds and contains edited source; that does not excuse
the false error list. Full raw output and returned diagnostic objects are in
`runtime.log`. No production fix was attempted within read-only scope.

### Residual durability limitation, not newly fault-injected here

The base/catalog handoffs disclose a crash window between aggregate completion
and generic HTTP idempotency receipt persistence. Direct reading confirms
`services/core/base/http.ts:41-46` awaits `work()` before a separate receipt
transaction. Ordinary restart/replay tests pass; atomic replay after a crash
in that exact gap is **not verified**. This is distinct from the durable
source/Yjs acknowledgement and named-Git recovery paths that did run.
Do not promote this run to an exactly-once crash guarantee.

## Explicit remaining phase boundaries

The independently executed registry probe found **245** entries, **175** not
returning 501 under its probe, and exactly **70** remaining 501 contracts.
The complete names appear in `tests.log` as `P1_REMAINING_501`; the assertion
against the explicit P2 set passed. "Not returning 501" means registered surface,
not proof that every business flow is complete.

External federation/SCIM, configured billing, imports/provider connections/DOI,
reviewed AI, operation reads, overview/worker/environment/provider
administration, backup/update/support/SIEM and deployment remain P2 work.
The editor route explicitly says "Editor workspace unavailable"; editing in
this verification used the real protocol, not a completed source/PDF editor UI.
Docker/R/knitr/minted deployment profiles and portable PostgreSQL/Redis/S3
storage were not accepted. The portable-storage phase required by the amended
plan remains a separate lead dependency before P2 adapters.

No missing P2 editor, adapter or operations capability is counted completed.
The administration dependency above remains a native P1 usability finding even
though its missing backend is assigned to P2. User-facing final end-to-end QA
remains lead-owned.

## Cleanup and retained evidence

PASS: `runtime.log` records browser closure, listener disposal and deletion of
`/tmp/quire-p1-verify.jRzgIb/independent-app-qJ5B1J`. The full owned TMPDIR/cache
root `/tmp/quire-p1-verify.jRzgIb` was then removed. `cleanup.log` records exit-0
runners, removed root and no remaining owned runner process. An HTTP request to
the former ephemeral listener independently failed with `ECONNREFUSED`.
Both completion watches have ended; no owned server/browser/data remains.
Unrelated IPv4 5173/3001 listeners were neither used nor stopped.

Retained evidence consists of the four required command logs, `runtime.ts`,
`runtime.log`, eight PNGs, the actual edited-source PDF and `cleanup.log`.
The evidence subtree is ignored by the repository's existing ignore rules;
the lead must explicitly retain it in any authorized commit. This verifier
did not stage or commit files.
