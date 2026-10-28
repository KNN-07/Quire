# AI event authorization and mail failure ownership

Core review SSE now permits a registered scoped operation reader. The AI module
registers its actual `AiStore.accessible` logic rather than duplicating run ACL,
private-session or shared-conversation rules in core. Authenticated run events
are then rechecked against current project access and added to the stream's
project revocation tracking. Anonymous clients never invoke this reader.
Absent/forbidden runs are omitted; unrelated errors remain observable.

`MailDelivery.drain` tracks settlement with both promise branches, returning the
original promise to its caller instead of creating an unobserved rejecting
`finally` promise. The scheduler retains failures, stops its timer, always drains
and closes delivery, and surfaces the failure during close.

Receipt `bash_154`: eight tests passed and touched-file type-aware lint passed.
The new live SSE test uses actual AI/review modules and HTTP inference: terminal
completion reaches its original session, private Ask events do not replay into
another session, shared-conversation completion does, and an unrelated account
receives neither. Existing anonymous Viewer replay/revocation also passes.

Actual SQLite trigger failure proves scheduler shutdown reports the failure,
closes delivery and leaves no orphan promise rejection. The remaining tests
exercise real SMTP/TLS success, retry, rejection and cleanup.

Full TypeScript reported only concurrent integration fixture
`tests/integration/adapters/harness.ts:18` generic-envelope typing; its owner
was notified. No clean global typecheck is claimed for this run.
