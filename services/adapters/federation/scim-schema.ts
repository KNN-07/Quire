import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";

export const scimSchemas = {
  Users: "urn:ietf:params:scim:schemas:core:2.0:User",
  Groups: "urn:ietf:params:scim:schemas:core:2.0:Group",
  list: "urn:ietf:params:scim:api:messages:2.0:ListResponse",
  patch: "urn:ietf:params:scim:api:messages:2.0:PatchOp",
  error: "urn:ietf:params:scim:api:messages:2.0:Error",
} as const;
export type ScimKind = "Users" | "Groups";
export const userInput = z.strictObject({
  schemas: z.array(z.string()).refine((schemas) => schemas.includes(scimSchemas.Users)),
  externalId: z.string().min(1).max(256), userName: z.string().min(1).max(256),
  displayName: z.string().min(1).max(200).optional(),
  name: z.strictObject({ givenName: z.string().optional(), familyName: z.string().optional() }).optional(),
  active: z.boolean().default(true),
  emails: z.array(z.strictObject({ value: z.email(), primary: z.boolean().optional(), type: z.string().optional() })).optional(),
});
export const groupInput = z.strictObject({
  schemas: z.array(z.string()).refine((schemas) => schemas.includes(scimSchemas.Groups)),
  externalId: z.string().min(1).max(256), displayName: z.string().min(1).max(200),
  members: z.array(z.strictObject({ value: IdSchema, display: z.string().optional() })).default([]),
});
export const resourceInputs = { Users: userInput, Groups: groupInput } satisfies Record<ScimKind, z.ZodType>;
export const resourceRow = z.object({
  id: IdSchema, kind: z.enum(["Users", "Groups"]), external_id: z.string(),
  data_json: z.string(), user_id: IdSchema.nullable(), version: z.number(),
  created_at: z.string(), updated_at: z.string(), deleted_at: z.string().nullable(),
});
export type ResourceRow = z.infer<typeof resourceRow>;
export const patchInput = z.strictObject({
  schemas: z.array(z.string()).refine((schemas) => schemas.includes(scimSchemas.patch)),
  Operations: z.array(z.strictObject({
    op: z.enum(["add", "remove", "replace"]), path: z.string().optional(), value: z.unknown().optional(),
  })).min(1).max(100),
});
export function etag(version: number) { return `W/"${version}"`; }
export function matchVersion(row: ResourceRow, request: Request) {
  if (!request.headers.has("if-match")) throw new ServiceError("SCIM_VERSION_REQUIRED", 428, "If-Match required");
  if (request.headers.get("if-match") !== etag(row.version)) throw new ServiceError("SCIM_VERSION_CONFLICT", 412, "SCIM resource changed");
}
export function patchResource(row: ResourceRow, operations: z.infer<typeof patchInput>["Operations"]) {
  let data = z.record(z.string(), z.unknown()).parse(JSON.parse(row.data_json));
  for (const operation of operations) {
    if (!operation.path) {
      if (operation.op === "remove") throw new ServiceError("SCIM_PATH_REQUIRED", 400, "remove requires a path");
      const value = z.record(z.string(), z.unknown()).parse(operation.value);
      if (Object.keys(value).some((key) => !["displayName", "name", "active", "emails", "members"].includes(key))) {
        throw new ServiceError("SCIM_IMMUTABLE", 400, "Identity and externalId are immutable");
      }
      data = { ...data, ...value };
      continue;
    }
    const memberFilter = /^members\[value eq "([0-9a-f-]+)"\]$/.exec(operation.path);
    if (operation.path === "members" || memberFilter) {
      if (row.kind !== "Groups") throw new ServiceError("SCIM_PATH_INVALID", 400, "Users cannot mutate group membership");
      const current = groupInput.parse(data).members;
      switch (operation.op) {
        case "add": data = { ...data, members: [...current, ...groupInput.shape.members.parse(operation.value)] }; break;
        case "replace": data = { ...data, members: groupInput.shape.members.parse(operation.value) }; break;
        case "remove": data = { ...data, members: memberFilter ? current.filter((member) => member.value !== memberFilter[1]) : [] }; break;
        default: {
          const unreachable: never = operation.op;
          throw new ServiceError("SCIM_OPERATION_INVALID", 400, String(unreachable));
        }
      }
      continue;
    }
    if (!["displayName", "name", "active", "emails"].includes(operation.path)) throw new ServiceError("SCIM_PATH_INVALID", 400, "Unsupported or immutable attribute");
    if (operation.op === "remove") {
      const { [operation.path]: removed, ...remaining } = data;
      if (removed === undefined) throw new ServiceError("SCIM_NO_TARGET", 400, "Attribute does not exist");
      data = remaining;
    } else data = { ...data, [operation.path]: operation.value };
  }
  return resourceInputs[row.kind].parse(data);
}
