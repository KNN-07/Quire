import type { Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { groupInput, resourceRow } from "./scim-schema";
import type { ResourceRow } from "./scim-schema";
import type { ScimStore } from "./scim-store";

export class ScimGroups {
  constructor(private readonly store: ScimStore) {}
  async create(tx: Transaction, body: unknown) {
    const input = groupInput.parse(body);
    const existing = await this.store.existing(tx, { kind: "Groups", externalId: input.externalId });
    if (existing) {
      if (existing.deleted_at || existing.data_json !== JSON.stringify(input)) throw new ServiceError("SCIM_EXTERNAL_ID_CONFLICT", 409, "externalId already identifies another group");
      return { row: existing, created: false };
    }
    const row = await this.store.insert(tx, { kind: "Groups", userId: null, data: input });
    await this.members(tx, { row, input });
    return { row, created: true };
  }
  async update(tx: Transaction, input: { readonly row: ResourceRow; readonly body: unknown; readonly remove?: boolean }) {
    const next = groupInput.parse(input.body);
    if (next.externalId !== input.row.external_id) throw new ServiceError("SCIM_IMMUTABLE", 400, "externalId is immutable");
    const data = input.remove ? { ...next, members: [] } : next;
    const row = await this.store.save(tx, { row: input.row, data, ...(input.remove ? { deleted: true } : {}) });
    await this.members(tx, { row: input.row, input: data });
    return row;
  }
  private async members(tx: Transaction, change: { readonly row: ResourceRow; readonly input: ReturnType<typeof groupInput.parse> }) {
    const previous = groupInput.parse(JSON.parse(change.row.data_json)).members;
    const affected = new Set([...previous, ...change.input.members].map((member) => member.value));
    for (const member of change.input.members) await this.store.get(tx, { kind: "Users", id: member.value });
    if (new Set(change.input.members.map((member) => member.value)).size !== change.input.members.length) throw new ServiceError("SCIM_DUPLICATE_MEMBER", 400, "Duplicate group member");
    await tx.run("DELETE FROM federation_members WHERE group_id=?", [change.row.id]);
    for (const member of change.input.members) await tx.run("INSERT INTO federation_members(group_id,resource_id) VALUES(?,?)", [change.row.id, member.value]);
    for (const id of affected) {
      const raw = await tx.get("SELECT * FROM federation_resources WHERE id=? AND deleted_at IS NULL", [id]);
      if (raw) await this.store.reconcile(tx, resourceRow.parse(raw).id);
    }
  }
}
