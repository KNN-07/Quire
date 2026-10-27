import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function retain(name: string, bytes: Uint8Array): Promise<void> {
  const root = process.env["QUIRE_COMPILER_EVIDENCE_DIR"];
  if (!root) return;
  await mkdir(root, { recursive: true });
  await writeFile(join(root, name), bytes);
}
