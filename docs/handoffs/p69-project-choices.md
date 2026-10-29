# P69 project creation/import choices

FINAL bounded acceptance, October 29, 2026. Implementation, targeted native
and backend checks, static validation and both independent visual follow-ups
pass. Inherited full-application checklist and physical-device limitations
remain explicit in `p69-visual-qa-a.md` and `p69-visual-qa-b.md`.

User documentation: `docs/runbooks/creation-and-import.md`.

Current creation scroll contract supersedes P1's original dialog scroller:
`.p-create-dialog > .q-modal__body` is the sole content scroll owner. Header
and footer remain outside that body, with bounded dialog height and clipped
dialog overflow. The final `*-layout-*.json` probes record actual region
bounds, overflow style, scroll position, document width and active scrollers
at 1440/390 in light/dark.

Latest reviewer-fix run: `docs/evidence/p69-import-choices/review-fix.log`,
`P69_REVIEW_FIX_EXIT=0`, two passing native cases and 248 assertions, strict
TypeScript and touched-file deny-warning lint. Final packet:
`docs/evidence/p69-import-choices/0c26269b-0f25-4251-be73-4a39109a6498/`.
The test holds actual requests before continuing to the real handler and
asserts choices disabled while pending and after import completion. It does
not fabricate a successful server response.

The prior 17 passing backend cases, saved-default native case and existing
blank/template/ZIP/source-export case remain separately attributed receipts.
Historical combined failures are not labeled passing.

## Implemented choices and publication

`CreationSettings.tsx` is shared by blank, template, ZIP, GitHub and generic
Git creation. Exact main path, engine and environment pass through strict
contracts and are published atomically. Remote preparation reuses the core
creation validator rather than silently choosing pdfLaTeX and the first
TeX file. Invalid explicit mains, incompatible engines and unauthorized
workspace choices retain their existing pre-publication guards.

Remote imports expose full-history retention versus an independent source
snapshot. Full history retains actual commits, branches and tags. Snapshot
mode publishes one local commit and omits the remote binding. Full history
can also be retained without a binding. Keeping a pull/push connection with
unrelated snapshot history is explicitly rejected. There is no claimed
automatic background two-way synchronization.

The journal persists the connection choice, so recovery cannot recreate an
unrequested binding. Independent imports do not share a moving project
cursor. An appended SQLite/PostgreSQL migration normalizes legacy unscoped
remote import/clone cursors only; existing project-bound pull/push cursors
and prior migration definitions remain intact.

The misleading public-without-credential option is removed. A ready saved
connection is explicitly required, including for public repositories.
Credentials remain account-scoped; omitting a project binding does not
delete a saved credential.

The form locks choices during the real request and after a result exists.
Same-file reattachment for a frozen onboarding retry remains available when
required. Legacy frozen attempts that omitted compiler settings are labeled
as service defaults rather than displaying invented saved choices.

## Correlated native evidence

The final packet creates four real projects, reopens their source, and reads
actual response DTOs:

| Mode | Project | Result |
| --- | --- | --- |
| Template | `cbd6199d-5f66-4683-8480-c9fcb75f46ce` | Explicit XeLaTeX/environment/main published together |
| ZIP | `c2fdffd7-7e5c-458f-92e5-192068b97d9b` | Explicit `z-selected.tex` used instead of the competing `main.tex` |
| GitHub | `ecf907cf-e2ae-44fe-964d-c4b0b61ac2fe` | Independent snapshot; one main branch, no tags, no binding |
| Generic Git | `f1b28434-8378-4292-af39-fff6cc566461` | Full history with `main`, `protected/release`, `v1.0.0` and a real binding |

All four persist XeLaTeX and the actual ready native environment. ZIP compile
`da0ae03d-8cab-4383-a506-d7297e8a1cf5` succeeds through the readiness-gated
native PDF control. The retained 3,048-byte PDF has SHA-256
`556fde27c5b41e20cab4bcef4104204f7a9df50abc8326a40aaa0ed8156a9100`.
`pdfinfo` identifies XeTeX; extracted text is `RIGHTIMPORT`, not the alternate
main's marker. The parent rendered and opened its entire one-page output.

The parent inspected all 32 prior final creation frames, then the corrected
ZIP lower-field and submitted-state captures. The two independent follow-ups
inspect the revised capture/probe set and close both the submission-mutability
defect and missing lower-content evidence. Their bounded PASS does not claim
physical touch hardware, every global hover/error state, 200% zoom or strict
whole-application style compliance.

## Tests and provenance

`backend-final.log` records **17 pass, 0 fail, 154 assertions** and
`P69_BACKEND_FINAL_EXIT=0`. Tests cover real Git objects, history/binding
combinations, repeated independent imports through one connection, restart
replay, failed-publication snapshot recovery, rejection before repository
publication, credential isolation, retained pull/conflict behavior, template
settings and frozen onboarding choices.

The final review-fix log records **2 pass, 0 fail, 248 assertions**, scoped
TypeScript/lint and stable five-input hashes. One case is the full native
template/ZIP/GitHub/Git workflow; the other retains the existing frozen
onboarding footer check. The real server request is held only long enough to
assert pending controls, then continued normally; successful responses are
never mocked.

`native-discovery.log` separately retains the existing blank/template/native
ZIP/source-export regression: **1 pass, 5 assertions**. The saved default
compiler case passed in `native-ready.log` before the unrelated failures in
that combined invocation; it is not called an all-green run. Later changes
to locking and scroll capture do not change that saved-default contract.

Initial failures remain visible: two test-only type errors; an unseeded
template fixture; a real mobile footer overflow fixed with the body scroller;
an early compile click before discovery; and unsafe test cleanup control flow
corrected without hiding the original error. Subsequent visual review found
the submitted-choice and capture gaps, now covered by the final run.
P70 supplies the integrated root types/lint/mapping/build baseline.

## Boundaries and cleanup

GitHub/OAuth/Git traffic uses owned loopback fixtures with real Git objects;
no live third-party import is claimed. New migration statements are supplied
for both dialects; these feature tests execute SQLite, not a new PostgreSQL
or production-scale deployment certification.

The final application root `/tmp/quire-assembly-WdzvGe` and the earlier
successful roots `/tmp/quire-assembly-8zqWkH` and
`/tmp/quire-assembly-18SWto` were independently confirmed absent. Native
fixtures close their browser/API/Vite resources and the owned Git-provider
fixture via async disposal. Other exact roots/ports remain in each raw
attempt's ownership and cleanup receipts. No unrelated service, port 5173
or project commit was changed.
