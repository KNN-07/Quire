import { IdSchema } from "@quire/contracts";
import type { Diagnostic, FileEntry, Id } from "@quire/contracts";

export function parseDiagnostics(input: { readonly jobId: Id; readonly log: string;
  readonly files: readonly FileEntry[] }): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let offset = 0;
  const stack: { readonly file: FileEntry; readonly depth: number }[] = [];
  let depth = 0;
  for (const line of input.log.split("\n")) {
    for (let index = 0; index < line.length; index++) {
      if (line[index] === "(") {
        depth++;
        const file = input.files.find((item) => line.slice(index + 1).startsWith(`/src/${item.path}`) ||
          line.slice(index + 1).startsWith(`./${item.path}`));
        if (file) stack.push({ file, depth });
      } else if (line[index] === ")") {
        depth = Math.max(0, depth - 1);
        while (stack.length && (stack.at(-1)?.depth ?? 0) > depth) stack.pop();
      }
    }
    const candidate = /^(?:\/src\/|\.\/)?(.+?):(\d+):\s*(.*)$/.exec(line);
    const source = candidate ? input.files.find(item => item.path === candidate[1]) : undefined;
    const located = candidate && (source || /\.(?:tex|sty|cls|ltx|bib|bbl|cfg|def|lua)$/i.test(candidate[1] ?? ""))
      ? candidate : null;
    const errorLine = /^l\.(\d+)\s/.exec(line);
    const message = located?.[3] ?? line;
    const warning = /(?:LaTeX|Package .+) Warning:/.test(message);
    const typesetting = /^(?:Over|Under)full \\[hv]box/.test(message);
    const error = line.startsWith("!") || (!!located && !warning && !typesetting);
    if (error || warning || typesetting) {
      const file = located ? source : stack.at(-1)?.file;
      diagnostics.push({
        id: IdSchema.parse(crypto.randomUUID()), jobId: input.jobId,
        severity: error ? "error" : warning ? "warning" : "typesetting",
        message, fileId: file?.id ?? null,
        line: located?.[2] ? Number(located[2]) : errorLine?.[1] ? Number(errorLine[1]) : null,
        column: null, rawStart: offset, rawEnd: offset + line.length,
      });
    }
    offset += line.length + 1;
  }
  return diagnostics;
}
