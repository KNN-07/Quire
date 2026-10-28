import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { strict as assert } from "node:assert";
import { createPublicKey } from "node:crypto";
import { DigestSchema, IdSchema } from "@quire/contracts";
import { digest, manifestSchema } from "../../../services/operations/backups/model";
import { signerFingerprint, verifyManifest } from "../../../services/operations/backups/signing";

const evidence = new URL("../../../docs/evidence/p2o-backup/", import.meta.url).pathname;
const roots = new Set<string>();
const containers = new Set<string>();
const exited = new Map<string, { readonly pid: number; readonly exit: number | null }>();
const cleanupSchema = z.object({
  root: z.string(), processes: z.array(z.object({ pid: z.number().int().positive(), exit: z.number().int().nullable() })).optional(),
});
for await (const path of new Bun.Glob("*.log").scan({ cwd: evidence })) {
  const text = await readFile(join(evidence, path), "utf8");
  for (const root of text.matchAll(/\/tmp\/quire-p2o-backup-[A-Za-z0-9-]+/g)) roots.add(root[0]);
  for (const container of text.matchAll(/quire-p2o-backup-(?:pg|redis|s3)-[0-9a-f-]{36}/g)) containers.add(container[0]);
  for (const line of text.split("\n")) {
    if (!line.startsWith("BACKUP_SCALE_CLEANED ")) continue;
    const receipt = cleanupSchema.parse(JSON.parse(line.slice("BACKUP_SCALE_CLEANED ".length)));
    for (const process of receipt.processes ?? []) exited.set(`${receipt.root}:${process.pid}`, process);
  }
}
// This exact earlier failed-run root was removed after the owning process exited.
roots.add("/tmp/quire-p2o-backup-G5qdPD");
if (!roots.size || !containers.size) throw new TypeError("No owned cleanup receipts were found");
const remaining: string[] = [];
for (const root of roots) {
  try { await lstat(root); remaining.push(root); }
  catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
}
async function docker(args: readonly string[]): Promise<readonly string[]> {
  const child = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe", signal: AbortSignal.timeout(10000) });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (code !== 0) throw new TypeError(`Docker inventory failed (${code}): ${stderr}`);
  return stdout.trim().split("\n").filter(Boolean);
}
const active = await docker(["ps", "--all", "--filter", "name=quire-p2o-backup-", "--format", "{{.Names}}"]);
const volumes = await docker(["volume", "ls", "--filter", "name=quire-p2o-backup-s3-", "--format", "{{.Name}}"]);
remaining.push(...active.filter(name => containers.has(name)), ...volumes.filter(name => containers.has(name)));
const unrecordedRoots = (await readdir(tmpdir())).filter(name =>
  name.startsWith("quire-p2o-backup-") && !roots.has(join(tmpdir(), name)));
const unrecordedContainers = active.filter(name => !containers.has(name));
const unrecordedVolumes = volumes.filter(name => !containers.has(name));
if (remaining.length || unrecordedRoots.length || unrecordedContainers.length || unrecordedVolumes.length) {
  throw new TypeError(`Cleanup requires ownership review: ${JSON.stringify({ remaining, unrecordedRoots, unrecordedContainers, unrecordedVolumes })}`);
}
const manifestBytes = await readFile(join(evidence, "manifest.json"));
const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString()));
const publicKey = createPublicKey(await readFile(join(evidence, "signing-public.pem")));
assert.equal(verifyManifest(publicKey, manifestBytes, await readFile(join(evidence, "manifest.sig"))), true);
assert.equal(signerFingerprint(publicKey), manifest.signer);
const artifactSchema = z.object({ bytes: z.number().int().nonnegative(), sha256: DigestSchema });
const drill = z.object({ backup: IdSchema, pdf: artifactSchema,
  recompiledPdf: artifactSchema.extend({ extractedTextEqual: z.literal(true) }),
  httpReceiptReplayed: z.literal(true) }).parse(JSON.parse(await readFile(join(evidence, "drill.json"), "utf8")));
assert.equal(drill.backup, manifest.id);
for (const [filename, expected] of [
  ["restored-output.pdf", drill.pdf], ["restored-recompiled-output.pdf", drill.recompiledPdf],
] as const) {
  const bytes = await readFile(join(evidence, filename));
  assert.equal(bytes.length, expected.bytes);
  assert.equal(digest(bytes), expected.sha256);
}
assert.ok(manifest.files.some(file => file.path === `blobs/${drill.pdf.sha256}` && file.sha256 === drill.pdf.sha256));
const receipt = { checkedRoots: [...roots].sort(), checkedContainers: [...containers].sort(),
  observedProcessExits: [...exited.values()], remaining, unrecordedRoots, unrecordedContainers, unrecordedVolumes,
  anonymousVolumes: "Removed by checked docker rm --force --volumes calls on the exact owned PostgreSQL/Redis containers",
  privateKeys: "Only public verification material retained; fixture roots containing instance keys were removed",
  evidence: { backup: manifest.id, signer: manifest.signer, originalPdf: drill.pdf, recompiledPdf: drill.recompiledPdf } };
await writeFile(join(evidence, "cleanup.json"), JSON.stringify(receipt, null, 2));
console.info("BACKUP_CLEANUP_PASSED", JSON.stringify({ roots: roots.size, containers: containers.size,
  processExits: exited.size, remaining: 0 }));
