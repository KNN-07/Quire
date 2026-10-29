# P29 history contract decision

October 28, 2026. Parent implementation decision; not an acceptance receipt.

The existing stored source states and immutable history snapshots establish
recorded change actors, not original authorship of every surviving character.
History presentation must describe that granularity. A suggestion's author is
distinct from the actor who later accepts it.

The history lane may add history-only schemas in `packages/contracts/src/projects.ts`
and a dedicated `historyChanges` route in `packages/contracts/src/routes-core.ts`.
The existing `historyCompare` response and `GitHunkSchema` remain unchanged.
The new projection may expose scoped participant IDs and nullable display names,
with no membership or email information. Each recorded change identifies its
file, path, actor, consecutive from/to versions, and honest provenance granularity.
Every intermediate history version must pass access and retention checks;
inaccessible history must not be reconstructed through a wider comparison.

The lane also owns review previews, actual persisted suggestion-author filters,
source anchors and counts where supported by existing review data. It does not
own the editor source typing path or Assistant contracts.

Two required behaviors remain separate open tasks:

- Connect review threads to consented AI context.
- Implement source tracking with reviewed change proposals.

A read-only inline preview is not source typing interception. D10 must remain
partial until those separately verified behaviors land. The P29 verifier should
assess the bounded projection/preview delivery and retain these exclusions,
not certify full D10 completion.
