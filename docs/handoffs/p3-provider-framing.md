# Provider request body framing

Status: transport correction verified on project-local Bun 1.4.4.

The account connections producer isolated GitHub revocation failure to an
unframed DELETE request in `services/adapters/shared/http.ts`. The parent added
real receiver cases to `tests/adapters/shared/http.test.ts`: a 32-byte UTF-8 JSON
payload and a four-byte binary payload both arrived empty before the fix
(`bash_175`, two failures). Neither the provider parser nor its error was hidden.

The transport now sets Content-Length from the actual body byte length when a
body is supplied. `bash_176` passed all 33 HTTP and remote Git tests across nine
files, including genuine upstream revocation, encrypted credentials, clone,
fetch, push, conflict and rollback recovery. Scoped type-aware lint returned
exit 0, and the changed transport had no LSP errors.

The account browser producer has been released to rerun its affected gate.
That consumer acceptance is separate from this passing transport receipt.
Full repository TypeScript remains affected by the concurrent benefits test's
use of an absent suggestion version; its owner received the exact diagnostic.
