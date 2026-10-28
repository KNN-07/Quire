import { expect, test } from "bun:test";
import * as Y from "yjs";
import { z } from "zod";
import { RealtimeServerMessageSchema } from "@quire/contracts";
import { transportFixture } from "./harness";
import { bounded } from "../../core/review/harness";
import { fixtureIds as ids } from "../../fixtures/foundation";

test("presence throttling eventually delivers the latest cursor in a burst", async () => {
  await using setup = await transportFixture();
  const owner = await setup.user();
  const editor = await setup.user("mai@quire.local");
  const socket = editor.sockets[0];
  if (!socket) throw new TypeError("Expected editor socket");
  const relative = z.object({ type: z.null(), tname: z.string(), assoc: z.number(),
    item: z.object({ client: z.number(), clock: z.number() }).nullable() });
  const stateSchema = z.object({ user: z.object({ id: z.string() }), cursor: z.object({ head: relative }) });
  const heads: number[] = [];
  const wire: unknown[] = [];
  const observeWire = (event: MessageEvent) => {
    const message = RealtimeServerMessageSchema.parse(JSON.parse(String(event.data)));
    if (message.type === "presence") wire.push(message);
  };
  owner.sockets[0]?.addEventListener("message", observeWire);
  const delivered = Promise.withResolvers<void>();
  const observe = () => {
    for (const state of owner.document.awareness.getStates().values()) {
      const parsed = stateSchema.safeParse(state);
      if (!parsed.success || parsed.data.user.id !== ids.mai) continue;
      const position = Y.createAbsolutePositionFromRelativePosition(parsed.data.cursor.head, owner.document.ydoc);
      if (!position) continue;
      heads.push(position.index);
      if (position.index === 3) delivered.resolve();
    }
  };
  owner.document.awareness.on("change", observe);
  try {
    for (const index of [2, 3]) {
      const position = Y.createRelativePositionFromTypeIndex(editor.document.source, index);
      socket.send(JSON.stringify({ type: "presence", fileId: ids.mainFile, name: "Untrusted name",
        cursor: JSON.stringify({ anchor: position, head: position }) }));
    }
    await bounded(delivered.promise);
    expect(heads).toContain(3);
    expect((await setup.fixture.service.getBranch(owner.workspace.scope)).revision).toBe(0);
  } catch (error) {
    console.info("PRESENCE_BURST_FAILURE", { heads, wire, states: [...owner.document.awareness.getStates().values()] });
    throw error;
  } finally {
    owner.document.awareness.off("change", observe);
    owner.sockets[0]?.removeEventListener("message", observeWire);
  }
}, 20000);
