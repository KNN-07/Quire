# P55 explicit reauthorization of prepared Dropbox imports

October 28, 2026. FINAL parent correction of the P49 audit's recovery
availability finding. Native SQLite/blob/Git and owned loopback provider only.

## Correction

An interrupted import still cannot resume automatically after its saved grant
or provider configuration version changes. A distinct
`reauthorizeFolderImport` action now requires `confirmation: true` from the
current authenticated grant owner. It uses the normal grant claim, current
configuration, policy, actor, CSRF and final publication checks.

Only an existing prepared reservation for that actor/grant/folder may be
reauthorized. Project, source, folder and original name/main identity remain
fixed. The action publishes the previously prepared snapshot, not an
unannounced replacement from today's folder contents. Current folder identity
and location are checked before publication. Normal explicit synchronization
can subsequently reconcile newer remote content.

Saved authority versions are never rewritten. If explicit publication fails,
the original reservation remains stale and background recovery continues
rejecting it; the user must explicitly authorize another attempt. Successful
publication retains the original project ID and reconciles the original
operation receipt in the same transaction as source/binding publication.

Native inspection returns the original prepared name, main file and timestamp.
The settings form shows the snapshot distinction and requires a checked
confirmation before enabling **Resume prepared import**. Its original name
and main cannot be silently changed while reauthorizing.

This is reauthorization of the same grant identity, not automatic adoption
by a different/replaced grant, a different actor, a moved folder or a missing
folder. Existing policy/access errors remain fail-closed.

## Regression evidence

`docs/evidence/p55-dropbox-reauthorization/red.log` records both new authority
cases failing before the fix: current authority was restored, ordinary import
still returned `DROPBOX_AUTHORITY_CHANGED`, and no explicit reauthorization
action existed. Exit 1 is retained, not relabeled.

Final command, from `/home/norman/Repos/Quire` with repository-local Bun 1.4.4:

```sh
bun test tests/adapters/dropbox/folder-reauthorization.test.ts \
  tests/ui-product/dropbox-folder-project/reauthorization.test.ts
```

`final.log` records **3 pass, 0 fail, 57 assertions**, `P55_FINAL_EXIT=0`,
UTC 18:05:30Z through 18:06:31Z, and seven matching pre/post source/test
fingerprints. Monitor `mon_Y5CMCPZT1NRD9HZK` / `bash_446`.

The two backend cases cover grant and configuration version changes,
ordinary/background denial, missing/false confirmation rejection, injected
failure of explicit publication, unchanged stale reservation across restart,
then successful explicit recovery with one project/binding.

The native browser case creates a real failed preparation, updates provider
configuration through the authorized operator HTTP route, changes remote
contents, reloads and inspects through the UI, observes the original saved
name and disabled recovery button, explicitly confirms, and opens the
recovered project. Actual stored source first matches the prepared snapshot;
**Sync project now** subsequently imports the newer remote bytes.

The real project is `3267c951-f32d-4406-9cfd-b36cdd404204`, operation
`2bec0992-2a1c-4daa-9734-e84caf98c08c`, original folder
`id:folder-56b7b3fe-a0a5-455a-895b-560c80c8b3c5`. Raw IDs and both exact
source values are in `P55_NATIVE_RECOVERY` in the final log.

All four native recovery panel screenshots were opened and inspected under
`docs/evidence/p55-dropbox-reauthorization/browser-82f9f11e-0f21-47e7-a62f-af7fa903badc/`.
The 1440/390 light/dark controls, timestamp, confirmation and action are
visible, wrap within the panel and do not overlap.

The earlier combined `native.log` contains 13 passing original import
regressions and one new browser-fixture failure: its project GET omitted the
required branch query. That fixture was corrected; production recovery had
already succeeded before the bad read. The 13 unchanged cases were not
replayed again. Later schema-only extraction into the existing `model.ts`
preserves those parsers; the final three-case run exercises the moved imports.

## Static checks and review

`final-static.log` records `P55_STATIC_EXIT=0` under
`mon_X143E8K90PR8JX7Q` / `bash_447` for both Dropbox adapter/UI TypeScript
projects and type-aware deny-warning lint over all seven changed source/test
files. Fresh LSP initially passed for the new native case, while later fresh
requests timed out; no later LSP pass is invented. Scoped compiler checks
supply final diagnostics.

Folder-selection/reservation schemas moved to the existing Dropbox model
module rather than growing another helper layer. `folders.ts` now has 247
nonblank/noncomment lines, near the local size ceiling; further growth should
extract a coherent responsibility rather than compress statements. Current
changes retain the existing transaction/lease/operation architecture, parse
confirmation at the boundary, and add no type suppression or timing sleep.

All captured roots and listeners were independently checked after the runs:
23 exact roots absent and 48 exact ports refusing connections. The final
browser root is `/tmp/quire-p49-folder-Q5fQh6`, with web/API/provider ports
41355, 44935 and 45801. The final backend roots are
`/tmp/quire-p2x-base-BRF3JY` and `/tmp/quire-p2x-base-JDNsHV`.
The exact complete check inventory is in `cleanup.json`.

No unrelated service, live Dropbox account, port 5173 or original input was
touched. P53's earlier build remains historical after this source correction;
the next integrated build/static gate must include P55 and the in-progress
AI work.
