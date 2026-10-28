import { expect, test } from "bun:test";
import { EventSchema } from "@quire/contracts";
import { aiFixture } from "./harness";
import { providerServer } from "./provider";

async function readEvents(reader: ReadableStreamDefaultReader<Uint8Array>, stop: (text: string) => boolean) {
  let text = "";
  while (!stop(text)) {
    const part = await reader.read();
    if (part.done) throw new TypeError("Event stream ended before expected signal");
    text += new TextDecoder().decode(part.value);
  }
  return text.split("\n").filter(line => line.startsWith("data: "))
    .map(line => EventSchema.parse(JSON.parse(line.slice(6))));
}

test("AI completion arrives live and replay respects private session and shared conversation access", async () => {
  // Given: the actual review SSE module and two independent sessions for one account.
  await using provider = providerServer();
  await using fixture = await aiFixture(provider.origin, { review: true });
  const owner = await fixture.login();
  const second = await fixture.login();
  const outsider = await fixture.login("outsider@quire.local");
  await fixture.configure();
  const project = await fixture.project(owner);
  const response = await fixture.request("/api/events?after=0", { headers: owner.headers });
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError("Expected SSE body");
  try {
    await readEvents(reader, text => text.includes(": ready\n\n"));
    // When: actual HTTP inference completes after the live stream subscribes.
    const completion = readEvents(reader, text => text.includes('"status":"succeeded"'));
    const [run, live] = await Promise.all([
      fixture.run(owner, { scope: { projectId: project.id, branch: project.defaultBranch },
        mode: "ask", tool: "chat", prompt: "Private request", fileIds: [] }),
      completion,
    ]);
    expect(live.some(event => event.topic === "operation.changed"
      && event.payload.resourceId === run.id && event.payload.status === "succeeded")).toBe(true);
    const conversation = await fixture.ai.conversations.create(owner.actor, project.id);
    const shared = await fixture.run(owner, { scope: { projectId: project.id, branch: project.defaultBranch },
      mode: "ask", tool: "chat", prompt: "Shared request", fileIds: [], conversationId: conversation.id });
    // Then: another session sees shared completion, not private history; outsiders see neither.
    for (const session of [second, outsider]) {
      const replay = await fixture.request("/api/events?after=0", { headers: session.headers });
      const replayReader = replay.body?.getReader();
      if (!replayReader) throw new TypeError("Expected replay body");
      try {
        const events = await readEvents(replayReader, text => text.includes(": ready\n\n"));
        const ids = events.filter(event => event.topic === "operation.changed").map(event => event.aggregateId);
        expect(ids.includes(run.id)).toBe(false);
        expect(ids.includes(shared.id)).toBe(session === second);
      } finally { await replayReader.cancel(); }
    }
  } finally { await reader.cancel(); }
}, 30000);
