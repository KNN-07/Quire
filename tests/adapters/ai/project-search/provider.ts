import { z } from "zod";

export const requestSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown().optional(), tool_call_id: z.string().optional() })),
  tools: z.array(z.unknown()).optional(), tool_choice: z.string().optional(),
});
export type ProviderRequest = z.infer<typeof requestSchema>;
export function queryCall(id = "search-1", args: unknown = { query: "document" }, name = "project_search") {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}
export function calls(...items: unknown[]) {
  return { finish_reason: "tool_calls", message: { content: null, tool_calls: items } };
}
export function answer(patches: readonly unknown[] = []) {
  return { finish_reason: "stop", message: { content: JSON.stringify({
    text: "Actual project context received.", patches, citations: [], findings: [],
  }) } };
}
export function searchProvider() {
  const received: ProviderRequest[] = [];
  let reply: (request: ProviderRequest, index: number) => unknown =
    (request) => request.messages.some(item => item.role === "tool") ? answer() : calls(queryCall());
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (request.headers.get("authorization") !== "Bearer fixture-ai-key") return new Response(null, { status: 401 });
    if (new URL(request.url).pathname === "/v1/models") return Response.json({ data: [{ id: "fixture-model" }] });
    if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 });
    const body = requestSchema.parse(await request.json());
    received.push(body);
    return Response.json({ id: `chatcmpl-${received.length}`, choices: [await reply(body, received.length)] });
  } });
  return { origin: server.url.origin, received,
    respond(next: typeof reply) { reply = next; },
    async [Symbol.asyncDispose]() { await server.stop(true); },
  };
}
