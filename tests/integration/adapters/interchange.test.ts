import { expect, test } from "bun:test";
import { z } from "zod";
import { zipSync } from "fflate";
import { AdapterGrantSchema, FileEntrySchema, IdSchema, OperationSchema } from "@quire/contracts";
import { SafeHttpClient } from "../../../services/adapters/shared";
import { referenceProvider, zoteroKey } from "../../adapters/references/provider";
import { data, integrationFixture } from "./harness";

test("imports binary source through the actual sole API dispatcher and replays after native restart", async () => {
  // Given
  await using fixture = await integrationFixture();
  const session = await fixture.login();
  const binary = new Uint8Array([0, 255, 37, 81]);
  const bytes = zipSync({
    "main.tex": new TextEncoder().encode("\\documentclass{article}\n\\begin{document}Integrated\\end{document}\n"),
    "source.bin": binary,
  });
  const key = crypto.randomUUID();
  const upload = () => {
    const form = new FormData();
    form.set("kind", "zip"); form.set("name", "Integration ZIP");
    form.set("source", new File([bytes], "project.zip"));
    return fixture.request("/api/imports", { method: "POST",
      headers: { ...session.headers, "idempotency-key": key }, body: form });
  };
  // When
  const imported = await data(await upload(), OperationSchema);
  await fixture.restart();
  // Then
  expect(await data(await upload(), OperationSchema)).toEqual(imported);
  const [projectId] = z.object({ projectIds: z.array(IdSchema) }).parse(imported.result).projectIds;
  if (!projectId) throw new TypeError("Import project missing");
  const files = await data(await fixture.request(`/api/projects/${projectId}/files?branch=main`,
    { headers: session.headers }), z.array(FileEntrySchema));
  const file = files.find(entry => entry.path === "source.bin");
  if (!file) throw new TypeError("Preserved binary missing");
  const response = await fixture.request(`/api/projects/${projectId}/files/${file.id}/content?branch=main`,
    { headers: session.headers });
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(binary);
  expect(file.editable).toBe(false);
}, 40_000);

test("admits actual Zotero keys and publishes bibliography beside URL links without competing routes", async () => {
  // Given
  await using provider = referenceProvider();
  await using fixture = await integrationFixture({ http: new SafeHttpClient({ fixtureOrigins: [provider.origin] }) });
  const session = await fixture.login();
  await fixture.configure("zotero", { baseUrl: provider.origin });
  const grant = await data(await fixture.request("/api/connections/zotero/credentials", { method: "POST",
    headers: session.headers, body: JSON.stringify({ accessToken: zoteroKey, label: "Composed key" }),
  }), AdapterGrantSchema);
  const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: "main" };
  const make = async (kind: "bibliography" | "url") => data(await fixture.request(`/api/projects/${project.id}/links`, {
    method: "POST", headers: { ...session.headers, "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ scope, kind, path: `${kind}.bib`,
      ...(kind === "bibliography" ? { grantId: grant.id } : { url: `${provider.origin}/source.bib` }),
      expectedVersion: (await fixture.core.getBranch(scope)).revision }),
  }), FileEntrySchema);
  // When
  const bibliography = await make("bibliography");
  const url = await make("url");
  // Then
  expect(bibliography.link?.kind).toBe("bibliography");
  expect(url.link?.kind).toBe("url");
  expect(bibliography.editable).toBe(false);
  const tested = await data(await fixture.request(`/api/connections/${grant.id}/test`, { method: "POST",
    headers: session.headers, body: JSON.stringify({ expectedVersion: grant.version }),
  }), z.object({ ok: z.boolean() }));
  expect(tested.ok).toBe(true);
  const foreign = await fixture.login("outsider@quire.local");
  expect((await fixture.request(`/api/connections/${grant.id}/test`, { method: "POST",
    headers: foreign.headers, body: JSON.stringify({ expectedVersion: grant.version }),
  })).status).toBe(404);
  await fixture.restart();
  expect((await fixture.core.listFiles(scope)).filter(file => file.link)).toHaveLength(2);
}, 40_000);
