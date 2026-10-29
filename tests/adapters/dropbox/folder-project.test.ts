import { expect, test } from "bun:test";
import { z } from "zod";
import { OperationSchema } from "@quire/contracts";
import { DropboxFolderImportSchema, DropboxFolderInspectionSchema, DropboxFoldersResultSchema } from "../../../packages/contracts/src/routes-adapters";
import { dropboxServer } from "./provider";
import { bounded, dropboxFixture, remotePath } from "./harness";
import { fixtureIds } from "../../fixtures/foundation";
import { localChange } from "./local";

type Harness = Awaited<ReturnType<typeof dropboxFixture>>;
const text = "\\documentclass{article}\n\\begin{document}Original Dropbox source\\end{document}\n";
const binary = new Uint8Array([0, 1, 255, 128, 42]);
async function request(harness: Harness, action: string, parameters: Record<string, string> = {}, key: string = crypto.randomUUID()) {
  const response = await harness.fixture.request(`/api/connections/${harness.grant.id}/actions`, {
    method: "POST", headers: { ...harness.owner.headers, "idempotency-key": key },
    body: JSON.stringify({ action, parameters, expectedVersion: harness.grant.version, expectedCursor: null }),
  });
  const body: unknown = await response.json();
  console.info("DROPBOX_FOLDER_REQUEST", JSON.stringify({
    root: harness.fixture.path, api: harness.fixture.origin, action, key, status: response.status, body,
  }));
  return { status: response.status, body };
}
async function success(harness: Harness, action: string, parameters: Record<string, string> = {}, key?: string) {
  const response = await request(harness, action, parameters, key);
  expect(response.status).toBe(202);
  return z.object({ data: OperationSchema }).parse(response.body).data;
}
const selection = (folderId: string) => ({ folderId, name: "Imported research", mainPath: "paper/main.tex" });
function populate(provider: ReturnType<typeof dropboxServer>) {
  const folder = provider.mkdir("/Research");
  provider.put("/Research/paper/main.tex", text);
  provider.put("/Research/paper/section.tex", "Nested section");
  provider.putBytes("/Research/images/figure.bin", binary);
  provider.put("/Research/.quire-generated/output.tex", "\\documentclass{article} generated");
  provider.put("/Unselected/main.tex", text.replace("Original", "Unselected"));
  return folder;
}
async function counts(harness: Harness) {
  return Promise.all(["projects", "branch_workspaces", "repositories", "files", "snapshots", "dropbox_folder_bindings"]
    .map(table => harness.fixture.runtime.db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)));
}

test("explicit discovery, main selection and persistent original-folder two-way synchronization", async () => {
  await using provider = dropboxServer();
  const folder = populate(provider);
  await using harness = await dropboxFixture(provider);
  const before = await counts(harness);
  const discovered = DropboxFoldersResultSchema.parse((await success(harness, "discoverFolders")).result);
  expect(discovered.folders.find(item => item.id === folder.id)).toEqual({ id: folder.id, path: "/Research", projectId: null });
  const inspected = DropboxFolderInspectionSchema.parse((await success(harness, "inspectFolder", { folderId: folder.id })).result);
  expect(inspected.mainPaths).toEqual(["paper/main.tex"]);
  expect(await counts(harness)).toEqual(before);
  const result = DropboxFolderImportSchema.parse((await success(harness, "importFolder", selection(folder.id))).result);
  const project = await harness.fixture.service.getProject(result.projectId);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const files = await harness.fixture.service.listFiles(scope);
  expect(files.filter(file => file.kind === "file").map(file => file.path).sort())
    .toEqual(["images/figure.bin", "paper/main.tex", "paper/section.tex"]);
  expect((await harness.fixture.service.readDocument(scope, project.settings.mainFileId)).text).toBe(text);
  const image = files.find(file => file.path === "images/figure.bin");
  expect(image?.editable).toBe(false);
  if (!image?.blob) throw new Error("Expected binary blob");
  expect(await harness.fixture.runtime.blobs.get(image.blob)).toEqual(binary);
  await harness.fixture.runtime.repositories.assertReadable(project.id);
  const snapshot = z.object({ id: z.string() }).parse(await harness.fixture.runtime.db.get(
    "SELECT id FROM snapshots WHERE project_id=?", [project.id]));
  expect(new TextDecoder().decode(await harness.fixture.runtime.repositories.read(project.id,
    ["show", `refs/quire/history/${snapshot.id}:paper/main.tex`]))).toBe(text);
  await harness.restart();
  const repeated = DropboxFolderImportSchema.parse((await success(harness, "importFolder", selection(folder.id))).result);
  expect(repeated.projectId).toBe(project.id);
  provider.put("/Research/paper/section.tex", "Remote edit after restart");
  await harness.success("sync", { projectId: project.id });
  const section = (await harness.fixture.service.listFiles(scope)).find(file => file.path === "paper/section.tex");
  if (!section) throw new Error("Expected section");
  expect((await harness.fixture.service.readDocument(scope, section.id)).text).toBe("Remote edit after restart");
  await harness.fixture.service.serialized(scope, async lease => {
    await harness.fixture.service.commitSource({ actorId: harness.owner.user.id, scope, lease,
      expectedRevision: (await harness.fixture.service.getBranch(scope)).revision,
      inputs: (await harness.fixture.service.listFiles(scope)).map(file => file.id === section.id
        ? { file, bytes: new TextEncoder().encode("Local edit sent to original folder") } : { file }) });
  });
  await harness.success("sync", { projectId: project.id });
  expect(provider.text("/Research/paper/section.tex")).toBe("Local edit sent to original folder");
  expect(provider.text(`/${project.id}/paper/section.tex`)).toBeNull();
  expect(provider.writePaths).toContain(`${folder.id}/paper/section.tex`);
  expect(provider.text("/Unselected/main.tex")).toContain("Unselected Dropbox");
  expect(await harness.fixture.runtime.db.get("SELECT folder_id,path FROM dropbox_folder_bindings WHERE project_id=?", [project.id]))
    .toEqual({ folder_id: folder.id, path: "/Research" });
});

test("repeated keys, lost response and concurrent explicit imports create only one project", async () => {
  await using provider = dropboxServer();
  const folder = populate(provider);
  await using harness = await dropboxFixture(provider);
  const key = crypto.randomUUID();
  const barrier = provider.pause("/2/files/download");
  const first = request(harness, "importFolder", selection(folder.id), key);
  await bounded(barrier.entered);
  const concurrent = await request(harness, "importFolder", selection(folder.id));
  expect(concurrent.status).toBe(409);
  barrier.release();
  expect((await first).status).toBe(202);
  // The caller discards the successful response and restarts before retrying the exact key.
  await harness.restart();
  const replay = await success(harness, "importFolder", selection(folder.id), key);
  const repeated = await success(harness, "importFolder", selection(folder.id));
  expect(DropboxFolderImportSchema.parse(replay.result).projectId).toBe(DropboxFolderImportSchema.parse(repeated.result).projectId);
  expect(await harness.fixture.runtime.db.all("SELECT * FROM dropbox_folder_bindings")).toHaveLength(1);
  expect(await harness.fixture.runtime.db.all("SELECT * FROM dropbox_folder_imports")).toHaveLength(0);
  expect(await harness.fixture.runtime.db.all("SELECT id FROM projects WHERE name='Imported research'")).toHaveLength(1);
});

test("publication rollback exposes no project or binding and restart reconciles original receipt", async () => {
  await using provider = dropboxServer();
  const folder = populate(provider);
  await using harness = await dropboxFixture(provider);
  const before = await counts(harness);
  const key = crypto.randomUUID();
  await harness.fixture.runtime.db.exec(`CREATE TRIGGER fail_folder_publication BEFORE UPDATE ON operations
    WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'injected folder publication rollback'); END;`);
  expect((await request(harness, "importFolder", selection(folder.id), key)).status).toBe(502);
  expect(await counts(harness)).toEqual(before);
  expect(await harness.fixture.runtime.db.get("SELECT status,result_json FROM operations WHERE idempotency_key=?", [key]))
    .toEqual({ status: "failed", result_json: null });
  expect(await harness.fixture.runtime.db.get("SELECT 1 FROM adapter_cursors WHERE action='importFolder'")).toBeNull();
  const prepared = await harness.fixture.runtime.db.get<{ project_id: string }>("SELECT project_id FROM dropbox_folder_imports");
  if (!prepared) throw new Error("Durable prepared reservation required");
  await harness.fixture.runtime.db.exec("DROP TRIGGER fail_folder_publication");
  await harness.restart();
  expect(harness.integration.recoveryFailures).toEqual([]);
  const result = DropboxFolderImportSchema.parse((await success(harness, "importFolder", selection(folder.id), key)).result);
  expect(String(result.projectId)).toBe(prepared.project_id);
  expect(result.recovered).toBe(true);
  expect(await harness.fixture.runtime.db.all("SELECT * FROM dropbox_folder_bindings")).toHaveLength(1);
});

for (const authority of ["policy", "grant", "configuration", "actor"] as const) {
  test(`revalidates ${authority} after provider download before project publication`, async () => {
    await using provider = dropboxServer();
    const folder = populate(provider);
    await using harness = await dropboxFixture(provider);
    const before = await counts(harness);
    const barrier = provider.pause("/2/files/get_metadata", 2);
    const pending = request(harness, "importFolder", selection(folder.id));
    await bounded(barrier.entered);
    if (authority === "policy") await harness.integration.policies.set({
      actorId: harness.owner.user.id, scope: { kind: "organization", id: fixtureIds.team }, enabled: false, expectedVersion: 0,
    });
    if (authority === "grant") await harness.fixture.runtime.db.run("UPDATE provider_grants SET state='disabled',version=version+1 WHERE id=?", [harness.grant.id]);
    if (authority === "configuration") await harness.fixture.runtime.db.run("UPDATE adapter_provider_configs SET enabled=0,version=version+1 WHERE kind='dropbox'");
    if (authority === "actor") await harness.fixture.runtime.db.run("UPDATE users SET suspended=1 WHERE id=?", [harness.owner.user.id]);
    barrier.release();
    expect((await pending).status).not.toBe(202);
    expect(await counts(harness)).toEqual(before);
    await harness.restart();
    expect(await counts(harness)).toEqual(before);
    expect(harness.integration.recoveryFailures).toHaveLength(1);
  });
}

test("rejects empty, binary-only, invalid, unsupported and wrong-main folders without creation", async () => {
  await using provider = dropboxServer();
  const empty = provider.mkdir("/Empty"), binaryOnly = provider.mkdir("/Binary"), invalid = provider.mkdir("/Invalid");
  provider.putBytes("/Binary/main.tex", binary);
  provider.put("/Invalid/../escape.tex", text);
  const unsupported = provider.mkdir("/Cloud");
  provider.put("/Cloud/main.tex", text);
  provider.alterMetadata("/Cloud/main.tex", { is_downloadable: false });
  const valid = populate(provider);
  await using harness = await dropboxFixture(provider);
  const before = await counts(harness);
  for (const folder of [empty, binaryOnly, invalid, unsupported]) {
    expect((await request(harness, "inspectFolder", { folderId: folder.id })).status).not.toBe(202);
  }
  expect((await request(harness, "importFolder", { ...selection(valid.id), mainPath: "images/figure.bin" })).status).toBe(422);
  expect(await counts(harness)).toEqual(before);
  // A corrected selection can reuse the reservation safely rather than poisoning the directory.
  await success(harness, "importFolder", selection(valid.id));
});

test("enforces metadata byte and entry limits before downloading or publishing", async () => {
  await using provider = dropboxServer();
  const oversized = provider.mkdir("/Oversized"), crowded = provider.mkdir("/Crowded");
  provider.put("/Oversized/main.tex", text);
  provider.alterMetadata("/Oversized/main.tex", { size: 50 * 1024 * 1024 + 1 });
  for (let i = 0; i < 181; i++) provider.put(`/Crowded/${i}.tex`, text);
  await using harness = await dropboxFixture(provider);
  const before = await counts(harness);
  for (const folder of [oversized, crowded]) {
    expect((await request(harness, "inspectFolder", { folderId: folder.id })).status).toBe(413);
  }
  expect(provider.observed.filter(path => path === "/2/files/download")).toHaveLength(0);
  expect(await counts(harness)).toEqual(before);
});

test("a replacement directory cannot silently inherit the original folder binding", async () => {
  await using provider = dropboxServer();
  const folder = populate(provider);
  await using harness = await dropboxFixture(provider);
  const imported = DropboxFolderImportSchema.parse((await success(harness, "importFolder", selection(folder.id))).result);
  provider.remove("/Research");
  provider.put("/Research/paper/main.tex", text.replace("Original", "Replacement"));
  expect((await harness.action("sync", { projectId: imported.projectId })).status).toBe(409);
  expect(provider.text("/Research/paper/main.tex")).toContain("Replacement");
});

test("ID-relative writes cannot land in a replacement folder created during sync", async () => {
  await using provider = dropboxServer();
  const folder = populate(provider);
  await using harness = await dropboxFixture(provider);
  const imported = DropboxFolderImportSchema.parse((await success(harness, "importFolder", selection(folder.id))).result);
  const project = await harness.fixture.service.getProject(imported.projectId);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  await harness.fixture.service.serialized(scope, async lease => {
    await harness.fixture.service.commitSource({ actorId: harness.owner.user.id, scope, lease,
      expectedRevision: (await harness.fixture.service.getBranch(scope)).revision,
      inputs: (await harness.fixture.service.listFiles(scope)).map(file => file.id === project.settings.mainFileId
        ? { file, bytes: new TextEncoder().encode(text + "% Local change") } : { file }) });
  });
  const barrier = provider.pause("/2/files/upload");
  const syncing = harness.action("sync", { projectId: project.id });
  await bounded(barrier.entered);
  provider.remove("/Research");
  provider.put("/Research/paper/main.tex", text + "% Replacement folder");
  barrier.release();
  expect((await syncing).status).toBe(409);
  expect(provider.text("/Research/paper/main.tex")).toBe(text + "% Replacement folder");
  expect(provider.writePaths.at(-1)).toBe(`${folder.id}/paper/main.tex`);
});

test("stale grants and deny-wins policy reject new-folder actions before provider I/O", async () => {
  await using provider = dropboxServer();
  const folder = populate(provider);
  await using harness = await dropboxFixture(provider);
  await harness.integration.policies.set({
    actorId: harness.owner.user.id, scope: { kind: "organization", id: fixtureIds.team }, enabled: false, expectedVersion: 0,
  });
  const before = provider.observed.length;
  expect((await request(harness, "discoverFolders")).status).toBe(403);
  expect((await request(harness, "importFolder", selection(folder.id))).status).toBe(403);
  expect(provider.observed.length).toBe(before);
  await harness.fixture.runtime.db.run("UPDATE provider_grants SET version=version+1 WHERE id=?", [harness.grant.id]);
  expect((await request(harness, "discoverFolders")).status).toBe(409);
  expect(provider.observed.length).toBe(before);
  expect(await harness.fixture.runtime.db.all("SELECT * FROM dropbox_folder_bindings")).toHaveLength(0);
});

test("ordinary UUID enrollment retains its original root after folder import is introduced", async () => {
  await using provider = dropboxServer();
  await using harness = await dropboxFixture(provider);
  await harness.success("initialSync");
  await localChange(harness, { path: "uuid.txt", text: "UUID enrollment still works" });
  await harness.success("sync");
  expect(provider.text(remotePath("uuid.txt"))).toBe("UUID enrollment still works");
  const folders = DropboxFoldersResultSchema.parse((await success(harness, "discoverFolders")).result).folders;
  const enrolled = folders.find(folder => folder.projectId === fixtureIds.project);
  if (!enrolled) throw new Error("Existing UUID enrollment must be discoverable as its original project");
  const before = await counts(harness);
  expect((await request(harness, "importFolder", { folderId: enrolled.id, name: "Must not duplicate", mainPath: "main.tex" })).status).toBe(409);
  expect(await counts(harness)).toEqual(before);
  expect(await harness.fixture.runtime.db.all("SELECT * FROM dropbox_folder_bindings")).toHaveLength(0);
});
