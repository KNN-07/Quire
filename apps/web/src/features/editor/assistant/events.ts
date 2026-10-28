import ky from "ky";
import { EventSchema, endpoints } from "@quire/contracts";
import type { Event } from "@quire/contracts";
import type { EditorClient, EditorRequestHeaders } from "../shared";

/** Register before dispatch; a fresh DTO read after dispatch covers response/event races. */
export async function assistantEvents(input: {
  readonly client: EditorClient;
  readonly headers: EditorRequestHeaders;
  readonly signal: AbortSignal;
  readonly receive: (event: Event) => Promise<void>;
}) {
  const response = await ky(input.client.url(endpoints.events, {
    params: {}, query: {}, body: undefined,
  }), { headers: input.headers, credentials: "same-origin", retry: 0, timeout: false, signal: input.signal });
  if (!response.body) throw new TypeError("AI notifications returned no stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) throw new TypeError("AI notifications disconnected; use Refresh to read the current run");
      pending += decoder.decode(chunk.value, { stream: true });
      let boundary: number;
      while ((boundary = pending.indexOf("\n\n")) >= 0) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const data = frame.split("\n").find(line => line.startsWith("data: "))?.slice(6);
        if (data) await input.receive(EventSchema.parse(JSON.parse(data)));
      }
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
