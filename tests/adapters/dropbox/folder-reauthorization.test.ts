import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema, OperationSchema } from "@quire/contracts";
import { DropboxFolderImportSchema } from "../../../packages/contracts/src/routes-adapters";
import { dropboxServer } from "./provider";
import { dropboxFixture } from "./harness";

for (const changed of ["grant", "configuration"] as const) {
  test(`explicit reauthorization resumes the same prepared import after ${changed} version changes`, async () => {
    // Given: an unpublished immutable import followed by a legitimate monotonic authority change.
    await using provider = dropboxServer();
    const folder = provider.mkdir("/Reauthorize");
    const text = "\\documentclass{article}\n\\begin{document}Prepared source\\end{document}\n";
    provider.put("/Reauthorize/main.tex", text);
    await using harness = await dropboxFixture(provider);
    const parameters = { folderId: folder.id, name: "Reauthorized import", mainPath: "main.tex" };
    const request = async (action: string, confirmation?: boolean) => {
      const grant = z.object({ version: z.number() }).parse(await harness.fixture.runtime.db.get(
        "SELECT version FROM provider_grants WHERE id=?", [harness.grant.id]));
      return harness.fixture.request(`/api/connections/${harness.grant.id}/actions`, {
        method: "POST", headers: { ...harness.owner.headers, "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ action, parameters: { ...parameters, ...(confirmation === undefined ? {} : { confirmation }) },
          expectedVersion: grant.version, expectedCursor: null }),
      });
    };
    await harness.fixture.runtime.db.exec(`CREATE TRIGGER deny_reauthorization_receipt BEFORE UPDATE ON operations
      WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'owned interrupted import'); END;`);
    expect((await request("importFolder")).status).toBe(502);
    await harness.fixture.runtime.db.exec("DROP TRIGGER deny_reauthorization_receipt");
    const saved = z.object({ project_id: IdSchema, payload_json: z.string() }).parse(
      await harness.fixture.runtime.db.get("SELECT project_id,payload_json FROM dropbox_folder_imports"));
    if (changed === "grant") await harness.fixture.runtime.db.run(
      "UPDATE provider_grants SET version=version+1 WHERE id=?", [harness.grant.id]);
    else await harness.fixture.runtime.db.run("UPDATE adapter_provider_configs SET version=version+1 WHERE kind='dropbox'");
    await harness.restart();
    expect(harness.integration.recoveryFailures).toHaveLength(1);
    expect(await harness.fixture.runtime.db.get("SELECT id FROM projects WHERE id=?", [saved.project_id])).toBeNull();
    const automatic = await request("importFolder");
    expect(automatic.status).toBe(409);
    expect(z.object({ error: z.object({ code: z.string() }) }).parse(await automatic.json()).error.code).toBe("DROPBOX_AUTHORITY_CHANGED");
    expect(await harness.fixture.runtime.db.get("SELECT payload_json FROM dropbox_folder_imports"))
      .toEqual({ payload_json: saved.payload_json });
    expect((await request("reauthorizeFolderImport")).status).toBe(400);
    expect((await request("reauthorizeFolderImport", false)).status).toBe(400);
    await harness.fixture.runtime.db.exec(`CREATE TRIGGER deny_reauthorization_receipt BEFORE UPDATE ON operations
      WHEN NEW.kind='dropbox.reauthorizeFolderImport' AND NEW.status='succeeded'
      BEGIN SELECT RAISE(ABORT,'owned failed explicit reauthorization'); END;`);
    expect((await request("reauthorizeFolderImport", true)).status).toBe(502);
    await harness.fixture.runtime.db.exec("DROP TRIGGER deny_reauthorization_receipt");
    await harness.restart();
    expect(harness.integration.recoveryFailures).toHaveLength(1);
    expect(await harness.fixture.runtime.db.get("SELECT id FROM projects WHERE id=?", [saved.project_id])).toBeNull();
    expect(await harness.fixture.runtime.db.get("SELECT payload_json FROM dropbox_folder_imports"))
      .toEqual({ payload_json: saved.payload_json });

    // When: the current owner explicitly confirms publication of the previously prepared snapshot.
    const resumed = await request("reauthorizeFolderImport", true);
    const body: unknown = await resumed.json();
    console.info("DROPBOX_REAUTHORIZE", JSON.stringify({ changed, status: resumed.status, body, root: harness.fixture.path }));
    expect(resumed.status, JSON.stringify(body)).toBe(202);
    const operation = z.object({ data: OperationSchema }).parse(body).data;
    const result = DropboxFolderImportSchema.parse(operation.result);

    // Then: one original project identity is published and ordinary retry/restart does not duplicate it.
    expect(result.projectId).toBe(saved.project_id);
    const project = await harness.fixture.service.getProject(result.projectId);
    expect((await harness.fixture.service.readDocument({ projectId: project.id, branch: "main" }, project.settings.mainFileId)).text).toBe(text);
    await harness.restart();
    expect(harness.integration.recoveryFailures).toEqual([]);
    expect(await harness.fixture.runtime.db.all("SELECT id FROM projects WHERE name='Reauthorized import'")).toHaveLength(1);
    expect(await harness.fixture.runtime.db.all("SELECT * FROM dropbox_folder_bindings")).toHaveLength(1);
    expect(await harness.fixture.runtime.db.all("SELECT * FROM dropbox_folder_imports")).toHaveLength(0);
  });
}
