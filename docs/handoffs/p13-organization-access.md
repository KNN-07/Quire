# Authoritative organization access read: FINAL

October 28, 2026. Parent-owned contract/service prerequisite for the account
organization consumer; UI adoption remains the producer/verifier gate.

The initial consumer inferred operator access from a successful member-list
read without an own membership. That inference failed when an operator also
had an ordinary or manager membership, and depended on directory contents.

`endpoints.organizationAccess` now reads
`GET /api/organizations/:o/access` and returns:

```ts
{ role: "member" | "manager" | "admin" | null, operator: boolean }
```

The existing member-level authorization and independent native operator
override guard the read. The returned membership comes from the current
organization/user row; operator authority comes from the authenticated
principal. The response is private/no-store and carries the organization
version ETag. It neither scans a directory nor changes any permission.

Seven native cases first failed against the absent route. The new route
passed **7 cases/26 assertions**, covering ordinary member, manager and admin;
operator without a membership; operator with ordinary and manager memberships;
unrelated-account denial and unauthenticated denial.
Receipt: `mon_DTF0DX027QB0078N`.

The initial static command named a nonexistent governance-local tsconfig.
Using the existing account target then exposed its missing inclusion of
the already-declared SQL/TeX asset modules. The sole configuration correction
adds `packages/runtime/src/assets.d.ts` to that target's include list.
Scoped strict TypeScript and touched-source type-aware deny-warning lint
then passed exit 0 under `mon_MSZGHD03YRJTENVH`. The seven passing behavior
cases were not repeated.

The one affected endpoint-registry dispatch invariant additionally passed
1 case/2 assertions under `mon_VAKE9N0HMHFTGR6E`; the other 22 schema cases
were filtered, not counted as newly run.

The normal awaited governance fixtures close their listeners/runtime and
remove their isolated roots. This handoff claims no separate per-root audit,
new organization mutation authorization or cross-role browser acceptance.
The organization UI must consume these two independent fields and retain
server enforcement on each action.
