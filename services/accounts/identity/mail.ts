import { Database } from "bun:sqlite";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

/** Operator-only local mail retrieval; filesystem access to the private data directory is required. */
export function readLocalMail(dataDir: string) {
  using db = new Database(join(resolve(dataDir), "quire.sqlite"), { readonly: true });
  return z.array(z.object({
    id: z.string(), recipient: z.string(), subject: z.string(), body: z.string(),
    status: z.string(), created_at: z.string(),
  })).parse(db.query("SELECT id,recipient,subject,body,status,created_at FROM mail_outbox WHERE status='local' ORDER BY created_at,id").all());
}
if (import.meta.main) {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: { "data-dir": { type: "string" } }, strict: true });
  const dataDir = z.string().min(1).parse(values["data-dir"]);
  console.log(JSON.stringify(readLocalMail(dataDir), null, 2));
}
