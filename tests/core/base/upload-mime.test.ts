import { expect, test } from "bun:test";
import { z } from "zod";
import { FileEntrySchema } from "@quire/contracts";
import { baseFixture } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("multipart image MIME and bytes survive source publication and restart", async () => {
  // Given: a real PNG submitted through the multipart API.
  await using fixture = await baseFixture();
  const owner = await fixture.login();
  const png = Uint8Array.from(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
  const form = new FormData();
  form.set("scope", JSON.stringify({ projectId: ids.project, branch: "main" }));
  form.set("expectedVersion", "0");
  form.set("paths", JSON.stringify(["figure.png"]));
  form.append("files", new File([png], "figure.png", { type: "image/png" }));
  const headers = { ...owner.headers, "idempotency-key": crypto.randomUUID() };

  // When: the image is published and the runtime restarts.
  const response = await fixture.request(`/api/projects/${ids.project}/uploads`, { method: "POST", headers, body: form });
  expect(response.status).toBe(200);
  const [file] = z.object({ data: z.array(FileEntrySchema) }).parse(await response.json()).data;
  if (!file) throw new TypeError("Expected uploaded file");
  await fixture.restart();

  // Then: persisted metadata, content headers and bytes all retain the image type.
  expect(file.mime).toBe("image/png");
  expect((await fixture.service.getFile({ projectId: ids.project, branch: "main" }, file.id)).mime).toBe("image/png");
  const content = await fixture.request(`/api/projects/${ids.project}/files/${file.id}/content?branch=main`, { headers: owner.headers });
  expect(content.status).toBe(200);
  expect(content.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await content.arrayBuffer())).toEqual(png);
  const retry = await fixture.request(`/api/projects/${ids.project}/uploads`, { method: "POST", headers, body: form });
  expect(z.object({ data: z.array(FileEntrySchema) }).parse(await retry.json()).data).toEqual([file]);
  const changed = new FormData();
  changed.set("scope", JSON.stringify({ projectId: ids.project, branch: "main" }));
  changed.set("expectedVersion", "0");
  changed.set("paths", JSON.stringify(["figure.png"]));
  // Native Bun derives parsed File.type from the multipart filename.
  // Keep the destination path unchanged while sending a distinct parsed MIME.
  changed.append("files", new File([png], "figure.jpg", { type: "image/jpeg" }));
  const parsed = await new Request("http://localhost/uploads", { method: "POST", body: changed }).formData();
  const changedFile = parsed.get("files");
  if (!(changedFile instanceof File)) throw new TypeError("Expected changed multipart file");
  expect(changedFile.type).toBe("image/jpeg");
  const changedType = await fixture.request(`/api/projects/${ids.project}/uploads`, { method: "POST", headers, body: changed });
  expect(changedType.status).toBe(409);
});
