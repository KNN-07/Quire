import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServiceError } from "@quire/runtime";
import type { Id, RequestOf } from "@quire/contracts";
import { assertNever, IdSchema } from "@quire/contracts";
import type { endpoints } from "@quire/contracts";
import { sandbox, defaultLimits } from "../../workers/compiler/sandbox";
import type { CompilerService } from "./service";

export async function syncTex(service: CompilerService, actor: Id,
  input: RequestOf<typeof endpoints.synctex>) {
  const job = await service.get(actor, IdSchema.parse(input.params.id));
  const root = await mkdtemp(join(tmpdir(), "quire-synctex-"));
  try {
    for (const name of ["output.pdf", "output.synctex.gz"]) {
      const artifact = job.artifacts.find((item) => item.name === name);
      if (!artifact) throw new ServiceError("SYNCTEX_UNAVAILABLE", 409, "Successful PDF and SyncTeX data are required");
      await writeFile(join(root, name), await service.context.blobs.get(artifact.sha256));
    }
    const source = await service.context.services.get("projects").readSnapshot(job.snapshot.id);
    const query = input.body;
    let args: readonly string[];
    switch (query.direction) {
      case "forward": {
        const file = source.files.find((item) => item.id === query.fileId);
        if (!file) throw new ServiceError("FILE_NOT_IN_SNAPSHOT", 404, "File is not in this compile snapshot");
        args = ["synctex", "view", "-i", `${query.line}:${query.column}:/src/${file.path}`, "-o", "/src/output.pdf"];
        break;
      }
      case "reverse":
        args = ["synctex", "edit", "-o", `${query.page}:${query.xPt}:${query.yPt}:/src/output.pdf`];
        break;
      default: return assertNever(query);
    }
    const result = await sandbox({ source: root, limits: defaultLimits, command: args, signal: service.shutdown.signal });
    if (result.code !== 0 || result.canceled) throw new ServiceError("SYNCTEX_FAILED", 422, result.stderr);
    const text = new TextDecoder().decode(result.stdout);
    const records = text.split(/(?=Output:)/).filter((part) => part.includes("Input:") || part.includes("Page:"));
    const number = (record: string, key: string) => {
      const value = new RegExp(`^${key}:([-\\d.]+)`, "m").exec(record)?.[1];
      if (value === undefined || !Number.isFinite(Number(value))) {
        throw new ServiceError("SYNCTEX_OUTPUT_INVALID", 502, "SyncTeX returned an invalid coordinate");
      }
      return Number(value);
    };
    switch (query.direction) {
      case "forward": return records.map((record) => ({
        page: number(record, "Page"), xPt: number(record, "h"), yPt: number(record, "v") - number(record, "H"),
        widthPt: number(record, "W"), heightPt: number(record, "H"),
      }));
      case "reverse": return records.flatMap((record) => {
        const path = /^Input:(.+)$/m.exec(record)?.[1]?.replace(/^\/src\//, "");
        const file = source.files.find((item) => item.path === path);
        return file ? [{ fileId: file.id, line: number(record, "Line"), column: Math.max(0, number(record, "Column")) }] : [];
      });
      default: return assertNever(query);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}
