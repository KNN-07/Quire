import { readdir } from "node:fs/promises";

const directory = "docs/evidence/p4-benefits-controls";
const sources = [
  "apps/web/src/features/admin/ProjectBenefits.tsx",
  "apps/web/src/features/admin/project-benefits.css",
  "apps/web/src/features/admin/index.tsx",
  "apps/web/src/features/editor/review/WritableMembers.tsx",
  "apps/web/src/features/editor/review/benefits.css",
  "apps/web/src/features/editor/review/share.tsx",
  "apps/web/src/features/editor/review/share-access.tsx",
] as const;
const captures = (await readdir(directory)).filter(name => name.endsWith(".png")).sort()
  .map(name => `${directory}/${name}`);
for (const [name, paths] of [["source", sources], ["captures", captures]] as const) {
  const lines = [];
  for (const path of paths) {
    const digest = new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
    lines.push(`${digest}  ${path}`);
  }
  await Bun.write(`${directory}/${name}.sha256`, lines.join("\n") + "\n");
  console.info(`P4_MANIFEST ${name}: ${paths.length} files`);
}
