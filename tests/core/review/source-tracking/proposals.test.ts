import { expect, test } from "bun:test";
import { endpoints, IdSchema, resultSchema } from "@quire/contracts";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { editorValue } from "../../../../apps/web/src/features/editor/shared";
import type { EditorDocument } from "../../../../apps/web/src/features/editor/shared";
import { draftConflict, freshDraft, proposalBody } from "../../../../apps/web/src/features/editor/source/tracking";
import { reviewFixture, mutation, peer, sourceDoc } from "../harness";
import { defaultPolicy, fixtureIds as ids } from "../../../fixtures/foundation";

test("source draft requests persist authenticated proposals, never source, and require existing decision authority", async () => {
  await using fixture = await reviewFixture();
  const owner = await fixture.login();
  const reviewer = await fixture.login("sam@quire.local");
  const viewer = await fixture.login("alex@quire.local");
  const scope = { projectId: ids.project, branch: "main" };
  const source = await fixture.service.loadDocument(scope, ids.mainFile);
  const file = await fixture.service.getFile(scope, ids.mainFile);
  const ydoc = sourceDoc(source.state);
  const awareness = new Awareness(ydoc);
  const document: EditorDocument = {
    scope, file, ydoc, source: ydoc.getText("source"), awareness,
    getSnapshot: () => ({ version: file.version, persistence: { kind: "saved", revision: 0 },
      readOnly: true, readOnlyReason: "Reviewer cannot directly edit source" }),
    subscribe: () => () => {},
    replace: () => { throw new Error("No direct source writes permitted"); },
    flush: async () => {},
  };
  try {
    const original = freshDraft(document, true);
    const draft = { ...original, text: original.base.replace("article", "report") + "% 中文 😀\r\n" };
    const body = proposalBody(document, draft, 0);
    const route = `/api/projects/${ids.project}/suggestions`;
    expect((await fixture.request(route, mutation(viewer.headers, body))).status).toBe(403);
    const input = mutation(reviewer.headers, body);
    const created = await fixture.request(route, input);
    expect(created.status).toBe(200);
    const proposal = editorValue(resultSchema(endpoints.suggestionCreate.output).parse(await created.json()));
    const replay = editorValue(resultSchema(endpoints.suggestionCreate.output).parse(await (await fixture.request(route, input)).json()));
    expect(replay).toEqual(proposal);
    expect(proposal.authorId).toBe(reviewer.user.id);
    expect((await fixture.service.loadDocument(scope, ids.mainFile)).text).toBe(source.text);
    expect((await fixture.service.getBranch(scope)).revision).toBe(0);
    {
      await using connection = await peer(fixture.url, scope, reviewer.headers);
      const malicious = sourceDoc(source.state);
      try {
        malicious.getText("source").insert(0, "UNREVIEWED");
        const denied = connection.next(message => message.type === "error");
        connection.send({ type: "update", fileId: ids.mainFile, epoch: 0,
          clientId: IdSchema.parse(crypto.randomUUID()), clientSeq: 1,
          updateBase64: Buffer.from(Y.encodeStateAsUpdate(malicious)).toString("base64") });
        expect(await denied).toMatchObject({ type: "error", code: "FORBIDDEN" });
        expect((await fixture.service.loadDocument(scope, ids.mainFile)).text).toBe(source.text);
      } finally { malicious.destroy(); }
    }
    expect((await fixture.request(`${route}/decide`, mutation(reviewer.headers, {
      ids: [proposal.id], decision: "accept", expectedVersion: 0,
    }))).status).toBe(403);
    await fixture.restart();
    const listed = editorValue(resultSchema(endpoints.suggestionsList.output).parse(await (await fixture.request(
      `${route}?branch=main`, { headers: owner.headers },
    )).json()));
    expect(listed.items).toEqual([proposal]);
    const accepted = await fixture.request(`${route}/decide`, mutation(owner.headers, {
      ids: [proposal.id], decision: "accept", expectedVersion: 0,
    }));
    expect(accepted.status).toBe(200);
    expect((await fixture.service.loadDocument(scope, ids.mainFile)).text).toBe(draft.text);
    expect((await fixture.service.getBranch(scope)).revision).toBe(1);
    // Epoch and exact source divergence both stop local preparation, before a request exists.
    document.source.insert(0, "remote");
    expect(draftConflict(document, draft)).toBe(true);
    expect(() => proposalBody(document, draft, 1)).toThrow("Source changed");
    expect(() => proposalBody(document, { ...freshDraft(document, true), epoch: 99, text: "new" }, 1)).toThrow("Source changed");
    // Already prepared requests cannot overwrite the accepted revision.
    expect((await fixture.request(route, mutation(reviewer.headers, body))).status).toBe(409);
    await fixture.runtime.db.run(`INSERT INTO policy_sets(id,scope_kind,scope_id,policy_json,updated_at)
      VALUES(?,'project',?,?,?)`, [crypto.randomUUID(), ids.project, JSON.stringify({ ...defaultPolicy, trackChanges: false }), fixture.runtime.clock.now()]);
    expect((await fixture.request(route, mutation(reviewer.headers, { ...body, expectedVersion: 1 }))).status).toBe(403);
    expect((await fixture.service.loadDocument(scope, ids.mainFile)).text).toBe(draft.text);
    console.info("P31_CORE", JSON.stringify({ author: proposal.authorId, id: proposal.id,
      beforeHash: new Bun.CryptoHasher("sha256").update(source.text).digest("hex"),
      acceptedHash: new Bun.CryptoHasher("sha256").update(draft.text).digest("hex") }));
  } finally { awareness.destroy(); ydoc.destroy(); }
}, 60_000);
