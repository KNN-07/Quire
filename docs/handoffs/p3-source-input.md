# Exact multiline source input

The assembled editor exposed loss of one leading newline when Chromium inserted
a multiline string at the document's trailing empty line. The parent reproduced
it in the actual source fixture on project-local Bun 1.4.4 (`bash_169`):
selection was exactly at UTF-16 offset 453, raw `beforeinput.data` retained the
newline, and both local Yjs text and durable server text lost it even after an
explicit flush. The byte-equality assertion was not relaxed.

The source editor now handles only noncomposing multiline `insertText` events
before contenteditable reconciliation, dispatching CodeMirror's actual
`replaceSelection` transaction with `input.type`. Read-only state remains
guarded; ordinary typing, paste and composition retain their existing paths.

Receipt `bash_171`: actual browser append, selected-range multiline replacement,
collaborative undo and exact persisted bytes passed, followed by touched-file
type-aware lint and full repository TypeScript, exit 0. Raw browser errors
remain asserted empty. The assembler was notified to rerun its affected
mounted-source case; this receipt is not full assembled-editor acceptance.

Global lint also identified two generated browser bundle directories, each
containing only emitted JS/CSS. `.oxlintrc.json` and `.gitignore` now classify
those exact directories as generated outputs. Their authored TypeScript remains
checked. `bash_170` reached only an authored assembler `no-shadow` error after
this correction; its owner was notified. No authored lint rule was suppressed.
