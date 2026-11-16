# P74 append-only implementation notepad

- 2026-11-13: Read shared contribution contract, applicable AGENTS, publisher
  configuration/actions/client, settings persistence, OAuth/grants, and account
  connection forms. Shared tree initially clean. Exact scenarios recorded in
  p74-publisher-scenarios.md before implementation.
- RUN_TMP: /tmp/quire-p74-publisher-So0Bd7. Runtime caches are isolated under it.
- Scope decisions: bearer only; manual actions retain ready-grant authority;
  local manual status remains available. No admin or submission screen.
- First HTTP/browser run found migration lexical ordering: publisher sorted before
  shared-adapters, so ALTER ran before table creation. Corrected the new ID to
  shared-publisher-contract after inspecting migrateDatabase's sorted execution.
  Initial typecheck found index-signature property access in account UI; corrected.
- Added HTTP enrollment tests, additive migration preservation test, action
  publication capability regression, and manual receipt/local status checks.
- Isolated XDG cache correctly hides the global browser cache. Browser attempt
  reported missing executable; subsequent run explicitly selects the owned
  Chromium 1248 binary under /home/norman/.cache/ms-playwright.
- An in-flight HTTP run loaded the older provider helper before the new paused
  verification method was added; that attempt failed with the stale helper.
  The subsequent fresh process exercises the completed helper.
- Bearer grants now retain local removal semantics in their encrypted token
  document and expose only the removal marker in grant DTOs, preserving honest
  forgetting language when the operator later changes enrollment mode.
- Browser requirement assertion initially inspected collapsed details text.
  Updated the scenario to open the real requirement disclosure first.
- A completed HTTP pass reported 18 passing tests, including real compiler ZIP,
  grant fencing, action publication fencing, and manual local status.
- Repository typecheck reported errors in concurrently edited installation
  pandoc tests; none were in publisher/shared/account changes. Those files are
  owned by the lead and have not been edited here.
- Full shared/publisher run passed 72 tests, 204 assertions. Browser run passed
  all bearer enrollment/test/forget scenarios at 1440/390 and OAuth callback.
  Inspected mobile enrollment and desktop forgetting screenshots: no overlap or
  clipping. The latter exposed inherited "repository credential" copy; changed
  it to "saved credential" and queued refreshed browser evidence.
- Lint rejected string spread in the path validator; changed to the existing
  OAuth code's split/charCodeAt pattern without suppressing any diagnostics.
- Final browser rerun passed with corrected copy: 1 test, 20 assertions, 81.64s.
  Inspected final mobile forgetting and desktop enrollment screenshots.
- Final focused HTTP rerun passed 6 tests/54 assertions. Owned-file lint exited
  zero. Latest global typecheck has only concurrent pandoc-recipes.test.ts:28
  Digest-brand error. No diagnostics in this unit's files.
- Teardown observed CONNECTIONS_CLEANED, ECONNREFUSED on final browser port 44351,
  and zero remaining quire-* fixture directories in RUN_TMP.
- Parent requested independent omowright startup instructions. Handoff records
  existing exported aggregate/provider fixtures, concrete bearer configuration,
  in-memory seeded account/token access, selectors and screenshot paths.
