# REMOTE GIT INTEGRATIONS

## OVERVIEW
Generic Git, GitHub and GitLab actions with recoverable repository publication; score 8, distinct remote repository domain.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Assembly | `index.ts` | Contributions and order-62 module |
| Integration contract | `README.md` | Route ownership and setup |
| Provider definitions | `providers.ts` | Registered actions |
| Provider interface | `provider-client.ts` | Provider abstraction |
| GitHub | `github-client.ts` | Provider requests |
| GitLab | `gitlab-client.ts` | Provider requests |
| Git execution | `git-process.ts` | Process boundary |
| Credentials | `credentials.ts` | Remote authentication |
| Import | `import-project.ts` | Repository preparation |
| Export | `export-new.ts` | New remote publication |
| Pull | `pull.ts` | Incoming reconciliation |
| Push | `push.ts` | Outgoing publication |
| Recovery | `recovery.ts`, `store.ts` | Prepared publication state |

## CONVENTIONS
- Install contributions through the shared adapter factory.
- Shared connections/provider modules precede the remote module.
- Interchange owns `POST /api/imports` in the full assembly.
- Standalone import registration requires explicit `registerImportRoute: true`.
- Remote publication uses consumer recovery state in addition to shared receipts.
- Provider SDK installation is not required by this implementation.

## ANTI-PATTERNS
- Never enable the standalone import route alongside interchange.
- Do not substitute provider-specific routes for the shared contribution contract.
- Do not treat remote side-effect completion as fenced local publication.
- Do not bypass `recovery.ts` when changing prepared publication state.
- Keep credential handling behind the shared encrypted grant boundary.
