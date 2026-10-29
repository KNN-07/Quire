import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { ExecutionLaunchSchema, ExecutionProfileSchema } from "../../../services/operations/installation/execution-model";
import { canonicalJson, controlDigest } from "../../../services/operations/installation/protocol";
import { ControlError } from "../../../services/operations/installation/model";
import { executionFixture, id, limits } from "../installation/supervisor-execution/fixture";

test("authenticated environment admission maps actual broker denials without publication or hiding unknown failures", async () => {
  await using fixture = await executionFixture();
  if (fixture.prior.data.dialect !== "sqlite") throw new Error("Expected native fixture");
  const dataRoot = fixture.prior.data.dataRoot;
  const releaseRoot = fixture.prior.release.target;
  const metadataPath = join(releaseRoot, "installation-roles.json");
  const inventoryPath = join(releaseRoot, "installation-runtime.json");
  const metadata = z.object({ installationId: z.string(), roles: z.array(z.unknown()),
    executionProfiles: z.array(ExecutionProfileSchema) }).parse(JSON.parse(await readFile(metadataPath, "utf8")));
  const docker = metadata.executionProfiles.find(profile => profile.id === "docker");
  if (!docker) throw new Error("Missing fixture Docker profile");
  // Baseline provisioning only; no live admission or signed release changes.
  const baselineImage = `sha256:${"e".repeat(64)}`;
  const unknownImage = `sha256:${"d".repeat(64)}`;
  const metadataBytes = canonicalJson({ ...metadata, controlSocket: join(fixture.roots.sockets, "control.sock"),
    roles: fixture.config.roles.map(({ role }) => ({
      role, kind: "api", host: "127.0.0.1", port: 1, publicUrl: "http://localhost:5173", compilerBackend: "docker",
    })), executionProfiles: [
    ...metadata.executionProfiles.filter(profile => profile.id !== "docker"),
    { ...docker, id: "api-baseline", image: baselineImage },
    { ...docker, id: "worker-only-image", roles: ["compiler-worker"] },
    { ...docker, id: "source-invalid", image: unknownImage, profile: "restricted" },
    { ...docker, id: "wrong-kind", image: `sha256:${"b".repeat(64)}`, kinds: ["compile"], roles: ["api-a"] },
  ] });
  const built = await Bun.build({ entrypoints: [resolve("tests/operations/environments/admission-role.ts")], target: "bun" });
  if (!built.success || !built.outputs[0]) throw new Error(built.logs.map(log => log.message).join("\n"));
  const roleBytes = await built.outputs[0].text();
  const inventory = z.object({ migrations: z.array(z.unknown()),
    assets: z.array(z.object({ path: z.string(), digest: z.string() })) })
    .parse(JSON.parse(await readFile(inventoryPath, "utf8")));
  for (const [path, bytes] of [[join(releaseRoot, "main.js"), roleBytes], [metadataPath, metadataBytes],
    [inventoryPath, canonicalJson({ ...inventory, assets: inventory.assets.map(asset =>
      asset.path === "main.js" ? { ...asset, digest: controlDigest(roleBytes) } :
      asset.path === "installation-roles.json" ? { ...asset, digest: controlDigest(metadataBytes) } : asset) })]] as const) {
    await chmod(path, 0o600); await writeFile(path, bytes); await chmod(path, 0o400);
  }
  const controller = await fixture.start();
  const unknown = await fixture.role().channel.request("start", {
    requestId: id(), profileId: "source-invalid", limits,
    work: { kind: "environment-metadata", source: { path: fixture.root, digest: "0".repeat(64) } },
  }).then(() => null, (error: unknown) => error);
  expect(unknown).toBeInstanceOf(ControlError);
  expect(unknown).toMatchObject({ code: "CONTROL_EXECUTION_SOURCE_INVALID" });
  const url = new URL(await readFile(join(dataRoot, "api-a-admission-url"), "utf8"));
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("origin", "http://localhost:5173");
    headers.set("content-type", "application/json");
    return fetch(new URL(path, url), { ...init, headers, signal: AbortSignal.timeout(30000) });
  };
  const login = await request("/api/auth/login", { method: "POST",
    body: JSON.stringify({ email: "operator@quire.local", password: "p9-owned-execution-fixture" }) });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Missing authenticated operator cookie");
  const me = await request("/api/me", { headers: { cookie } });
  const csrf = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken;
  const db = new Database(join(dataRoot, "quire.sqlite"), { readonly: true });
  try {
    const snapshot = () => ({
      environments: db.query("SELECT * FROM environments ORDER BY id").all(),
      receipts: db.query("SELECT * FROM environment_receipts ORDER BY environment_id").all(),
      idempotency: db.query("SELECT * FROM idempotency_results WHERE route='environment-create' ORDER BY key").all(),
      audit: db.query("SELECT * FROM audit_entries WHERE event='environment.created' ORDER BY id").all(),
    });
    const before = snapshot();
    const results = [];
    for (const [image, helpers, status, code] of [
      [`sha256:${"f".repeat(64)}`, ["bibtex", "biber", "synctex"], 409, "ENVIRONMENT_EXECUTION_PROFILE_REQUIRED"],
      [fixture.image, ["bibtex", "biber", "synctex"], 403, "ENVIRONMENT_EXECUTION_POLICY_DENIED"],
      [`sha256:${"b".repeat(64)}`, ["bibtex", "biber", "synctex"], 403, "ENVIRONMENT_EXECUTION_POLICY_DENIED"],
      [unknownImage, ["bibtex", "biber", "synctex", "latexminted", "quire-tikz"], 500, "INTERNAL_ERROR"],
    ] as const) {
      const body = JSON.stringify({ manifest: {
        id: crypto.randomUUID(), label: "Denied admission", release: "2025", backend: "docker",
        rootOrImageDigest: image, engines: ["pdflatex", "latex", "xelatex", "lualatex", "plain"],
        helpers, packagesDigest: "0".repeat(64), experimental: true,
      } });
      const key = crypto.randomUUID();
      // Retry the same denied request to prove no success/idempotency publication.
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await request("/api/admin/environments", { method: "POST", body,
          headers: { cookie, "x-csrf-token": csrf, "idempotency-key": key } });
        const raw: unknown = await response.json();
        console.info("P63_API_RESPONSE", canonicalJson({ image, attempt, status: response.status, result: raw }));
        const result = z.object({ error: z.object({ code: z.string(), message: z.string() }) }).parse(raw);
        expect(response.status).toBe(status);
        expect(result.error.code).toBe(code);
        expect(snapshot()).toEqual(before);
        results.push({ image, attempt, status: response.status, ...result.error });
      }
    }
    const records = z.object({ launches: z.array(ExecutionLaunchSchema) }).parse(await controller.request("records", {}));
    expect(records.launches).toEqual([]);
    console.info("P63_API_DENIALS", canonicalJson({ installationId: fixture.config.installationId, root: fixture.root,
      url: url.href, results, publicationUnchanged: true, launches: 0 }));
  } finally { db.close(); }
}, 180000);
