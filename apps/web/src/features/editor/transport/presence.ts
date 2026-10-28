import * as Y from "yjs";
import { z } from "zod";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import type { Id, RealtimeServerMessage } from "@quire/contracts";
import type { PersistentDocument } from "./document";

const item = z.object({ client: z.number().int().nonnegative(), clock: z.number().int().nonnegative() });
const relative = z.object({
  type: z.null().optional(), tname: z.literal("source"), item: item.nullish(), assoc: z.number().int().default(0),
}).transform(position => new Y.RelativePosition(null, "source",
  position.item ? Y.createID(position.item.client, position.item.clock) : null, position.assoc));
const cursorSchema = z.object({ anchor: relative, head: relative }).nullable();

/** Server user IDs are distinct from Yjs client IDs; each has one remote awareness clock. */
export class PresenceBridge {
  private readonly peers = new Map<string, Awareness>();
  constructor(private readonly document: PersistentDocument, private readonly actorId: Id | null) {}
  receive(message: Extract<RealtimeServerMessage, { readonly type: "presence" }>): void {
    if (message.fileId !== this.document.file.id || message.userId === this.actorId) return;
    let peer = this.peers.get(message.userId);
    if (!peer) {
      peer = new Awareness(new Y.Doc());
      this.peers.set(message.userId, peer);
    }
    let cursor: z.output<typeof cursorSchema> = null;
    if (message.cursor !== null) {
      try {
        const parsed = cursorSchema.safeParse(JSON.parse(message.cursor));
        if (parsed.success) cursor = parsed.data;
      } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
    peer.setLocalState({ user: { name: message.name, id: message.userId }, cursor });
    applyAwarenessUpdate(this.document.awareness, encodeAwarenessUpdate(peer, [peer.clientID]), this);
  }
  clear(): void {
    removeAwarenessStates(this.document.awareness, [...this.peers.values()].map(peer => peer.clientID), this);
    for (const peer of this.peers.values()) {
      peer.destroy();
      peer.doc.destroy();
    }
    this.peers.clear();
  }
}
