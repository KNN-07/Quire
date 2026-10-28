# Assistant panel

## Reference and tokens

The supplied `Quire — LaTeX Editor.html`, decoded `03-ai-agent.source.html`,
`01-editor` and `03-ai-agent` captures, and `docs/discovery/design.md` define
the identity. Reuse `apps/web/src/styles/tokens.css` and shared `ui` controls:
Plex Sans chrome, Plex Mono source, neutral hairlines, AI-purple actions,
tonal green additions and red deletions. Dark mode uses the existing dark
tokens, not invented provider branding. No global or shell changes belong here.

## Layout

Layout: assistant - bounded conversation and review in an assembly-owned slot ->
scroll-body-shell (local layout-skill contract); scroll owner:
`.qa-assistant__body`; fixed header; anti-patterns: unbounded nested vertical
scrolling, fixed-width children, source mutation in a display component.
The body owns review, messages, disclosures, and composer so a mobile keyboard
or expanded consent form never hides controls in an oversized fixed footer.
Source previews wrap; textareas may scroll their own editable text.

## Brief

Primary action: Send in empty/chat states; Accept all when pending proposals
exist (Send becomes neutral). Priorities: (1) reviewable changes or conversation,
(2) explicit selected context and prompt, (3) governance/settings.
Left out on purpose: fabricated run steps/timings, sample citations, static
usage numbers, marketing chips, placeholder model output, global app chrome.

Required content: Assistant title; Ask/Agent; all 20 contextual tools; exact
file selection; opt-in UTF-16 selection and preview; diagnostic selection and
consent; PNG/JPEG upload and consent; prompt; translation target; Send,
regenerate, cancel; real run status/version/errorCode/conversationId;
before/after edits and statuses; per-edit/all accept/reject/undo; optional real
branch and commit; recompile after Error Fix review; source navigation;
conflict/recovery guidance and retained local recovery text; actual sources;
provider availability/configuration reason; offline/viewer/policy denial;
server-required/accepted consent terms and current status; accept/revoke; model/style/inline/retrieval
preferences; explicit shared conversation creation/open/clear and private
session clear; monthly used/reserved/refunded; owner-only confidential label.

## Components and states

Shared Button/Field/Icon controls retain shared hover/pressed/focus/disabled
states. Assistant controls use 44px minimum hit targets. Native details elements
contain secondary context/settings and preserve keyboard/Escape conventions.
Review edits use neutral borders and before/after tonal rows, never accent
edges. Status and error text are selectable and exposed to assistive technology.
Loading renders immediately; asynchronous progress is the real run status,
not a speculative spinner or step list. No decorative motion is introduced.

## Integration constraints

The panel never writes Y.Text. Flush before context capture and governed review.
After source publication refresh metadata; the assembler must reopen a fresh
transport on epoch changes. Recovery is explicit and local text stays visible.
Terms and consent state come only from authenticated `aiConsentGet`. Required
and accepted versions are read-only metadata, never a user-entered value or an
assumed date. The checkbox starts from the server's `current` field; stale
accepted terms require renewed consent. POST uses the displayed server
`requiredTermsVersion` and `expectedVersion: userVersion`; successful mutations
refresh metadata. The assembler recreates transport on epoch changes.
Root dev-tooling installation and router/server composition are outside the
hard ownership boundary.
