# Governed AI endpoint contract

All seven routes requested in `docs/evidence/p2x-ai/contract-delta.md` now exist
in the lane-X endpoint registry: image upload, shared conversation creation and
retrieval, monthly usage, project security read/write, and session-local clear.
The existing shared-conversation delete remains versioned.

`AiRun` now requires `tool`, `version`, `errorCode`, and `conversationId`.
The tool enum lives in `work.ts` with the run schema and is re-exported from
`routes-adapters.ts`, avoiding a circular schema dependency. The AI producer owns
mapping these values from persisted request and run metadata and wiring the
authenticated service handlers.

Receipt `bash_134`: two contract tests passed and touched-file type-aware lint
passed. Global TypeScript found two errors in concurrently edited backup browser
and PDF navigation tests; both were sent to their owners. This receipt does not
claim endpoint runtime or product-wide acceptance. Runtime HTTP authorization,
CSRF, persistence and service behavior remain in the AI producer's verification.
