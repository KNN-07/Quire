import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Id, Scope } from "@quire/contracts";
import type { CoreProjects } from "./projects";
import { fail } from "./store";

export async function searchProject(service: CoreProjects, scope: Scope, query: {
  readonly q: string; readonly case: "true" | "false"; readonly regex: "true" | "false"; readonly word: "true" | "false";
}) {
  if (query.q.length === 0 || query.q.length > 1000) fail("INVALID_SEARCH", 400, "Search must contain 1-1000 characters");
  let pattern: string;
  try {
    const source = query.regex === "true" ? query.q : query.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = query.word === "true" ? `\\b(?:${source})\\b` : source;
    pattern = new RegExp(pattern, "u").source;
  } catch (error) { if (error instanceof SyntaxError) fail("INVALID_REGEX", 400, error.message); throw error; }
  const excluded: { readonly fileId: Id; readonly reason: string }[] = [];
  const files: { readonly id: Id; readonly text: string }[] = [];
  for (const file of (await service.listFiles(scope))) {
    if (file.kind === "folder") continue;
    if (!file.editable) { excluded.push({ fileId: file.id, reason: file.link ? "linked source" : "binary or edit-size limit" }); continue; }
    files.push({ id: file.id, text: (await service.readDocument(scope, file.id)).text });
  }
  const worker = new Worker(new URL("./search-worker.ts", import.meta.url).href);
  const signal = AbortSignal.timeout(1000);
  const resultSchema = z.array(z.object({ fileId: IdSchema, line: z.number(), column: z.number(), preview: z.string() }));
  let abort: () => void = () => undefined;
  try {
    const matches = await new Promise<z.infer<typeof resultSchema>>((resolve, reject) => {
      abort = () => reject(new SearchLimitError());
      signal.addEventListener("abort", abort, { once: true });
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const parsed = resultSchema.safeParse(event.data);
        if (parsed.success) resolve(parsed.data);
        else reject(parsed.error);
      };
      worker.onerror = (event) => reject(new SearchWorkerError(event.message));
      worker.postMessage({ files, pattern, flags: query.case === "true" ? "gu" : "giu" });
    });
    return { matches, excluded };
  } finally { signal.removeEventListener("abort", abort); worker.terminate(); }
}
import { ServiceError } from "@quire/runtime";
class SearchLimitError extends ServiceError {
  constructor() { super("SEARCH_LIMIT", 422, "Search exceeded its CPU budget; simplify the expression"); }
}
class SearchWorkerError extends ServiceError {
  constructor(message: string) { super("SEARCH_FAILED", 500, message); }
}
