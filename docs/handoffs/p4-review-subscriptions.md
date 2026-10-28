# Review authority subscription correction

Status: FINAL for the subscription correction, October 27, 2026.

The independent pre-fix evidence remains in
`docs/evidence/p2u/authority-traffic.json` and
`docs/evidence/p2u/authority-traffic-result.md`. Workspace refresh recreated
Review and History subscriptions from cursor zero. The mounted PDF controller
also recreated its stream on every workspace object change.

Threads, Suggestions, History and Chat now load data separately from their
scope-bound subscription effects. Effect-event callbacks read current state
without restarting subscriptions. The PDF controller remains bound to the
client, project, branch, share token and document, while its workspace getter
reads current authority. Automatic compilation is reconfigured on capability
changes. No second shell event subscription was introduced.

The regression observes the existing shell metadata request after workspace
commit instead of waiting a fixed number of animation frames. It closes each
page in a finally block. The intermediate unavailable-settings-selector failure
and remaining PDF restart failure were not treated as passing results.

`mon_FAYHDBHDM7C9REC3` completed exit 0:

- Mounted Review, History and Chat: 3 passed, 9 assertions, 62.02 seconds.
- Stream counts stayed 4/4, 3/3 and 4/4 across capacity restriction and restoration.
- Type-aware lint on the changed panels and regression, and root TypeScript passed.
- Fresh observations: `docs/evidence/p2u/authority-traffic-stable-v3.json`.
- Owned root `/tmp/quire-ui-editor-yfm0DL` was independently confirmed absent.

`bash_215` / `mon_JTWC5FSMFBRK16NJ` completed exit 0:
4 PDF lifecycle cases passed with 18 assertions. Actual automatic compilation,
durable source acknowledgement, cache clearing, cancellation, document-free
automatic compilation and header settings/flush behavior remain covered.
The fixture reported awaited shutdown of root
`/tmp/quire-ui-editor-ZBII0k`, web port 35943 and API port 46715.

This does not close the separate Git status read-side checkpoint defect or the
benefits visual matrix. Their evidence and acceptance remain separate.
