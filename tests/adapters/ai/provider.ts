import { z } from "zod";
import { AiToolSchema } from "@quire/contracts";
import type { Answer } from "../../../services/adapters/ai/model";

const ContextSchema = z.object({
  tool: AiToolSchema, prompt: z.string(), files: z.array(z.object({
    id: z.string(), path: z.string(), from: z.number(), to: z.number(), text: z.string(),
  })), diagnostic: z.string().nullable(), publications: z.array(z.unknown()),
});
const RequestSchema = z.object({
  model: z.string(), stream: z.literal(false), store: z.literal(false),
  response_format: z.object({ type: z.literal("json_object") }),
  messages: z.array(z.object({ role: z.enum(["user", "assistant", "system"]),
    content: z.union([z.string(), z.array(z.union([
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({ type: z.literal("image_url"), image_url: z.object({ url: z.string() }) }),
    ]))]) })),
});
export function providerServer() {
  const received: z.infer<typeof RequestSchema>[] = [];
  const contexts: z.infer<typeof ContextSchema>[] = [];
  let reply: (context: z.infer<typeof ContextSchema>) => unknown = () => ({ text: "Done", patches: [], citations: [] });
  let status = 200;
  let gated: { readonly release: Promise<void>; readonly entered: () => void; readonly finish: () => void } | undefined;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (new URL(request.url).pathname === "/works" && request.method === "GET") {
      if (!new URL(request.url).searchParams.has("query.bibliographic")) return new Response(null, { status: 400 });
      return Response.json({ message: { items: [{ DOI: "10.1234/verified", title: ["Retrieved paper"],
        author: [{ given: "Ada", family: "Example" }], issued: { "date-parts": [[2025]] } }], "total-results": 1 } });
    }
    if (request.headers.get("authorization") !== "Bearer fixture-ai-key") return Response.json({ error: { code: "invalid_api_key" } }, { status: 401 });
    if (new URL(request.url).pathname === "/v1/models") return Response.json({ data: [{ id: "fixture-model" }] });
    if (new URL(request.url).pathname !== "/v1/chat/completions" || request.method !== "POST") return new Response(null, { status: 404 });
    const parsed = RequestSchema.safeParse(await request.json());
    if (!parsed.success || parsed.data.model !== "fixture-model") return Response.json({ error: { code: "invalid_request_error" } }, { status: 400 });
    received.push(parsed.data);
    const last = parsed.data.messages.at(-1);
    const part = last && Array.isArray(last.content) ? last.content[0] : undefined;
    if (!part || part.type !== "text") return new Response(null, { status: 400 });
    const context = ContextSchema.parse(JSON.parse(part.text));
    contexts.push(context);
    if (gated) { gated.entered(); await gated.release; }
    if (status !== 200) return Response.json({ error: { code: "fixture_error" } }, { status });
    return Response.json({ id: `chatcmpl-${received.length}`, object: "chat.completion",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(reply(context)) } }] });
  } });
  return { origin: server.url.origin, received, contexts,
    respond(value: Answer | ((context: z.infer<typeof ContextSchema>) => unknown)) { reply = typeof value === "function" ? value : () => value; },
    status(value: number) { status = value; },
    gate() {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      gated = { entered: () => entered.resolve(), release: release.promise, finish: () => release.resolve() };
      return { entered: entered.promise, release: () => { release.resolve(); gated = undefined; } };
    },
    async [Symbol.asyncDispose]() { gated?.finish(); gated = undefined; await server.stop(true); },
  };
}
