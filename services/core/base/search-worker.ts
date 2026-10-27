import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";

const inputSchema = z.object({
  files: z.array(z.object({ id: IdSchema, text: z.string() })), pattern: z.string(), flags: z.string(),
});
addEventListener("message", (event: MessageEvent<unknown>) => {
  const input = inputSchema.parse(event.data);
  const expression = new RegExp(input.pattern, input.flags);
  const matches: { readonly fileId: Id; readonly line: number; readonly column: number; readonly preview: string }[] = [];
  outer: for (const file of input.files) {
    for (const [index, line] of file.text.split("\n").entries()) {
      expression.lastIndex = 0;
      for (const match of line.matchAll(expression)) {
        matches.push({ fileId: file.id, line: index + 1, column: match.index + 1, preview: line.slice(0, 500) });
        if (matches.length >= 10000) break outer;
      }
    }
  }
  postMessage(matches);
});
