import { test, expect } from "bun:test";
import { z } from "zod";
import { zipSync } from "fflate";
import { IdSchema, ImportUploadSchema, OperationSchema } from "@quire/contracts";
import { interchangeFixture } from "./harness";

const tex = new TextEncoder().encode("\\documentclass{article}\n\\begin{document}Staged bytes\\end{document}");
const uploadEnvelope = z.object({ data: ImportUploadSchema });
const operationEnvelope = z.object({ data: OperationSchema });

test("persists actor-owned staged bytes and imports the actual ZIP after restart", async () => {
  // Given
  await using fixture = await interchangeFixture();
  const owner = await fixture.login();
  const binary = new Uint8Array([0, 255, 1]);
  const bytes = zipSync({ "main.tex": tex, "raw.bin": binary });
  const stage = async () => {
    const form = new FormData(); form.set("file", new File([bytes], "source.zip", { type: "application/zip" }));
    const response = await fixture.request("/api/import-uploads", { method: "POST",
      headers: { ...owner.headers, "idempotency-key": "stage-zip" }, body: form });
    expect(response.status).toBe(201);
    return uploadEnvelope.parse(await response.json()).data;
  };
  const first = await stage();
  expect((await stage()).id).toBe(first.id);
  const ledger = await fixture.runtime.db.all("SELECT * FROM schema_migrations ORDER BY id");
  await fixture.restart();
  // When
  const downloaded = await fixture.request(`/api/import-uploads/${first.id}/content`, { headers: owner.headers });
  const response = await fixture.request("/api/imports", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": "import-staged" },
    body: JSON.stringify({ kind: "zip", name: "Staged import", source: { kind: "upload", uploadId: first.id } }) });
  // Then
  expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes);
  expect(response.status).toBe(202);
  const operation = operationEnvelope.parse(await response.json()).data;
  const [id] = z.object({ projectIds: z.array(IdSchema) }).parse(operation.result).projectIds;
  if (!id) throw new TypeError("Imported project required");
  const file = (await fixture.service.listFiles({ projectId: id, branch: "main" })).find(entry => entry.path === "raw.bin");
  if (!file?.blob) throw new TypeError("Imported binary required");
  expect(await fixture.runtime.blobs.get(file.blob)).toEqual(binary);
  expect(await fixture.runtime.db.all("SELECT * FROM schema_migrations ORDER BY id")).toEqual(ledger);
});

test("denies retrieval and import of another actor's staged upload", async () => {
  // Given
  await using fixture = await interchangeFixture();
  const owner = await fixture.login();
  const other = await fixture.login("mai@quire.local");
  const form = new FormData(); form.set("file", new File([tex], "main.tex", { type: "text/plain" }));
  const staged = await fixture.request("/api/import-uploads", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": "private-upload" }, body: form });
  const upload = uploadEnvelope.parse(await staged.json()).data;
  // When
  const content = await fixture.request(`/api/import-uploads/${upload.id}/content`, { headers: other.headers });
  const imported = await fixture.request("/api/imports", { method: "POST",
    headers: { ...other.headers, "idempotency-key": "denied-upload-import" },
    body: JSON.stringify({ kind: "open-in", name: "Denied", source: { kind: "upload", uploadId: upload.id } }) });
  // Then
  expect(content.status).toBe(404);
  expect(imported.status).toBe(404);
});

test("rejects expired staged content without publishing a project", async () => {
  // Given
  await using fixture = await interchangeFixture();
  const owner = await fixture.login();
  const form = new FormData(); form.set("file", new File([tex], "main.tex"));
  const response = await fixture.request("/api/import-uploads", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": "expire-upload" }, body: form });
  const upload = uploadEnvelope.parse(await response.json()).data;
  await fixture.runtime.db.run("UPDATE interchange_uploads SET expires_at=? WHERE id=?", ["2026-10-25T00:00:00.000Z", upload.id]);
  // When
  const expired = await fixture.request(`/api/import-uploads/${upload.id}/content`, { headers: owner.headers });
  // Then
  expect(expired.status).toBe(410);
});

test("rejects an oversized staged file at the real upload boundary", async () => {
  // Given
  await using fixture = await interchangeFixture();
  const owner = await fixture.login();
  const form = new FormData();
  form.set("file", new File([new Uint8Array(50 * 1024 * 1024 + 1)], "oversized.bin"));
  // When
  const response = await fixture.request("/api/import-uploads", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": "oversized-upload" }, body: form });
  // Then
  expect(response.status).toBe(413);
  expect(await fixture.runtime.db.get("SELECT id FROM interchange_uploads")).toBeNull();
});
