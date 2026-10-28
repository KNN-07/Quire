# Persisted review suggestion reads

`endpoints.suggestionsList` provides GET
`/api/projects/:p/suggestions?branch=...`, with standard cursor/limit and optional
fileId/status filters. Status is `all`, `pending`, `accepted`, `rejected` or
`conflict`. Response is `Page<Suggestion>`.

The core review handler checks current request authorization, including share
and membership revocation, before reading persisted suggestions. Ordering is
stable by creation time and ID. Combined file/status filters must match the same
edit; returned suggestions retain their complete edit arrays. Existing write
and decision routes remain authoritative.

Receipt `bash_149`: four tests passed, touched-file type-aware lint passed,
complete repository TypeScript passed, exit code 0. Actual HTTP checks cover
separate viewer/owner sessions, restart, pagination, rejection filters, outsider
denial, membership revocation and persisted conflict state after a real diverged
Yjs source decision. Browser review consumption remains producer-owned.
