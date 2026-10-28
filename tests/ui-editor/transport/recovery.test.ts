import { expect, test } from "bun:test";
import * as Y from "yjs";
import { z } from "zod";
import { TransportError } from "../../../apps/web/src/features/editor/transport";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { bounded } from "../../core/review/harness";
import { changed, transportFixture } from "./harness";

test("preserves offline edits and reports server recovery text after an epoch replacement", async () => {
  // Given: a disconnected document with pending source changes.
  await using setup = await transportFixture();
  const user = await setup.user();
  const socket = user.sockets[0];
  if (!socket) throw new TypeError("Missing socket");
  const offline = changed(user.document, () => user.document.getSnapshot().persistence.kind === "offline");
  socket.close();
  await offline;
  user.document.replace([{ from: 0, to: 0, insert: "KEEP OFFLINE 😀\n" }]);
  const local = user.document.source.toJSON();
  const recovery = changed(user.document, () => user.document.getSnapshot().persistence.kind === "recovery");
  const replacement = new Y.Doc();
  const serverText = "\\documentclass{article}\n\\begin{document}\nNEW SERVER EPOCH\n\\end{document}\n";
  replacement.getText("source").insert(0, serverText);
  // When: a real source commit replaces the epoch while the client is disconnected.
  try {
    await setup.fixture.service.serialized(user.workspace.scope, async lease => {
      const files = await setup.fixture.service.listFiles(user.workspace.scope);
      return setup.fixture.service.commitSource({ lease, actorId: user.login.user.id, scope: user.workspace.scope,
        expectedRevision: 0, inputs: files.map(file => file.id === ids.mainFile
          ? { file: { ...file, version: { ...file.version, epoch: 1 } }, document: replacement } : { file }) });
    });
    user.transport.reconnect();
    await recovery;
    // Then: old updates are never rebased or silently replaced; both recovery texts are exposed.
    expect(user.document.source.toJSON()).toBe(local);
    expect(user.document.getSnapshot().persistence).toMatchObject({ kind: "recovery",
      code: "EPOCH_CHANGED", localText: local, serverText });
    expect((await setup.fixture.service.loadDocument(user.workspace.scope, ids.mainFile)).text).toBe(serverText);
    expect(await user.document.flush(AbortSignal.timeout(10000)).then(
      () => "resolved", error => error instanceof TransportError ? error.code : "unexpected",
    )).toBe("RECOVERY_REQUIRED");
  } finally { replacement.destroy(); }
});

test("delivers actual authenticated presence into the other document awareness", async () => {
  // Given: independent users subscribed to the same file.
  await using setup = await transportFixture();
  const owner = await setup.user();
  const editor = await setup.user("mai@quire.local");
  const awareness = owner.document.awareness;
  const position = z.object({ type: z.null(), tname: z.string(), assoc: z.number(),
    item: z.object({ client: z.number(), clock: z.number() }).nullable() });
  const presence = z.object({ user: z.object({ id: z.string(), name: z.string() }),
    cursor: z.object({ anchor: position, head: position }) });
  const received = new Promise<void>(resolve => {
    const update = () => {
      if (![...awareness.getStates().values()].some(state => {
        const parsed = presence.safeParse(state);
        return parsed.success && parsed.data.user.id === ids.mai
          && Y.createAbsolutePositionFromRelativePosition(parsed.data.cursor.head, owner.document.ydoc)?.index === 3;
      })) return;
      awareness.off("change", update); resolve();
    };
    awareness.on("change", update);
    update();
  });
  // When: a peer publishes its local presence.
  editor.document.awareness.setLocalStateField("cursor", {
    anchor: Y.createRelativePositionFromTypeIndex(editor.document.source, 2),
    head: Y.createRelativePositionFromTypeIndex(editor.document.source, 3),
  });
  await bounded(received);
  // Then: peer identity is server-authenticated, and presence does not create source revisions.
  const states = [...awareness.getStates().values()];
  expect(states.some(state => {
    const parsed = presence.safeParse(state);
    return parsed.success && parsed.data.user.id === ids.mai && parsed.data.user.name === editor.login.user.name;
  })).toBe(true);
  expect((await setup.fixture.service.getBranch(owner.workspace.scope)).revision).toBe(0);
});
