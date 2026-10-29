import type { Event } from "@quire/contracts";
import type { EditorClient, EditorRequestHeaders } from "../shared";
import { editorEventActor, editorEvents } from "../shared/events";

/** Register before dispatch; a fresh DTO read after dispatch covers response/event races. */
export async function assistantEvents(input: {
  readonly client: EditorClient;
  readonly headers: EditorRequestHeaders;
  readonly signal: AbortSignal;
  readonly receive: (event: Event) => Promise<void>;
}) {
  const actorId = await editorEventActor(input.client, input.signal);
  await editorEvents({ ...input, actorId });
}
