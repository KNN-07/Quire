# Bounded installation receipt pagination

Status: verified; additive control-query contract.

`UpdateOperationQuerySchema` accepts optional `order: "asc" | "desc"`.
Omission preserves descending behavior and the original parsed wire shape.
Ascending cursors are exclusive `id > cursor`; descending uses `id < cursor`.

`ControlStore.list` now applies actor/kind/status/cursor filtering, ordering and
LIMIT in SQLite before decoding receipt rows. It no longer materializes the
entire receipt ledger to return one page. The SQL direction is selected only
from the validated enum; filter values remain bound parameters.

The original ascending regression rejected the unknown order key. After the
implementation, `bash_204` passed 17 control-store/protocol/pagination tests but
strict types rejected possibly undefined expected IDs in the new fixture.
The fixture now declares its exact three-element Id tuple. `bash_205` passed
the two affected tests, type-aware lint and strict control TypeScript, exit 0.
The unchanged 15 other passing cases were not rerun.

Both installation integration and supervisor owners received the final contract.
No ledger migration, command authorization or phase/floor semantics changed.
