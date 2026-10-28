import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { completeDrill } from "../../tests/operations/backups/drill";

const { values } = parseArgs({
  args: Bun.argv.slice(2).filter(value => value !== "--"),
  options: { fixture: { type: "string" }, evidence: { type: "string" } }, strict: true,
});
if (values.fixture !== "complete") throw new TypeError("Use --fixture complete; this command never restores live data");
await completeDrill(resolve(values.evidence ?? "docs/evidence/p2o-backup"));
