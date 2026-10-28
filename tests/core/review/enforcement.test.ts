import { expect, test } from "bun:test";
import { z } from "zod";
import { SuggestionSchema, IdSchema } from "@quire/contracts";
import * as Y from "yjs";
import { reviewFixture, proposal, sourceDoc, mutation, peer } from "./harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

for (const email of ["sam@quire.local", "alex@quire.local"]) {
  test(`denies source decisions and restore over HTTP and socket for ${email}`, async () => {
    // Given: a read-only-source role and a real pending suggestion/checkpoint.
    await using fixture = await reviewFixture();
    const owner = await fixture.login();
    const reader = await fixture.login(email);
    const scope = { projectId: ids.project, branch: "main" };
    const source = (await fixture.service.loadDocument(scope, ids.mainFile));
    const doc = sourceDoc(source.state);
    const edit = proposal(doc, { fileId: ids.mainFile, before: "article", after: "report", baseRevision: 0 });
    const created = await fixture.request(`/api/projects/${ids.project}/suggestions`,
      mutation(owner.headers, { scope, edits: [edit], expectedVersion: 0 }));
    const suggestion = z.object({ data: SuggestionSchema }).parse(await created.json()).data;
    await using client = await peer(fixture.url, scope, reader.headers);
    doc.getText("source").insert(doc.getText("source").length, "DENIED SOURCE");
    const error = client.next(message => message.type === "error");
    // When: the role attempts direct decision, restore and raw Yjs mutation.
    const decided = await fixture.request(`/api/projects/${ids.project}/suggestions/decide`,
      mutation(reader.headers, { ids: [suggestion.id], decision: "accept", expectedVersion: 0 }));
    const restored = await fixture.request(`/api/projects/${ids.project}/history/${ids.snapshot}/restore`,
      mutation(reader.headers, { scope, expectedVersion: 0 }));
    const history = await fixture.request(`/api/projects/${ids.project}/history/${ids.snapshot}/source.zip?branch=main`,
      { headers: reader.headers });
    const synced = client.next(message => message.type === "update");
    client.send({ type: "sync", fileId: ids.mainFile, epoch: 0, stateVectorBase64: source.vector });
    await synced;
    client.send({ type: "update", fileId: ids.mainFile, epoch: 0, clientId: IdSchema.parse(crypto.randomUUID()), clientSeq: 1,
      updateBase64: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64") });
    // Then: all authoritative write paths refuse the role without a source revision.
    expect(decided.status).toBe(403);
    expect(restored.status).toBe(403);
    expect(history.status).toBe(200);
    expect(await error).toMatchObject({ type: "error", code: "FORBIDDEN" });
    expect((await fixture.service.loadDocument(scope, ids.mainFile)).text).toBe(source.text);
    expect((await fixture.service.getBranch(scope)).revision).toBe(0);
    doc.destroy();
  });
}
