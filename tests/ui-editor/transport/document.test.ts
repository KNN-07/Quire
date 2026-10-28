import { expect, spyOn, test } from "bun:test";
import * as Y from "yjs";
import { endpoints, IdSchema } from "@quire/contracts";
import type { RealtimeClientMessage } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { PersistentDocument } from "../../../apps/web/src/features/editor/transport/document";
import { encode } from "../../../apps/web/src/features/editor/transport/codec";
import { offlineWindowMs } from "../../../apps/web/src/features/editor/transport/config";
import { transportFixture } from "./harness";

async function isolated(user: Awaited<ReturnType<Awaited<ReturnType<typeof transportFixture>>["user"]>>) {
  const initial = editorValue(await user.client.call(endpoints.fileDocument, {
    params: { p: user.workspace.scope.projectId, f: user.document.file.id }, query: { branch: "main" },
    headers: user.workspace.requestHeaders, body: undefined,
  }));
  return new PersistentDocument(user.workspace, initial);
}

test("keeps pending work unsaved until its own exact sequence acknowledgement arrives", async () => {
  // Given: an isolated queue initialized from the real service's document DTO.
  await using setup = await transportFixture();
  const user = await setup.user();
  const document = await isolated(user);
  const sent: RealtimeClientMessage[] = [];
  try {
    document.connect(message => sent.push(message));
    document.receive({ type: "update", fileId: document.file.id, epoch: 0, revision: 0,
      updateBase64: encode(Y.encodeStateAsUpdate(document.ydoc)) });
    document.replace([{ from: 0, to: 0, insert: "queued" }]);
    const update = sent.find(message => message.type === "update");
    if (!update || update.type !== "update") throw new TypeError("Missing pending update");
    // When: unrelated-client and wrong-sequence acks precede the actual acknowledgement.
    document.receive({ type: "ack", clientId: IdSchema.parse(crypto.randomUUID()), clientSeq: update.clientSeq, revision: 99 });
    document.receive({ type: "ack", clientId: update.clientId, clientSeq: update.clientSeq + 1, revision: 99 });
    // Then: neither false receipt clears pending work or advances acknowledged revision.
    expect(document.getSnapshot().persistence).toEqual({ kind: "saving", acknowledgedRevision: 0, pendingUpdates: 1 });
    const flushed = document.flush(AbortSignal.timeout(10000));
    document.receive({ type: "ack", clientId: update.clientId, clientSeq: update.clientSeq, revision: 1 });
    await flushed;
    expect(document.getSnapshot().persistence).toEqual({ kind: "saved", revision: 1 });
  } finally { document.close(); }
});

test("does not extend the offline editing deadline when a reconnect fails to synchronize", async () => {
  // Given: a real baseline with a controlled wall clock for the offline deadline.
  await using setup = await transportFixture();
  const user = await setup.user();
  const document = await isolated(user);
  const clock = spyOn(Date, "now").mockReturnValue(1000);
  try {
    document.connect(() => {});
    document.receive({ type: "update", fileId: document.file.id, epoch: 0, revision: 0,
      updateBase64: encode(Y.encodeStateAsUpdate(document.ydoc)) });
    document.disconnect();
    document.replace([{ from: 0, to: 0, insert: "retained" }]);
    const local = document.source.toJSON();
    clock.mockReturnValue(601001);
    // When: a reconnect opens but fails before the server synchronization response.
    document.connect(() => {});
    document.disconnect();
    // Then: the original deadline still blocks edits while retaining pending source.
    expect(document.getSnapshot().persistence).toMatchObject({ kind: "offline", editable: false, since: 1000, pendingUpdates: 1 });
    expect(() => document.replace([{ from: 0, to: 0, insert: "too late" }])).toThrow();
    expect(document.source.toJSON()).toBe(local);
  } finally { clock.mockRestore(); document.close(); }
});

test.each([
  { setting: undefined, duration: 600_000 },
  { setting: "120000", duration: 120_000 },
])("expires the configured offline window and saves retained edits after synchronization: $duration", async ({ setting, duration }) => {
  await using setup = await transportFixture();
  const user = await setup.user();
  const previous = process.env["VITE_QUIRE_OFFLINE_WINDOW_MS"];
  if (setting === undefined) delete process.env["VITE_QUIRE_OFFLINE_WINDOW_MS"];
  else process.env["VITE_QUIRE_OFFLINE_WINDOW_MS"] = setting;
  const document = await isolated(user);
  const clock = spyOn(Date, "now").mockReturnValue(1000);
  const timers = spyOn(globalThis, "setTimeout");
  const sent: RealtimeClientMessage[] = [];
  const synchronize = () => {
    document.connect(message => sent.push(message));
    document.receive({ type: "update", fileId: document.file.id, epoch: 0, revision: 0,
      updateBase64: encode(Y.encodeStateAsUpdate(document.ydoc)) });
  };
  try {
    synchronize();
    document.disconnect();
    const deadline = timers.mock.calls.find(([, delay]) => delay === duration)?.[0];
    if (typeof deadline !== "function") throw new TypeError("Missing offline expiry event");
    clock.mockReturnValue(1000 + duration - 1);
    document.replace([{ from: 0, to: 0, insert: "retained at the boundary\n" }]);
    const local = document.source.toJSON();
    expect(document.getSnapshot().persistence).toMatchObject({ kind: "offline", editable: true, pendingUpdates: 1 });
    clock.mockReturnValue(1000 + duration);
    deadline();
    expect(document.getSnapshot()).toMatchObject({ readOnly: true, persistence: { kind: "offline", editable: false } });
    expect(() => document.replace([{ from: 0, to: 0, insert: "too late" }])).toThrow();
    expect(document.source.toJSON()).toBe(local);
    synchronize();
    const update = sent.find(message => message.type === "update");
    if (!update || update.type !== "update") throw new TypeError("Missing retained update");
    const flushed = document.flush(AbortSignal.timeout(10_000));
    document.receive({ type: "ack", clientId: update.clientId, clientSeq: update.clientSeq, revision: 1 });
    await flushed;
    expect(document.getSnapshot().persistence).toEqual({ kind: "saved", revision: 1 });
    expect(document.source.toJSON()).toBe(local);
    // A synchronized connection, unlike an unsuccessful reconnect, starts a fresh budget.
    document.disconnect();
    expect(document.getSnapshot().persistence).toMatchObject({ kind: "offline", editable: true, since: 1000 + duration });
    document.recover("EPOCH_CHANGED", "Server epoch replaced", "replacement");
    expect(document.getSnapshot().persistence).toMatchObject({ kind: "recovery", localText: local, serverText: "replacement" });
  } finally {
    timers.mockRestore(); clock.mockRestore(); document.close();
    if (previous === undefined) delete process.env["VITE_QUIRE_OFFLINE_WINDOW_MS"];
    else process.env["VITE_QUIRE_OFFLINE_WINDOW_MS"] = previous;
  }
});

test.each(["", "0", "-1", "1.5", "Infinity", "NaN", " 120000", "2147483648", "1e3"])(
  "rejects invalid operator offline configuration: %s", value => {
    expect(() => offlineWindowMs(value)).toThrow("VITE_QUIRE_OFFLINE_WINDOW_MS");
  },
);
