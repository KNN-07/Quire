import { expect, test } from "bun:test";
import { z } from "zod";
import { IdSchema, OperationSchema } from "@quire/contracts";
import { readZip } from "../../../services/core/base";
import { PandocConverter } from "../../../services/adapters/interchange";
import { interchangeFixture, rejectionCode, retainEvidence } from "./harness";

const markdown = new TextEncoder().encode("# Interchange fixture\n\nPreserved **structure**, a citation and $x^2$.\n");
const image = Bun.env["QUIRE_PANDOC_IMAGE"];
const envelope = z.object({ data: OperationSchema });

test("round trips real Markdown through DOCX and LaTeX when isolated Pandoc is configured", async () => {
  // Given
  await using converter = { value: new PandocConverter(image), async [Symbol.asyncDispose]() { await this.value.close(); } };
  // When
  const first = await converter.value.convert({
    entries: [{ path: "fixture.md", bytes: markdown }], main: "fixture.md", from: "markdown", to: "docx",
  });
  const docx = first.find(file => file.path === "document.docx");
  if (!docx) throw new TypeError("Actual Pandoc DOCX output required");
  const second = await converter.value.convert({
    entries: [{ path: "fixture.docx", bytes: docx.bytes }], main: "fixture.docx", from: "docx", to: "latex",
  });
  const tex = second.find(file => file.path === "document.tex");
  if (!tex) throw new TypeError("Actual Pandoc LaTeX output required");
  const third = await converter.value.convert({
    entries: [{ path: "main.tex", bytes: tex.bytes }], main: "main.tex", from: "latex", to: "markdown",
  });
  // Then
  expect(readZip(docx.bytes).some(file => file.path === "word/document.xml")).toBe(true);
  const output = third.find(file => file.path === "document.md");
  expect(new TextDecoder().decode(output?.bytes)).toContain("Interchange fixture");
  await retainEvidence("roundtrip-input.md", markdown);
  await retainEvidence("roundtrip.docx", docx.bytes);
  await retainEvidence("roundtrip.tex", tex.bytes);
  if (output) await retainEvidence("roundtrip-output.md", output.bytes);
}, 180_000);

test("retains original Markdown and exports actual generated documents when HTTP import and export are used", async () => {
  // Given
  await using fixture = await interchangeFixture({ converter: new PandocConverter(image) });
  const owner = await fixture.login();
  // When
  const imported = await fixture.request("/api/imports", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": "markdown-import" },
    body: JSON.stringify({ kind: "markdown", name: "Round trip", source: { kind: "snippet", text: new TextDecoder().decode(markdown) } }),
  });
  expect(imported.status).toBe(202);
  const operation = envelope.parse(await imported.json()).data;
  const [projectId] = z.object({ projectIds: z.array(z.string()) }).parse(operation.result).projectIds;
  if (!projectId) throw new TypeError("Imported project required");
  const exports = [];
  for (const kind of ["docx", "markdown", "html"]) {
    const exported = await fixture.request(`/api/projects/${projectId}/exports`, { method: "POST",
      headers: { ...owner.headers, "idempotency-key": `${kind}-export` }, body: JSON.stringify({ kind }),
    });
    expect(exported.status).toBe(202);
    const exportedOperation = envelope.parse(await exported.json()).data;
    const download = await fixture.request(`/api/operations/${exportedOperation.id}/download`, { headers: owner.headers });
    expect(download.status).toBe(200);
    exports.push(readZip(new Uint8Array(await download.arrayBuffer())));
  }
  // Then
  const project = await fixture.service.getProject(IdSchema.parse(projectId));
  const files = await fixture.service.listFiles({ projectId: project.id, branch: "main" });
  const original = files.find(file => file.path === "originals/original.md");
  if (!original?.blob) throw new TypeError("Byte-preserved original required");
  expect(await fixture.runtime.blobs.get(original.blob)).toEqual(markdown);
  expect(exports.map(entries => entries.some(file => file.path.startsWith("converted/document.")))).toEqual([true, true, true]);
  expect(files.some(file => file.path.startsWith("converted/"))).toBe(false);
}, 180_000);

test("reports exact installed-tool configuration when Pandoc image is absent", async () => {
  // Given
  const converter = new PandocConverter("");
  // When
  const code = await rejectionCode(converter.convert({
    entries: [{ path: "input.md", bytes: markdown }], main: "input.md", from: "markdown", to: "latex",
  }));
  // Then
  expect(code).toBe("CONVERSION_UNCONFIGURED");
  expect(converter.capability().state).toBe("unconfigured");
});

test("preserves original DOCX bytes when multipart document import converts to persistent TeX", async () => {
  // Given
  const converter = new PandocConverter(image);
  await using fixture = await interchangeFixture({ converter });
  const owner = await fixture.login();
  const converted = await converter.convert({
    entries: [{ path: "fixture.md", bytes: markdown }], main: "fixture.md", from: "markdown", to: "docx",
  });
  const document = converted.find(file => file.path === "document.docx");
  if (!document) throw new TypeError("Actual DOCX required");
  const form = new FormData();
  form.set("kind", "docx"); form.set("name", "Actual DOCX");
  form.set("source", new File([new Uint8Array(document.bytes)], "fixture.docx"));
  // When
  const response = await fixture.request("/api/imports", { method: "POST",
    headers: { ...owner.headers, "idempotency-key": "docx-import" }, body: form });
  // Then
  expect(response.status).toBe(202);
  const operation = envelope.parse(await response.json()).data;
  const [id] = z.object({ projectIds: z.array(IdSchema) }).parse(operation.result).projectIds;
  if (!id) throw new TypeError("Imported project required");
  const files = await fixture.service.listFiles({ projectId: id, branch: "main" });
  const original = files.find(file => file.path === "originals/original.docx");
  if (!original?.blob) throw new TypeError("Original DOCX blob required");
  expect(await fixture.runtime.blobs.get(original.blob)).toEqual(document.bytes);
  const main = files.find(file => file.path === "main.tex");
  expect(main?.editable).toBe(true);
}, 180_000);
