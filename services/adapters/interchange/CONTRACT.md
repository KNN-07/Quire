# Interchange integration contract (October 27, 2026)

Final `docs/handoffs/p2x-base.md` and parent
`docs/handoffs/p2x-core-interchange.md` have been consumed. The original
cross-owner deltas below have landed; these are no longer missing-port workarounds.

Resolved deltas:

1. Core exports `provideExternalLinks(context, ExternalLinks)` and retains its
   single create/refresh routes, ACL checks and replay receipt. Interchange installs
   a composed URL/bibliography dispatcher. Parent passes `references.links` as
   the `bibliographyLinks` option.
2. Core `createFromFiles` accepts `mainPath`, `engine`, `environmentId` before
   publication. The authorized shared JSON/multipart schemas expose these fields.
3. Interchange owns real staged-upload create, metadata and content endpoints,
   migration `066-x-interchange-uploads`, actor ownership, expiry and byte limits.
   `source.kind=upload` reads those real persisted bytes.
4. Interchange owns `importCreate`; remote Git defaults its own route off.
   Dispatch uses shared actor-aware `ExternalAdapter.execute` and encrypted
   `GrantStore`, including grant version and parsed parameters. Remote module 062
   retains migrations/recovery. No remote Git mechanics are duplicated.

The parent explicitly extended the hard write boundary only to
`packages/contracts/src/multipart.ts` and `routes-adapters.ts` for staged uploads
and import selections. Current AI and connection routes were preserved.
