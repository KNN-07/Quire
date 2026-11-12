# REMOTE GIT TESTS

## OVERVIEW
Provider transport, import, push/pull, and credential boundaries; score 3, retained Git protocol domain guidance.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Runtime composition | `harness.ts` | `remoteGitHarness` |
| GitHub protocol | `provider-fixture.ts` | `githubFixture` |
| Repository setup | `fixture-git.ts` | `fixtureGit` |
| Shared action assertions | `test-helpers.ts` | `action`, `operation` |
| Import routing choices | `import-choices.test.ts` | Interchange integration |
| Recovery and conflicts | `pull-recovery.test.ts`, `push-conflict.test.ts` | Persistent state boundaries |
| Credential treatment | `credentials.test.ts` | Secret handling |

## CONVENTIONS
- `remoteGitHarness(providerOrigin, options)` explicitly owns fixture-origin admission.
- The harness composes identity, core projects, core Git, and remote contributions.
- `standaloneImport` controls direct import-route registration.
- Without an explicit override, enabling interchange disables the standalone route.
- `interchange` adds the interchange module to the composition.
- `SafeHttpClient` and remote integration receive the same fixture provider origin.
- The fixture browser origin is `http://localhost:5173`.
- Shared Git helpers supply repository state to protocol-facing tests.
- `remoteGitHarness` is an exported fixture; resolved reference counts are unmeasured.

## COMMANDS
```sh
bun test tests/adapters/remote-git
```

## ANTI-PATTERNS
- Preserve the single import-route owner selected by the harness options.
- Keep revoked export and ownership denial scenarios in their dedicated suites.
- Recovery assertions must retain the conflict cases already covered by pull/push tests.
- Sources: `harness.ts`, `export-revoke.test.ts`, `ownership.test.ts`,
  `pull-recovery.test.ts`, `push-conflict.test.ts`.
