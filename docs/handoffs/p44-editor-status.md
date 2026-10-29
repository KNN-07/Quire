# P44 visible mobile editor status

October 28, 2026. FINAL scoped layout correction.

The combined account-entry audit retained a cropped last status row on mobile.
A native layout regression confirmed 104 pixels of status content inside a
79-pixel client area, caused by the mobile 80-pixel maximum block size.
Parent removed only that cap from `editor/workspace.css`. Grid sizing now gives
status its natural height while the editor pane shrinks; touch targets remain.

`before.log` retains the new test's initial wrong close-button label failure;
`before-drawer-corrected.log` is the actual red clipping proof. No application
assertion or viewport bound was weakened.

`fixed.log` records source/test hashes, strict types/typed lint exit 0, and one
passing native case with 54 assertions in 42.09 seconds. Monitor
`mon_GV6RQPCJVXQH6HHR` / `bash_423` completed exit 0. Parent inspected all six
1440x900, 390x844 and 390x900 light/dark screenshots in packet
`a0a451d5-e8b6-4853-b813-22852f6f16f4`: cursor, encoding, shared-save status and
compile controls are fully visible without internal footer clipping or new
overlap. The body remains visible and scrollable.

The final root `/tmp/quire-assembly-roPDn7` and both earlier attempt roots
are independently absent; final ports 36595/44013 refuse connections.
`web-build.log` retains CSS hash and `P44_WEB_BUILD_EXIT=0`; monitor
`mon_EVQ4Q693MKPDNV5W` / `bash_424` completed exit 0. Only the changed web
artifact was rebuilt. P41's server/worker/installation bundles and P43's current
whole-tree static checks remain separate evidence. The existing chunk-size
warning was not suppressed.
