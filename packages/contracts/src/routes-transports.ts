import { z } from "zod";
import { routesFor, none, noBody, list, version, key } from "./route-builders";
import { IdSchema as id, InstantSchema, CountSchema, OkSchema, pageSchema } from "./primitives";
import { IdParamsSchema as ids, BytesSchema, ProjectParamsSchema, BranchQuerySchema } from "./endpoint";
const a = routesFor("A");
const k = routesFor("K");
const scimResource = z.object({
  schemas: z.array(z.string()), id: z.string(), externalId: z.string().optional(),
  userName: z.string().optional(), displayName: z.string().optional(), active: z.boolean().optional(),
  name: z.object({ givenName: z.string().optional(), familyName: z.string().optional() }).optional(),
  emails: z.array(z.object({ value: z.email(), primary: z.boolean().optional(), type: z.string().optional() })).optional(),
  members: z.array(z.object({ value: z.string(), display: z.string().optional() })).optional(),
  meta: z.object({ resourceType: z.string(), created: InstantSchema, lastModified: InstantSchema, version: z.string(), location: z.string() }).optional(),
});
export const transportEndpoints = {
  gitTokensList: a("GET", "/api/me/git-tokens", { params: none, query: list, body: noBody, output: pageSchema(z.strictObject({ id, name: z.string(), expiresAt: InstantSchema, createdAt: InstantSchema, version: CountSchema })) }),
  gitTokenCreate: a("POST", "/api/me/git-tokens", { params: none, query: none, body: z.strictObject({ name: z.string(), expiresAt: InstantSchema }), output: z.strictObject({ id, secretOnce: z.string() }), ...key }),
  gitTokenDelete: a("DELETE", "/api/me/git-tokens/:id", { params: ids, query: none, body: z.strictObject(version), output: OkSchema }),
  sshKeysList: a("GET", "/api/me/ssh-keys", { params: none, query: list, body: noBody, output: pageSchema(z.strictObject({ id, name: z.string(), publicKey: z.string(), version: CountSchema })) }),
  sshKeyGet: a("GET", "/api/me/ssh-keys/:id", { params: ids, query: none, body: noBody, output: z.strictObject({ id, name: z.string(), publicKey: z.string(), version: CountSchema }) }),
  sshKeyCreate: a("POST", "/api/me/ssh-keys", { params: none, query: none, body: z.strictObject({ name: z.string(), publicKey: z.string() }), output: z.strictObject({ id, name: z.string(), publicKey: z.string(), version: CountSchema }), ...key }),
  sshKeyPatch: a("PATCH", "/api/me/ssh-keys/:id", { params: ids, query: none, body: z.strictObject({ name: z.string().optional(), publicKey: z.string().optional(), ...version }), output: z.strictObject({ id, name: z.string(), publicKey: z.string(), version: CountSchema }) }),
  sshKeyDelete: a("DELETE", "/api/me/ssh-keys/:id", { params: ids, query: none, body: z.strictObject(version), output: OkSchema }),
  gitHttpGet: k("GET", "/git/:p.git/*", { params: z.strictObject({ p: id, wildcard: z.string() }), query: z.object({ service: z.enum(["git-upload-pack", "git-receive-pack"]).optional() }), body: noBody, output: BytesSchema, transport: "bytes" }),
  gitHttpPost: k("POST", "/git/:p.git/*", { params: z.strictObject({ p: id, wildcard: z.string() }), query: none, body: BytesSchema, output: BytesSchema, transport: "bytes" }),
  realtime: k("GET", "/api/projects/:p/realtime", { params: ProjectParamsSchema, query: BranchQuerySchema, body: noBody, output: z.never(), transport: "websocket" }),
  events: k("GET", "/api/events", { params: none, query: z.strictObject({ after: z.coerce.number().int().nonnegative().default(0) }), body: noBody, output: z.never(), transport: "sse" }),
  scimUsersList: a("GET", "/scim/v2/Users", { params: none, query: z.object({ startIndex: z.coerce.number().int().positive().default(1), count: z.coerce.number().int().min(0).max(200).default(50), filter: z.string().optional() }), body: noBody, output: z.strictObject({ schemas: z.array(z.string()), totalResults: CountSchema, startIndex: CountSchema, itemsPerPage: CountSchema, Resources: z.array(scimResource) }) }),
  scimUserCreate: a("POST", "/scim/v2/Users", { params: none, query: none, body: scimResource.omit({ id: true, meta: true }), output: scimResource }),
  scimUserGet: a("GET", "/scim/v2/Users/:id", { params: ids, query: none, body: noBody, output: scimResource }),
  scimUserPatch: a("PATCH", "/scim/v2/Users/:id", { params: ids, query: none, body: z.strictObject({ schemas: z.array(z.string()), Operations: z.array(z.strictObject({ op: z.enum(["add", "remove", "replace"]), path: z.string().optional(), value: z.unknown().optional() })) }), output: scimResource, ifMatch: true }),
  scimUserDelete: a("DELETE", "/scim/v2/Users/:id", { params: ids, query: none, body: noBody, output: OkSchema, ifMatch: true }),
  scimGroupsList: a("GET", "/scim/v2/Groups", { params: none, query: z.object({ startIndex: z.coerce.number().int().positive().default(1), count: z.coerce.number().int().min(0).max(200).default(50), filter: z.string().optional() }), body: noBody, output: z.strictObject({ schemas: z.array(z.string()), totalResults: CountSchema, startIndex: CountSchema, itemsPerPage: CountSchema, Resources: z.array(scimResource) }) }),
  scimGroupCreate: a("POST", "/scim/v2/Groups", { params: none, query: none, body: scimResource.omit({ id: true, meta: true }), output: scimResource }),
  scimGroupGet: a("GET", "/scim/v2/Groups/:id", { params: ids, query: none, body: noBody, output: scimResource }),
  scimGroupPatch: a("PATCH", "/scim/v2/Groups/:id", { params: ids, query: none, body: z.strictObject({ schemas: z.array(z.string()), Operations: z.array(z.strictObject({ op: z.enum(["add", "remove", "replace"]), path: z.string().optional(), value: z.unknown().optional() })) }), output: scimResource, ifMatch: true }),
  scimGroupDelete: a("DELETE", "/scim/v2/Groups/:id", { params: ids, query: none, body: noBody, output: OkSchema, ifMatch: true }),
} as const;
