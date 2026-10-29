import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const dispositions = ["MOUNT", "UI", "BE", "EXT", "PART", "GAP", "BOUND"] as const;
type Disposition = typeof dispositions[number];
const rows = (text: string) => text.split("\n").flatMap(line => {
  const id = /^\|\s*([A-Z]\d{2}[a-z]?)(?=\s|\|)/u.exec(line)?.[1];
  return id && !id.startsWith("T") && !id.startsWith("Q") ? [{ id, line }] : [];
});
const duplicates = (ids: readonly string[]) => [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort();

export function checkFeatureMapping(input: {
  readonly core: string; readonly services: string; readonly design: string; readonly matrix: string;
}) {
  const core = rows(input.core).map(row => row.id);
  const services = rows(input.services).map(row => row.id);
  const design = [...input.design.matchAll(/^\|\s*`(\d{2})-[^`]+`\s*\|/gmu)].map(match => `D${match[1]}`);
  const expected = [...core, ...services, ...design];
  const mapped = rows(input.matrix);
  const ids = mapped.map(row => row.id);
  const missing = expected.filter(id => !ids.includes(id)).sort();
  const unexpected = ids.filter(id => !expected.includes(id)).sort();
  const inventoryDuplicates = duplicates(expected);
  const matrixDuplicates = duplicates(ids);
  const declaredCoverage: Record<Disposition, number> = { MOUNT: 0, UI: 0, BE: 0, EXT: 0, PART: 0, GAP: 0, BOUND: 0 };
  const missingDisposition: string[] = [];
  for (const row of mapped) {
    const disposition = dispositions.find(value => row.line.includes(`**${value}**`));
    if (disposition) declaredCoverage[disposition]++;
    else missingDisposition.push(row.id);
  }
  const emptyInventories = Object.entries({ core, services, design }).filter(([, values]) => values.length === 0).map(([name]) => name);
  return {
    scope: "capability-mapping-only" as const, behavioralAcceptance: false,
    mappingComplete: [missing, unexpected, inventoryDuplicates, matrixDuplicates, missingDisposition, emptyInventories]
      .every(values => values.length === 0),
    inventory: { core: core.length, services: services.length, design: design.length, total: expected.length },
    mapped: mapped.length, declaredCoverage, missing, unexpected, inventoryDuplicates, matrixDuplicates,
    missingDisposition, emptyInventories,
  };
}

if (import.meta.main) {
  const command = process.argv[2];
  if (command === "matrix") {
    const [core, services, design, matrix] = await Promise.all([
      "docs/discovery/core.md", "docs/discovery/services.md", "docs/discovery/design.md", "docs/feature-matrix.md",
    ].map(path => readFile(new URL(path, new URL("../../../", import.meta.url)), "utf8")));
    if (core === undefined || services === undefined || design === undefined || matrix === undefined) {
      throw new TypeError("All capability inventories are required");
    }
    const report = checkFeatureMapping({ core, services, design, matrix });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.mappingComplete ? 0 : 1;
  } else if (command === "restore" || command === "scale") {
    const args = command === "restore"
      ? ["test", "tests/operations/backups/native.test.ts", "--test-name-pattern", "restores all tables"]
      : ["run", "test:scale"];
    console.info(command === "restore"
      ? "Running the local SQLite/blob/Git restore drill in owned temporary fixtures; no live installation restore."
      : "Running the configured portable scale checks.");
    const child = Bun.spawn([process.execPath, ...args], { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    process.exitCode = await child.exited;
  } else {
    console.error("Usage: bun packages/runtime/src/verification.ts matrix|restore|scale");
    process.exitCode = 2;
  }
}
