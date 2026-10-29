# P39 readonly source history correction

October 28, 2026. FINAL scoped parent correction; independent verdict refresh pending.

## Accepted parent result

`docs/evidence/p39-readonly-history/physical-redo.log` records strict types and
typed deny-warning lint exit 0, then three browser cases passing with 29
assertions in 50.86 seconds. Monitor `mon_E49MGVFDNY0NB93N`, session `bash_407`,
completed exit 0. Touched-source hashes precede the commands.

Default, Vim and Emacs now preserve retained text under readonly undo/redo,
resume working history after reconnect, preserve shared source bytes, and
recover the same draft after reload. The final default/Emacs redo key event
is asserted to carry uppercase `Z`, matching the physical shifted shortcut.
The prior lowercase synthetic event was not accepted as evidence of a lost
redo stack; all original text-preservation assertions remain.

The final roots `/tmp/quire-ui-editor-adXZMQ`, `/tmp/quire-ui-editor-vlRSBK`
and `/tmp/quire-ui-editor-dMqesl` are independently absent. Ports 40703, 36859
and 32923 refuse connections, and `readonly-build` is absent. No new visual
layout was introduced. The original P31 independent FAIL remains historical
until its reviewer checks this correction; this is not whole-product approval.

## Implementation and retained failure sequence

P31 independent verification found that a retained private tracking draft
could change through Ctrl+Z after going offline, despite the editor displaying
`contenteditable=false`. Shared server source remained unchanged. The original
red reproduction is retained by the verifier; tracking is not accepted yet.

Parent added current editor-state readonly guards to the standard Yjs history
key bindings and the maintained Vim/Emacs undo/redo adapters. Standard shortcuts
are consumed while readonly. Online history still calls the same UndoManager.
No server authority, proposal writer, draft ownership or acceptance path changes.

The new regression uses the existing real standalone Source fixture and three
actual preference modes. It types a private draft, goes offline, attempts undo,
resumes and successfully undoes, goes offline with redo available, attempts
redo, resumes and successfully redoes, then reloads retained text. Shared
source bytes must remain unchanged throughout. It uses DOM subscriptions for
connection-state transitions rather than sleeps.

Changed production files: `source/editor.ts` and `source/bindings.ts`.
New tests: `tests/ui-editor/source-tracking/readonly-history.test.ts` and its
separate HTML/build directory. The latter is removed by the test teardown.
Early LSP findings in the new test were corrected against the actual fixture
API before execution; no assertions or compiler settings were weakened.

`docs/evidence/p39-readonly-history/verification.log` contains touched-source
hashes and `P39_STATIC_EXIT=0` for strict types/typed deny-warning lint.
The targeted browser run is active under `mon_D2X6XJB76HDEFAQQ` / `bash_403`.
No passing tracking workflows were replayed. Final test/cleanup and independent
closure of the original FAIL remain pending.

The first new regression run stopped before reaching any history action:
all three modes timed out waiting for readonly after browser offline emulation
left their existing WebSocket open. The original auditor's reproduction also
closed the owned server-side socket. The test now uses that same actual
network cut, preserving the real open/close handlers and observing the exact
readonly transition. No state is mocked and no history assertion is removed.

`verification.log` retains the failed setup (three failures, six assertions,
exit 1). The changed/failed target is rerunning under
`mon_4M279CETFYBEH32E` / `bash_404`, with hashes and raw results in
`network-cut.log`. No full tracking/normal-source suite is repeated.

That run reached history actions: Vim passed, default readonly undo still
changed text, and Emacs online redo did not restore it (one pass, two failures,
19 assertions). Installed `y-codemirror.next/src/index.js` registers an
additional `beforeinput` history handler. Parent now blocks readonly
historyUndo/historyRedo before it. The installed Emacs redo aliases also
now use the same guarded Yjs manager as its undo.

`native-input-fixed.log` then passed Vim and Emacs and preserved readonly text,
but failed default online redo (two passes, one failure, 25 assertions).
Standard history now uses explicit guarded commands on the same UndoManager,
with Shift-redo attached to Mod-z and a Mod-y alias, instead of spreading the
upstream keymap. Native input guarding remains in place.

The unchanged three-mode assertions are running against that revised binding
under `mon_5DSG5JRNHA6XMRBR` / `bash_406`, receipt `unified-history.log`.
No assertion was removed or changed to accept text loss.

That run again passed Vim/Emacs but failed only the default online redo
assertion. A separate diagnostic review identified the lowercase Playwright
shifted key event as a likely dispatch issue. The test now sends
`Control+Shift+Z` and observes the emitted key before asserting unchanged
readonly behavior and successful resumed redo. The accepted run above closes
this test-input issue without changing the expected document or weakening the
readonly checks. Earlier raw failures remain retained.
