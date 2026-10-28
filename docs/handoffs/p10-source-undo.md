# Source paste undo boundary: FINAL

October 27, 2026. Parent-owned shared editor seam.

The actual Source image-paste path emits CodeMirror `input.paste`. Source now
ends the previous Yjs capture group before that transaction and ends the paste
group after its view update. Package insertion and figure insertion remain one
transaction. The next edit cannot silently join that paste group. Ordinary
typing and remote-edit history rules are otherwise unchanged.

The parent strengthened the existing native media test rather than relying on
upload latency: browser wall-clock reads are fixed while network/timers run,
a real preceding keyboard edit is flushed inside the document body, and one
native clipboard paste must undo back to those exact preceding bytes. Redo
must restore the package and image insertion. Original producer images are
preserved; the test now supports a separate evidence directory.

The original code failed this fixed-clock case. An initial boundary attempt
used a custom event name that the actual Source path did not emit and also
failed; that receipt remains retained. The corrected native `input.paste`
boundary passed:

- `mon_PNS8N4Z4GT7NBSH3`: 1 passed, 40 assertions, 59.90 seconds; actual Source
  and Visual clipboard, device/project/link paths, uploaded bytes and compiles.
  Its chained type-aware lint passed.
- `mon_QCPNEYNQGYC0X0G3`: 3 existing cases passed, 11 assertions, 52.36 seconds;
  standard collaborative undo preserves a remote edit, and Vim/Emacs use the
  same source history.
- `mon_D8MGDN580R0BJNZY`: both existing media and source strict TypeScript
  project checks completed exit 0.

Receipts and hashes:
`docs/evidence/p10-media/parent-undo-result.txt`,
`parent-source-history.txt`, `parent-undo-types.txt`, `parent-undo.sha256`.
Durable JUnit reports:
`undo-paste-fixed-443eaaee-89fe-4a18-bc1b-4370832614cb.xml` and
`source-history-492ec507-f5a2-4f29-81ea-7cd481b37d47.xml`.
The fresh media images are in
`docs/evidence/p10-media/undo-paste-fixed-1f511c78-b7e3-4f65-abcf-8b3eb73505e6/`.

All five recoverable exact probe/history roots were independently checked absent:
`PooJ2I`, `ZnisRU`, `qesMqk`, `ulZK1e`, `TEI2AG`, each under
`/tmp/quire-ui-editor-`. Both failed attempts remain evidence, not passing runs.
This closes the shared undo seam; the media producer and phase verifier retain
ownership of their remaining feature-boundary acceptance.
