import { expect, test } from "bun:test";
import * as Y from "yjs";
import { GitOidSchema } from "@quire/contracts";
import { applyProposal } from "../../../services/adapters/ai/proposals";
import { digest } from "../../../services/adapters/ai/model";
import { aiFixture } from "./harness";
import { providerServer } from "./provider";

test("recovers an approved Git publication into source and its receipt after restart", async () => {
  // Given
  await using provider = providerServer(); await using fixture = await aiFixture(provider.origin);
  const session = await fixture.login(); await fixture.configure(); const project = await fixture.project(session);
  const scope = { projectId: project.id, branch: project.defaultBranch };
  const original = await fixture.core.readDocument(scope, project.settings.mainFileId);
  provider.respond(context => ({ text: "Review", citations: [], patches: context.files.map(file => ({
    fileId: file.id, path: file.path, from: 0, to: 0, before: "", after: "% recovery\n",
  })) }));
  const run = await fixture.run(session, { scope, mode: "agent", tool: "chat", prompt: "Add", fileIds: [original.file.id] });
  const edit = run.proposals[0]?.edits[0];
  if (!edit) throw new TypeError("Proposed edit required");
  const decision = { id: run.id, editIds: [edit.id], decision: "accept" as const,
    expectedVersion: (await fixture.ai.get(session.actor, run.id)).version, key: crypto.randomUUID() };
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, Buffer.from(original.updateBase64, "base64"));
    const inverse = applyProposal(document, edit);
    if (!inverse) throw new TypeError("Fixture base must match");
    await fixture.core.serialized(scope, async lease => {
      const source = await fixture.core.prepareSource({ actorId: session.user.id, scope, lease,
        expectedRevision: (await fixture.core.getBranch(scope)).revision,
        inputs: (await fixture.core.listFiles(scope)).map(file => ({ file, ...(file.id === original.file.id ? { document } : {}) })) });
      const updates = [{ ref: `refs/quire/history/${source.snapshot.id}`, expected: null, next: GitOidSchema.parse(`sha1:${source.commit}`) }];
      await fixture.ai.decisions.journal.stage(source.snapshot.id, {
        source, runId: run.id, actorId: session.user.id, sessionId: session.actor.sessionId,
        expectedVersion: decision.expectedVersion, key: decision.key, digest: digest(JSON.stringify(decision)),
        proposals: run.proposals.map(suggestion => ({ ...suggestion, edits: suggestion.edits.map(item => ({ ...item, status: "accepted" as const })) })),
        undo: { [edit.id]: inverse }, updates,
      });
      await fixture.runtime.repositories.publish({ id: source.snapshot.id, lease, updates });
      // Simulated process loss occurs after actual Git CAS, before SQL finalization.
    });
  } finally { document.destroy(); }
  // When
  await fixture.restart();
  // Then
  expect((await fixture.core.readDocument(scope, original.file.id)).text).toBe(`% recovery\n${original.text}`);
  const replay = await fixture.ai.decisions.decide(session.actor, decision);
  expect(replay.proposals[0]?.edits[0]?.status).toBe("accepted");
  expect(await fixture.runtime.db.all("SELECT * FROM ai_source_journal")).toHaveLength(0);
  expect(provider.received).toHaveLength(1);
});
