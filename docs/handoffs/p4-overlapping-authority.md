# Overlapping workspace authority refresh: FINAL

October 27, 2026. This is a verified controller correction, not attribution
of the separate standalone Share transition timeout.

`tests/ui-editor/assembly/authority-refresh.test.ts` orders actual native
responses explicitly: hold a real pre-change effective-access response,
commit a real operator grant restricting writable membership, request another
controller refresh, then release the old response. Session, project, grant and
effective-access services remain real. Only file discovery is stubbed empty to
exclude an independent document/websocket reader from this controller test.
No sleep or repeated attempt decides ordering.

Before the correction, `mon_VRSA6ZKYAM1GBYXH` failed in 759.64 ms:
expected effective role Viewer, received Editor. The controller coalesced the
new refresh request into the old in-flight read and published stale authority.
The earlier attempt to delete the fixture's main file failed at its real 422
guard before reaching the regression; that setup attempt is not the red proof.

`apps/web/src/features/editor/session-controller.ts` now remembers refresh
requests received during a read and performs a fresh read before completing
the shared promise. Existing file-epoch replacement, retained source and
transport ownership behavior remain covered by real-browser checks.

`mon_HR5X4DABVRZG0SX8` completed exit 0 on project-local Bun 1.4.4:
3 tests passed, 23 assertions, 58.87 seconds. The command ran the new regression,
mounted shell authority without opening Share or replacing its document, and
genuine unacknowledged-source epoch replacement/recovery. Type-aware lint on
the changed controller/test and root TypeScript also exited 0. LSP found no
errors in either changed file.

Actual output and source fingerprints are retained in
`docs/evidence/p4-benefits-current/authority-refresh-result.txt` and
`authority-refresh.sha256`. Exact browser roots
`/tmp/quire-ui-editor-B1ZIMi` and `/tmp/quire-assembly-ozamR6` were independently
confirmed absent after awaited fixture disposal.

The earlier 1920/light timeout occurred on standalone Share: its retained
directory has no completed limited-share capture. That fixture does not use
this session controller. Therefore this correction is not claimed to resolve
that timeout; the remaining Share read-order investigation stays open.
