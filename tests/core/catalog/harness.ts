import { z } from "zod";
import { createRuntime, loadConfig } from "@quire/runtime";
import { InstantSchema, UserSchema, ProjectSchema, LibraryEntrySchema, TemplateVersionSchema, FileEntrySchema } from "@quire/contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { register as base, migrations as baseMigrations, CoreProjects } from "../../../services/core/base";
import { register as identity, migrations as identityMigrations } from "../../../services/accounts/identity";
import { register, migrations } from "../../../services/core/catalog";
import { seed } from "../../../scripts/seed";

export const entryEnvelope = z.object({ data: LibraryEntrySchema });
export const templateEnvelope = z.object({ data: TemplateVersionSchema });
export const fileEnvelope = z.object({ data: FileEntrySchema });
export const projectEnvelope = z.object({ data: ProjectSchema });
export const errorEnvelope = z.object({ error: z.object({ code: z.string() }) });
export const bib = "@article{first, title={An {Actual} Uploaded Source}, author={Nguyen, Kien}, year={2026}}";
export const secondBib = '@book{second, title="Independent Second Record", year=2025}';
export const publication = { provider: "manual", providerId: "first", title: "An Actual Uploaded Source",
  authors: ["Kien Nguyen"], year: 2026, doi: null, url: null, bibtex: bib };
const password = "catalog-test-password-2026";
export async function catalogFixture() {
  const path = await mkdtemp(join(tmpdir(), "quire-catalog-"));
  const config = loadConfig({ QUIRE_DATA_DIR: path });
  const modules = [
    { id: "010-a-identity", lane: "A", order: 10, register: identity, migrations: identityMigrations },
    { id: "021-k-base", lane: "K", order: 21, register: base, migrations: baseMigrations },
    { id: "024-k-catalog", lane: "K", order: 24, register, migrations },
  ] as const;
  const clock = { now: () => InstantSchema.parse("2026-10-26T12:00:00.000Z") };
  let runtime = await createRuntime(config, { modules, clock });
  await seed(runtime, password);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => runtime.routes.fetch(request) });
  const request = (route: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("origin", "http://localhost:5173");
    if (typeof init.body === "string") headers.set("content-type", "application/json");
    return fetch(new URL(route, server.url), { ...init, headers, signal: AbortSignal.timeout(15000) });
  };
  async function login(email = "kien@quire.local") {
    const result = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    const user = z.object({ data: UserSchema }).parse(await result.json()).data;
    const cookie = result.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new TypeError("Expected login cookie");
    const me = await request("/api/me", { headers: { cookie } });
    const csrf = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken;
    return { user, headers: { cookie, "x-csrf-token": csrf } };
  }
  const mutate = (route: string, headers: HeadersInit, body: unknown) => request(route, {
    method: "POST", headers: { ...Object.fromEntries(new Headers(headers)), "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body),
  });
  return {
    request, login, mutate,
    get runtime() { return runtime; },
    get service() {
      const service = runtime.services.get("projects");
      if (!(service instanceof CoreProjects)) throw new TypeError("Expected native source service");
      return service;
    },
    async create(headers: HeadersInit, name = "Catalog source") {
      return projectEnvelope.parse(await (await mutate("/api/projects", headers, { name, origin: { kind: "blank" } })).json()).data;
    },
    async restart() { runtime.close(); runtime = await createRuntime(config, { modules, clock }); },
    [Symbol.asyncDispose]: async () => { await server.stop(true); runtime.close(); await rm(path, { recursive: true, force: true }); },
  };
}
