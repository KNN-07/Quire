import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sandbox, defaultLimits } from "../../workers/compiler/sandbox";

export async function pdfText(bytes: Uint8Array): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "quire-pdf-text-"));
  try {
    await writeFile(join(root, "document.pdf"), bytes);
    const result = await sandbox({ source: root, limits: defaultLimits,
      command: ["pdftotext", "/src/document.pdf", "-"] });
    if (result.code !== 0) throw new TypeError(result.stderr);
    return new TextDecoder().decode(result.stdout);
  } finally { await rm(root, { recursive: true, force: true }); }
}
