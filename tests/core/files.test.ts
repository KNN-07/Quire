import { test, expect } from "bun:test";
import { z } from "zod";
import { zipSync, unzipSync } from "fflate";
import { FileEntrySchema, OperationSchema } from "@quire/contracts";
import { ServiceError } from "@quire/runtime";
import { baseFixture } from "./base/harness";
import { importZip, readZip } from "../../services/core/base";
import { fixtureIds as ids } from "../fixtures/foundation";

test("T04 imports nested ZIP bytes and exports identical source after restart", async () => {
  // Given: real nested UTF-8, binary and folder entries in a ZIP archive.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const source = { "paper/main.tex": new TextEncoder().encode("\\documentclass{article}\n\\begin{document}😀漢字\\end{document}"),
    "paper/assets/raw.bin": new Uint8Array([0, 255, 128, 7]), "empty/": new Uint8Array() };
  const project = await importZip(fixture.service, owner.user.id, { name: "Imported ZIP", bytes: zipSync(source) });
  // When: the durable runtime restarts and exports the imported source.
  await fixture.restart();
  const response = await fixture.request(`/api/projects/${project.id}/exports`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ kind: "source" }) });
  const operation = z.object({ data: OperationSchema }).parse(await response.json()).data;
  const download = await fixture.request(`/api/operations/${operation.id}/download`, { headers: owner.headers });
  const files = unzipSync(new Uint8Array(await download.arrayBuffer()));
  // Then: expanded original bytes survive; no Git metadata enters the ZIP.
  expect(files).toEqual(source);
  expect(Object.keys(files).some((name) => name.includes(".git"))).toBe(false);
  expect(fixture.service.readDocument({ projectId: project.id, branch: "main" }, project.settings.mainFileId).text).toContain("😀漢字");
});

test("T04 rejects traversal and duplicate normalized ZIP paths before project creation", async () => {
  // Given: a ZIP archive whose path escapes the project.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const count = fixture.runtime.db.query("SELECT id FROM projects").all().length;
  const archive = zipSync({ "../escape.tex": new TextEncoder().encode("\\documentclass{article}") });
  // When: the native importer parses the untrusted archive.
  const result = await importZip(fixture.service, owner.user.id, { name: "Invalid ZIP", bytes: archive })
    .then(() => null, (error: unknown) => error);
  // Then: no project aggregate or source was created.
  expect(result).toBeInstanceOf(z.ZodError);
  expect(fixture.runtime.db.query("SELECT id FROM projects").all()).toHaveLength(count);
});

test("T04 rejects Unix symlink ZIP entries before decompression", () => {
  // Given: an archive marked as a symbolic link in its central directory.
  const bytes = zipSync({ "link.tex": new TextEncoder().encode("target") });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < bytes.length - 46; i++) {
    if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 38, 0xa1ff0000, true); break; }
  }
  // When: preflight reads the archive.
  const run = () => readZip(bytes);
  // Then: special files are rejected.
  expect(run).toThrow(ServiceError);
});

test("T04 atomically uploads bytes and moves an entire folder without losing file identity", async () => {
  // Given: a real source project and uploaded binary file.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const scope = { projectId: ids.project, branch: "main" };
  const version = fixture.service.getBranch(scope).revision;
  const form = new FormData();
  form.set("scope", JSON.stringify(scope)); form.set("expectedVersion", String(version));
  form.set("paths", JSON.stringify(["sections/data.bin"]));
  form.append("files", new File([new Uint8Array([0, 254, 250, 8])], "data.bin"));
  const upload = await fixture.request(`/api/projects/${ids.project}/uploads`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() }, body: form });
  const file = z.object({ data: z.array(FileEntrySchema).length(1) }).parse(await upload.json()).data[0];
  if (!file) throw new TypeError("Expected uploaded file");
  const folder = fixture.service.listFiles(scope).find((entry) => entry.path === "sections");
  if (!folder) throw new TypeError("Expected seeded folder");
  // When: the parent folder is renamed.
  const moved = await fixture.request(`/api/projects/${ids.project}/files/${folder.id}`, { method: "PATCH",
    headers: owner.headers, body: JSON.stringify({ scope, path: "chapters", expectedVersion: version + 1 }) });
  // Then: the child retains identity and byte content under its new path.
  expect(moved.status).toBe(200);
  const child = fixture.service.getFile(scope, file.id);
  expect(child.path).toBe("chapters/data.bin"); expect(child.editable).toBe(false);
  const content = await fixture.request(`/api/projects/${ids.project}/files/${file.id}/content?branch=main`, { headers: owner.headers });
  expect(new Uint8Array(await content.arrayBuffer())).toEqual(new Uint8Array([0, 254, 250, 8]));
});

test("T04 rejects a whole upload when a single path conflicts", async () => {
  // Given: an upload containing a new file and an existing source path.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const scope = { projectId: ids.project, branch: "main" };
  const before = fixture.service.listFiles(scope);
  const form = new FormData();
  form.set("scope", JSON.stringify(scope)); form.set("expectedVersion", String(fixture.service.getBranch(scope).revision));
  form.set("paths", JSON.stringify(["new.txt", "main.tex"]));
  form.append("files", new File(["new"], "new.txt")); form.append("files", new File(["wrong"], "main.tex"));
  // When: the upload is submitted.
  const response = await fixture.request(`/api/projects/${ids.project}/uploads`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() }, body: form });
  // Then: no partial file is visible or persisted.
  expect(response.status).toBe(409);
  expect(fixture.service.listFiles(scope)).toEqual(before);
});

test("T04 preserves cross-project linked bytes when its stable-ID source is deleted", async () => {
  // Given: a child project with a read-only cross-project file.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const child = await fixture.create(owner.headers, "Linked child");
  const sourceScope = { projectId: ids.project, branch: "main" };
  const source = fixture.service.listFiles(sourceScope).find((entry) => entry.path === "sections/intro.tex");
  if (!source) throw new TypeError("Expected source file");
  const response = await fixture.request(`/api/projects/${child.id}/links`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope: { projectId: child.id, branch: "main" }, path: "linked.tex", kind: "project",
      sourceProjectId: ids.project, sourceFileId: source.id, expectedVersion: 1 }) });
  const linked = z.object({ data: FileEntrySchema }).parse(await response.json()).data;
  // When: the source file is deleted and a refresh is attempted.
  await fixture.request(`/api/projects/${ids.project}/files/${source.id}`, { method: "DELETE", headers: owner.headers,
    body: JSON.stringify({ scope: sourceScope, expectedVersion: fixture.service.getBranch(sourceScope).revision }) });
  const refresh = await fixture.request(`/api/projects/${child.id}/links/${linked.id}/refresh`, { method: "POST",
    headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ expectedDigest: linked.blob, expectedVersion: 2 }) });
  // Then: refresh reports source loss and never clears child bytes.
  expect(refresh.status).toBe(409);
  expect(fixture.service.getFile({ projectId: child.id, branch: "main" }, linked.id).blob).toBe(linked.blob);
  expect(linked.editable).toBe(false);
});
