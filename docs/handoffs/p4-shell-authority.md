# Mounted shell authority validation

Status: verified against current production behavior; no duplicate event
subscription or production fix was added.

The document transport updates source permissions on access/policy events.
Mounted review panels already call the supplied `refreshWorkspace`, which
publishes fresh access/benefits into the root session while preserving the
existing document when source identity/epoch/path has not changed.

The new `tests/ui-editor/assembly/authority.browser.test.ts` exercises a real
Editor browser and independent operator session on the actual editor route.
Without opening Share, the operator changes writable capacity from unlimited
to zero and back. The test observes settings controls disable/re-enable,
assigned role remain Editor, effective role become Viewer, and the same
source editor node remain connected. No manual Refresh or reload substitutes
for event-driven authority.

`bash_200`: one real browser case passed. `bash_201`: scoped type-aware lint
and full repository TypeScript exited 0. Earlier `bash_199` used an incorrect
singular `/project/` route; its fixture failure is not a production-authority
failure. Both exact roots, `/tmp/quire-ui-editor-CcYTCp` and
`/tmp/quire-ui-editor-phgOFC`, were confirmed absent after disposal.

The independent editor reviewer received a separate code-review concern about
workspace-dependent review subscriptions restarting their replay cursor. This
receipt does not assert that traffic concern is disproved; the reviewer must
report actual repeated requests if observed. It is not grounds to add another
shell stream to behavior already proven to work.
