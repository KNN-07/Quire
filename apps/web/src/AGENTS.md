# WEB APPLICATION

## OVERVIEW
React client with routed account, project and collaborative editor features; score 9, distinct browser domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Bootstrap | `main.tsx` | Mounts the application router |
| Navigation | `router.tsx` | Route composition |
| Session | `session.ts` | Browser session helpers |
| Shared controls | `ui/index.ts` | Public primitive barrel |
| Account flows | `features/account/` | Forms, onboarding, organizations |
| Administration | `features/admin/` | Shared `useAdminResource` |
| Editor assembly | `features/editor/index.tsx` | Owns outer panel geometry |
| Source editing | `features/editor/source/` | CodeMirror and private tracking |
| Collaboration | `features/editor/transport/` | Acknowledged documents and presence |
| Review | `features/editor/review/` | Persisted suggestions and anchors |
| Assistant | `features/editor/assistant/` | Private conversation and reviewed edits |
| Tool panels | `features/editor/tools/` | Files, references, browser Python |
| Visual editing | `features/editor/visual/` | Conservative interval edits |
| Theme | `styles/` | Tokens and self-hosted fonts |

## CONVENTIONS
- Read `features/editor/source/README.md` and each affected area's design contract before changing its interaction.
- Source tracking binds a private Y.Doc; normal editing uses transport-owned shared text.
- Tracking recovery is scoped by actor, project, branch and file.
- Account mutations use `mutationHeaders()` and shared result helpers.
- The source scroller and tool bodies own scrolling inside assembly-owned geometry.
- The transport offline window bounds editing; it grants no server authority.

## ANTI-PATTERNS
- Never connect private tracked text or awareness to collaborative transport.
- Never erase unreadable recovery records or silently rebase dirty drafts.
- Do not fabricate diagnostics, provider success, file counts or PDF previews.
- Do not add a second save indicator or a second source persistence path.
- Do not replace effective server capabilities with hidden controls.
- Browser Python must not auto-install packages or save outputs without review.
