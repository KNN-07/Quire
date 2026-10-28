import { lstat, readdir, readlink } from "node:fs/promises";
import { join, relative, resolve, dirname, sep } from "node:path";
import { z } from "zod";
import { ArtifactError } from "./artifacts";

const pathSchema = z.string().min(1).refine(path => !path.startsWith("/") &&
  !path.split("/").some(part => part === ".." || part === "." || part === ""));
const entrySchema = z.discriminatedUnion("kind", [z.strictObject({
  kind: z.literal("file"),
  path: pathSchema,
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  executable: z.boolean(),
}).readonly(), z.strictObject({
  kind: z.literal("symlink"), path: pathSchema, target: z.string().min(1),
}).readonly()]);
export const bundleManifestSchema = z.strictObject({
  format: z.literal("quire-airgap-v1"),
  bun: z.literal("1.4.4"),
  platform: z.literal("linux"),
  architecture: z.enum(["x64", "arm64"]),
  images: z.array(z.strictObject({
    reference: z.string().min(1), id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }).readonly()).readonly(),
  files: z.array(entrySchema).readonly(),
}).readonly();
export type BundleManifest = z.output<typeof bundleManifestSchema>;

export async function inventory(root: string): Promise<BundleManifest["files"]> {
  const entries: z.output<typeof entrySchema>[] = [];
  const scan = async (directory: string): Promise<void> => {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) {
        const target = await readlink(path);
        if (!resolve(dirname(path), target).startsWith(resolve(root) + sep)) {
          throw new ArtifactError("BUNDLE_SYMLINK_FORBIDDEN", path);
        }
        entries.push({ kind: "symlink", path: relative(root, path), target });
      } else if (metadata.isDirectory()) await scan(path);
      else if (metadata.isFile()) {
        const hasher = new Bun.CryptoHasher("sha256");
        const reader = Bun.file(path).stream().getReader();
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            hasher.update(chunk.value);
          }
        } finally { reader.releaseLock(); }
        entries.push({
          kind: "file", path: relative(root, path), bytes: metadata.size,
          sha256: hasher.digest("hex"), executable: (metadata.mode & 0o111) !== 0,
        });
      }
      else throw new ArtifactError("BUNDLE_SPECIAL_FILE_FORBIDDEN", path);
    }
  };
  await scan(root);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
