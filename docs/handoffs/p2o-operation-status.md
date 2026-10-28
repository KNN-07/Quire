# Durable operation status

Parent-owned module, October 27, 2026. Focused HTTP tests and type-aware lint
pass. Root registration is assigned to the backup integration owner.

Export `register(context: ModuleContext): void` from
`services/operations/tasks/index.ts`, lane O, order 42. No new migration is
needed. It registers the previously absent `operationGet` and `operationsList`
contracts; it does not duplicate the core operation download route.

GET returns the existing durable operation DTO. Listing supports kind/status
filters and ID cursor paging and exposes the existing summary timestamps.
Responses are private/no-store. Named users see their own operations;
anonymous export status requires the matching operation grant token.
Embedded project scopes are checked against current project access, and
operator-only results require current operator authority. Results that have
become inaccessible are omitted from lists without swallowing server errors.

`tests/operations/tasks.test.ts` exercises actual HTTP source export, restart,
status/list retrieval, actor isolation and current operator demotion.
`bash_117`: two tests passed, followed by touched-file type-aware lint,
exit 0. Production-file LSP diagnostics reported no errors.

Environment/worker fixture compositions must include this O module explicitly
when they construct a custom module list. Parent asked the root integration
owner to install O042 once, with backups O041, environments O060 and workers O080
as their actual exports become available. Whole-application acceptance remains
pending the operations phase.
