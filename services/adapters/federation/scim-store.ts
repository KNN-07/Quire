import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Id, SqlExecutor, SqlValue, Transaction } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";
import { hash, newId } from "../../accounts/identity/store";
import { resourceRow, resourceInputs, etag, groupInput, userInput } from "./scim-schema";
import type { ResourceRow, ScimKind } from "./scim-schema";
import type { FederationConfigurations } from "./configuration";
import type { FederationProvisioning } from "./provisioning";

export class ScimStore {
  constructor(readonly context: ModuleContext, readonly configurations: FederationConfigurations,
    readonly provisioning: FederationProvisioning) {}
  async authenticate(request: Request, tx: Transaction) {
    const authorization = request.headers.get("authorization") ?? "";
    if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) throw new ServiceError("SCIM_UNAUTHORIZED", 401, "SCIM bearer token required");
    if (!await tx.get("SELECT id FROM federation_tokens WHERE token_hash=? AND revoked_at IS NULL", [hash(authorization.slice(7))])) {
      throw new ServiceError("SCIM_UNAUTHORIZED", 401, "SCIM bearer token is invalid or revoked");
    }
    const config = await this.configurations.get(tx);
    if (!this.configurations.capability(config).enabled) throw new ServiceError("SCIM_UNCONFIGURED", 503, this.configurations.capability(config).reason ?? "Federation disabled");
    return config.config;
  }
  async get(db: SqlExecutor, input: { readonly kind: ScimKind; readonly id: Id }): Promise<ResourceRow> {
    const value = await db.get("SELECT * FROM federation_resources WHERE kind=? AND id=? AND deleted_at IS NULL", [input.kind, input.id]);
    if (!value) throw new ServiceError("SCIM_NOT_FOUND", 404, "SCIM resource not found");
    return resourceRow.parse(value);
  }
  resource(row: ResourceRow) {
    const data = resourceInputs[row.kind].parse(JSON.parse(row.data_json));
    return { ...data, id: row.id, meta: { resourceType: { Users: "User", Groups: "Group" }[row.kind],
      created: row.created_at, lastModified: row.updated_at, version: etag(row.version),
      location: new URL(`/scim/v2/${row.kind}/${row.id}`, this.context.config.publicUrl).href } };
  }
  async save(tx: Transaction, input: { readonly row: ResourceRow; readonly data: z.infer<typeof userInput> | z.infer<typeof groupInput>; readonly deleted?: boolean }) {
    const now = this.context.clock.now();
    await tx.run("UPDATE federation_resources SET data_json=?,version=version+1,updated_at=?,deleted_at=? WHERE id=?",
      [JSON.stringify(input.data), now, input.deleted ? now : null, input.row.id]);
    const next = { ...input.row, data_json: JSON.stringify(input.data), version: input.row.version + 1,
      updated_at: now, deleted_at: input.deleted ? now : null };
    await this.audit(tx, { event: input.deleted ? "scim.deleted" : "scim.updated", id: input.row.id });
    return next;
  }
  async audit(tx: Transaction, input: { readonly event: string; readonly id: Id }) {
    await tx.run("INSERT INTO audit_entries(id,at,event,target_id,details_json) VALUES(?,?,?,?,?)",
      [newId(), this.context.clock.now(), input.event, input.id, "{}"]);
  }
  async groups(tx: Transaction, resourceId: Id): Promise<readonly string[]> {
    const rows = await tx.all("SELECT g.data_json FROM federation_resources g JOIN federation_members m ON m.group_id=g.id WHERE m.resource_id=? AND g.deleted_at IS NULL", [resourceId]);
    return rows.map((value) => groupInput.parse(JSON.parse(z.object({ data_json: z.string() }).parse(value).data_json)).displayName);
  }
  async reconcile(tx: Transaction, resourceId: Id) {
    const row = await this.get(tx, { kind: "Users", id: resourceId });
    if (!row.user_id || !userInput.parse(JSON.parse(row.data_json)).active) return;
    const { config } = await this.configurations.get(tx);
    await this.provisioning.apply(tx, { userId: row.user_id, config, groups: await this.groups(tx, row.id) });
  }
  async list(tx: Transaction, input: { readonly kind: ScimKind; readonly request: Request }) {
    const query = new URL(input.request.url).searchParams;
    const paging = z.object({ startIndex: z.coerce.number().int().positive(), count: z.coerce.number().int().min(0).max(200) })
      .parse({ startIndex: query.get("startIndex") ?? 1, count: query.get("count") ?? 50 });
    const filter = query.get("filter");
    let predicate = "kind=? AND deleted_at IS NULL";
    const parameters: SqlValue[] = [input.kind];
    if (filter) {
      const parsed = /^(id|externalId|userName|displayName|active) eq ("(?:[^"\\]|\\.)*"|true|false)$/.exec(filter);
      if (!parsed?.[1] || !parsed[2]) throw new ServiceError("SCIM_FILTER_INVALID", 400, "Supported filter: id, externalId, userName, displayName or active eq a JSON literal");
      const key = z.enum(["id", "externalId", "userName", "displayName", "active"]).parse(parsed[1]);
      const expected: unknown = JSON.parse(parsed[2]);
      switch (key) {
        case "active": {
          const value = z.boolean().parse(expected);
          predicate += tx.dialect === "postgres" ? " AND data_json::jsonb->>'active'=?" : " AND json_extract(data_json,'$.active')=?";
          parameters.push(tx.dialect === "postgres" ? String(value) : value ? 1 : 0);
          break;
        }
        case "id": predicate += " AND id=?"; parameters.push(z.string().parse(expected)); break;
        case "externalId": predicate += " AND external_id=?"; parameters.push(z.string().parse(expected)); break;
        case "userName": case "displayName": {
          const expression = tx.dialect === "postgres" ? `data_json::jsonb->>'${key}'` : `json_extract(data_json,'$.${key}')`;
          predicate += ` AND lower(${expression})=lower(?)`;
          parameters.push(z.string().parse(expected));
          break;
        }
        default: {
          const unreachable: never = key;
          throw new ServiceError("SCIM_FILTER_INVALID", 400, String(unreachable));
        }
      }
    }
    const total = z.object({ count: z.coerce.number().int().nonnegative() }).parse(
      await tx.get(`SELECT COUNT(*) AS count FROM federation_resources WHERE ${predicate}`, parameters));
    const rows = (await tx.all(`SELECT * FROM federation_resources WHERE ${predicate} ORDER BY id LIMIT ? OFFSET ?`,
      [...parameters, paging.count, paging.startIndex - 1])).map((row) => resourceRow.parse(row));
    return { totalResults: total.count, startIndex: paging.startIndex, itemsPerPage: rows.length,
      Resources: rows.map((row) => this.resource(row)) };
  }
  async insert(tx: Transaction, input: {
    readonly kind: ScimKind; readonly userId: Id | null; readonly data: z.infer<typeof userInput> | z.infer<typeof groupInput>;
  }) {
    const now = this.context.clock.now();
    const row: ResourceRow = { id: newId(), kind: input.kind, user_id: input.userId,
      external_id: input.data.externalId, data_json: JSON.stringify(input.data), created_at: now, updated_at: now, version: 0, deleted_at: null };
    await tx.run(`INSERT INTO federation_resources(id,kind,external_id,data_json,user_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?)`, [row.id, row.kind, row.external_id, row.data_json, row.user_id, now, now]);
    await this.audit(tx, { event: "scim.created", id: row.id });
    return row;
  }
  async existing(tx: Transaction, input: { readonly kind: ScimKind; readonly externalId: string }) {
    const value = await tx.get("SELECT * FROM federation_resources WHERE kind=? AND external_id=?", [input.kind, input.externalId]);
    return value ? resourceRow.parse(value) : null;
  }
}
export function scimId(request: Request): Id { return IdSchema.parse(new URL(request.url).pathname.split("/").at(-1)); }
