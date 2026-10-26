import { expect, test } from "bun:test";
import { FilesUploadSchema } from "@quire/contracts";
import { fixtureIds as ids } from "../fixtures/foundation";

test("parses multipart metadata once when files enter the HTTP boundary", () => {
  // Given: the documented wire form with binary-safe file bytes.
  const form = new FormData();
  form.set("scope", JSON.stringify({ projectId: ids.project, branch: "main" }));
  form.set("paths", JSON.stringify(["assets/a.bin"]));
  form.set("expectedVersion", "3");
  form.append("files", new File([new Uint8Array([0, 255])], "a.bin"));
  // When: the multipart request is parsed.
  const upload = FilesUploadSchema.parse(form);
  // Then: the handler receives typed metadata and the original binary file.
  expect(upload.scope).toEqual({ projectId: ids.project, branch: "main" });
  expect(upload.expectedVersion).toBe(3);
  expect(upload.files.map((file) => file.size)).toEqual([2]);
});
test("rejects absent concurrency metadata when multipart changes existing state", () => {
  // Given: a form lacking its required optimistic version.
  const form = new FormData();
  form.set("scope", JSON.stringify({ projectId: ids.project, branch: "main" }));
  form.set("paths", JSON.stringify(["main.tex"]));
  form.append("files", new File(["text"], "main.tex"));
  // When: it crosses the shared boundary.
  const result = FilesUploadSchema.safeParse(form);
  // Then: missing version is not coerced to zero.
  expect(result.success).toBe(false);
});
