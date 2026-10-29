# Parent orphaned fixture cleanup

October 28, 2026. Scoped cleanup, not whole-task teardown.

A read-only process inventory found four parentless Quire test web servers.
Their command lines named the repository's actual `web-server.mjs` and unique
editor fixture roots. Their upstream API ports all refused connections, and
older phase cleanup reports explicitly retained some of these as resources
outside those child verifiers' ownership.

The parent sent SIGTERM only to server PIDs 559395, 688441, 1175222 and
1193963. The exact server/helper set
559395/559452/688441/688462/1175222/1175242/1193963/1193996 then disappeared,
confirmed by `mon_59V1QQ71FZ5TSP7M`, exit 0.
The four stopped fixture roots were removed:

- `/tmp/quire-ui-editor-3khef0`
- `/tmp/quire-ui-editor-WZyN8W`
- `/tmp/quire-ui-editor-veOERL`
- `/tmp/quire-ui-editor-bDa5Ke`

The same inventory found an abandoned repository test barrier, PID 387029,
whose parent was PID 1 and whose exact command named
`/tmp/quire-backup-admission-scale-N9y7Eq/git/...`. That root was already
absent. The actual `git-probe.ts` waits for a test-control socket instruction;
the parent verified its command again, sent SIGTERM, and confirmed exit under
`mon_HPF263Q3B887F3XP`, exit 0.

FastShort, active installation fixtures, the agent terminal, language server,
kernel and DAG viewer were not stopped.

The original HTML and ZIP still match their recorded SHA-256 hashes.
`/tmp/tmp.0KkWOTN9jO` remains the live kernel's TMPDIR, containing runtime
caches and tool infrastructure as well as the research extraction. It was
not recursively removed while active. Final runtime-cache cleanup remains
separate.

## Original administration fixture reconciliation

Retained parent kernel handles establish that the original administration,
overview, environment (two captures) and font browsers all exited with code 0:
PIDs 2571680, 2644670, 2652289, 2655292 and 2661372. Their five exact profiles
are absent under the original TMPDIR:
`admin-browser-u5sdQn`, `overview-browser-pJZ8BK`,
`environments-browser-oCcXSk`, `environments-browser-uEAhDF` and
`font-browser-2PMzCI`.

The retained actual fixture response identifies `http://127.0.0.1:40187/`;
a fresh one-shot connection returned `ECONNREFUSED`. These observed closed
handles/listener and absent profiles close the old administration fixture
teardown item without launching another browser or killing unrelated services.
