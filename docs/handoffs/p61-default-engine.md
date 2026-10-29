# P61 saved default compiler

FINAL, October 28, 2026. Parent takeover completed the missing API boundary
and native verification. This is bounded acceptance of `defaultEngine`,
not acceptance of all P61 preferences or the whole product.

Ordinary blank/example creation uses an explicit compiler first, otherwise
the actor's saved default. Template creation and imported source retain
their separate existing defaults. The dialog submits compiler and environment
atomically; the strict `projectCreate` contract now admits both typed fields.
Preparation checks compatibility before publication. Plain TeX cannot create
a LaTeX blank/example seed; it receives an actionable rejection rather than
silently changing engines.

## Evidence

`docs/evidence/p61-default-engine/parent-ready-native.log` records repository
Bun 1.4.4, October 28 21:38:15Z through 21:39:13Z, one passing native test,
24 assertions, zero failures and `P61_PARENT_ENGINE_EXIT=0`. The six fixture
input hashes match before/after; the outer receipt also covers the shared
event helper. The final packet is
`a72dba78-f7ee-41c9-b071-e58e50e48463/` in that evidence directory.

The actual account UI saved XeLaTeX. Native creation returned project
`a4a38fc8-2171-4494-b26e-dceb345323f2` with engine `xelatex` and the admitted
native TeX environment, without a subsequent settings patch. Reopen preserved
it. Real editor input saved meaningful TeX at revision 2. Compile
`385dc024-61a5-4fa8-a8c5-aa59c2b8b77c` succeeded and the authenticated artifact
response contained 4,104 PDF bytes, SHA-256
`e6960276b3ed3aca11658d0d3a740e3d36b9a8b47325089f35c2d1fe90f9a635`.
An independent actor retained pdfLaTeX. The owner then saved Plain TeX,
observed disabled creation for the incompatible LaTeX seed, and explicitly
selected LuaLaTeX to create successfully. This native override was not
performed while XeLaTeX was still saved.

All eight selection/outcome captures were opened by the parent in paired
1440/390 light/dark contact sheets. The creation controls wrap without overlap
and expose compiler/environment selection. Outcome captures show the real
editor and successful compile status; some captured the PDF renderer while
loading or the mobile Assistant overlay. They are not claimed as rendered-PDF
visual evidence. The artifact response establishes actual compiler output.

The four focused backend cases passed in `parent-enum-native.log`: actor
isolation/restart/override, HTTP replay, template/import precedence, and
incompatible compiler/unauthorized workspace rejection before publication.
That combined historical command also had one failing native locator case;
it is not represented as an entirely passing invocation. The final native
run above supersedes that failure.

`parent-final-static.log` records clean scoped TypeScript for both default
engine and AI preference native suites, and type-aware deny-warning lint for
the changed contract, dialog, Assistant consumers and native/helper tests:
`P61_PARENT_STATIC_EXIT=0`.

## Recovery and cleanup

Historical attempts exposed strict-contract rejection, an ambiguous label
locator and native surface readiness. The final test selects the actual
combobox, opens the ready editable Source surface, saves meaningful content
and subscribes before compiling. No timing sleeps were introduced.

The shared event helper previously allowed disposal of an unawaited
subscription to mask the original failed action. Explicit disposal now
observes that cancellation rejection internally while the original promise
still rejects if awaited. Two focused tests pass with six assertions;
`docs/evidence/p61-ai-preferences/parent-lint-final.log` retains that result.
Timeout behavior is unchanged.

The final root `/tmp/quire-ui-editor-jZsWz8` was disposed and independently
confirmed absent. The earlier orphan Vite PID 3573788 was identified by its
exact `/tmp/quire-ui-editor-ui3A5H` command and terminated; that root was
removed and its ports 36397/40993 confirmed closed. The final fixture's
cleanup receipt covers its API 41587, Vite 35987, browser and application.
No unrelated service or port 5173 was modified. Root integrated gates remain
pending after all P61 edits settle.
