import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { EnvironmentSchema } from "@quire/contracts";
import { nativeInstallation, origin, password } from "./native-fixture";
import { installationScaleResources } from "./scale-resources";
import { assertRestoredInventory } from "./restored-inventory";
import { InstallationStateSchema } from "../../../services/operations/installation/model";

for (const dialect of ["sqlite", "postgres"] as const) {
  test(`restored ${dialect} SQL blobs and Git match the signed archive before role activation`, async () => {
    await using services = dialect === "postgres" ? await installationScaleResources() : undefined;
    const environment = services ? z.array(EnvironmentSchema).parse(JSON.parse(await readFile(
      "docs/evidence/p2o-environments/worker-environments.json", "utf8")))[0] : undefined;
    if (services && !environment) throw new Error("Missing accepted scale worker environment");
    const proof = Promise.withResolvers<Awaited<ReturnType<typeof assertRestoredInventory>>>();
    void proof.promise.catch(() => undefined);
    await using owned = await nativeInstallation({
      candidatePortConflict: true,
      ...(services && environment ? { scale: services, workerEnvironment: environment } : {}),
      async onRestoredHealth({ controlRoot, operationId, binding }) {
        try {
          expect(binding.data.dialect).toBe(dialect);
          const inventory = await assertRestoredInventory(controlRoot, operationId, binding);
          console.info("INSTALLATION_RESTORED_INVENTORY", { dialect, operationId, binding, inventory });
          proof.resolve(inventory);
        } catch (error) { proof.reject(error); throw error; }
      },
    });
    await owned.start();
    const port = owned.apiPort;
    if (!port) throw new Error("Missing real API listener");
    const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ email: "operator@quire.local", password }), signal: AbortSignal.timeout(10000),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Missing operator session");
    const me = await fetch(`http://127.0.0.1:${port}/api/me`, { headers: { cookie, origin }, signal: AbortSignal.timeout(10000) });
    const csrf = z.object({ data: z.object({ csrfToken: z.string() }) }).parse(await me.json()).data.csrfToken;
    const active = owned.activatedAfter(0);
    const receipt = owned.receiptWhen(row => ["succeeded", "failed"].includes(row.operation.status));
    const finished = Promise.all([proof.promise, receipt, active]);
    void finished.catch(() => undefined);
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/updates`, {
      method: "POST", headers: { cookie, origin, "content-type": "application/json",
        "x-csrf-token": csrf, "idempotency-key": `restored-inventory-${dialect}` },
      body: JSON.stringify({ releaseId: owned.release.id, at: new Date(Date.now() + 60000).toISOString(), autoSecurity: false }),
      signal: AbortSignal.timeout(120000),
    });
    expect(response.status).toBe(202);
    const [inventory, completed] = await finished;
    expect(inventory.tables).toBeGreaterThan(0);
    expect(inventory.blobs).toBeGreaterThan(0);
    expect(inventory.repositories).toBeGreaterThan(0);
    expect(completed.operation.result).toMatchObject({ rolledBack: true });
    const state = InstallationStateSchema.parse(await owned.control({ method: "status", input: {} }));
    expect(state.mode).toBe("open");
    expect(state.binding.data.generationId).not.toBe(owned.prior.data.generationId);
  }, 600000);
}
