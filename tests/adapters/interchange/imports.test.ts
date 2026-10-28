import { expect, test } from "bun:test";
import { z } from "zod";
import { zipSync } from "fflate";
import { IdSchema, OperationSchema } from "@quire/contracts";
import { readZip } from "../../../services/core/base";
import { interchangeFixture } from "./harness";

const tex = new TextEncoder().encode("\\documentclass{article}\n\\begin{document}Independent source\\end{document}\n");
const binary = new Uint8Array([0, 255, 128, 30, 0, 7]);
const envelope = z.object({ data: OperationSchema });
const result = z.object({ projectIds: z.array(IdSchema) });

test("creates independent persistent projects with original binary bytes when ZIP is imported twice", async () => {
  // Given
  await using fixture = await interchangeFixture();
  const owner = await fixture.login();
  const bytes = zipSync({ "main.tex": tex, "assets/raw.bin": binary });
  const upload = async (key: string) => {
    const form = new FormData();
    form.set("kind", "zip"); form.set("name", "Native import");
    form.set("source", new File([bytes], "project.zip", { type: "application/zip" }));
    const response = await fixture.request("/api/imports", {
      method: "POST", headers: { ...owner.headers, "idempotency-key": key }, body: form,
    });
    expect(response.status).toBe(202);
    return envelope.parse(await response.json()).data;
  };
  // When
  const first = await upload("first-zip");
  const retry = await upload("first-zip");
  const second = await upload("second-zip");
  await fixture.restart();
  // Then
  expect(retry.id).toBe(first.id);
  const [firstId] = result.parse(first.result).projectIds;
  const [secondId] = result.parse(second.result).projectIds;
  if (!firstId || !secondId) throw new TypeError("Imported project IDs required");
  expect(secondId).not.toBe(firstId);
  const files = await fixture.service.listFiles({ projectId: firstId, branch: "main" });
  const file = files.find(entry => entry.path === "assets/raw.bin");
  if (!file?.blob) throw new TypeError("Imported binary blob required");
  expect(file.editable).toBe(false);
  expect(await fixture.runtime.blobs.get(file.blob)).toEqual(binary);
});

test("rejects reuse of a multipart key when file content differs", async () => {
  // Given
  await using fixture = await interchangeFixture();
  const owner = await fixture.login();
  const upload = async (bytes: Uint8Array) => {
    const form = new FormData();
    form.set("kind", "zip"); form.set("name", "Same metadata"); form.set("source", new File([new Uint8Array(bytes)], "project.zip"));
    return fixture.request("/api/imports", { method: "POST",
      headers: { ...owner.headers, "idempotency-key": "different-content" }, body: form });
  };
  await upload(zipSync({ "main.tex": tex }));
  // When
  const response = await upload(zipSync({ "main.tex": tex, "extra.bin": binary }));
  // Then
  expect(response.status).toBe(409);
});

test("imports actual TeX when open-in carries an encoded data URL", async () => {
  // Given
  await using fixture = await interchangeFixture();
  const owner = await fixture.login();
  // When
  const response = await fixture.request("/api/imports", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": "open-in" },
    body: JSON.stringify({ kind: "open-in", name: "Open in", source: {
      kind: "data-url", dataUrl: `data:text/plain;base64,${Buffer.from(tex).toString("base64")}`,
    } }),
  });
  // Then
  expect(response.status).toBe(202);
  const [id] = result.parse(envelope.parse(await response.json()).data.result).projectIds;
  if (!id) throw new TypeError("Project required");
  const files = await fixture.service.listFiles({ projectId: id, branch: "main" });
  expect(files.map(file => file.path)).toEqual(["main.tex"]);
});

for (const path of ["../escape.tex", "/absolute.tex", ".git/config", "folder/../../escape.tex"]) {
  test(`rejects hostile archive path ${path} before creating a project`, () => {
    // Given
    const archive = zipSync({ "main.tex": tex, [path]: binary });
    // When / Then
    expect(() => readZip(archive)).toThrow();
  });
}

test("rejects expanded archive size lies before decompression", () => {
  // Given
  const archive = zipSync({ "main.tex": tex });
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  for (let offset = 0; offset < archive.length - 46; offset++) {
    if (view.getUint32(offset, true) === 0x02014b50) { view.setUint32(offset + 24, 60 * 1024 * 1024, true); break; }
  }
  // When / Then
  expect(() => readZip(archive)).toThrow();
});

test("rejects symbolic link archive entries before source creation", () => {
  // Given
  const archive = zipSync({ "main.tex": tex });
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  for (let offset = 0; offset < archive.length - 46; offset++) {
    if (view.getUint32(offset, true) === 0x02014b50) { view.setUint32(offset + 38, 0xa1ff0000, true); break; }
  }
  // When / Then
  expect(() => readZip(archive)).toThrow();
});

test("rejects corrupted CRC checksums when archive data differs from the directory", () => {
  // Given
  const archive = zipSync({ "main.tex": tex });
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  for (let offset = 0; offset < archive.length - 46; offset++) {
    if (view.getUint32(offset, true) === 0x02014b50) { view.setUint32(offset + 16, 0, true); break; }
  }
  // When / Then
  expect(() => readZip(archive)).toThrow();
});
