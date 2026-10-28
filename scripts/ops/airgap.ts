import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { EnvironmentSchema } from "@quire/contracts";
import { ArtifactError, checked, copyRelease, freshDirectory } from "../../deploy/runtime/artifacts";
import { bundleManifestSchema, inventory } from "../../deploy/runtime/manifest";
import type { BundleManifest } from "../../deploy/runtime/manifest";

const createSchema = z.strictObject({
  source: z.string().min(1), output: z.string().min(1), bun: z.string().min(1),
  signingKey: z.string().min(1), images: z.array(z.string().min(1)).min(1).readonly(),
  environments: z.array(EnvironmentSchema).readonly().optional(),
}).readonly();
export type BundleOptions = z.input<typeof createSchema>;

async function imageContent(reference: string): Promise<string> {
  // Docker 29 normalizes index descriptors to a platform manifest on load.
  // Configuration and uncompressed rootfs identities survive that envelope change.
  const content = await checked(["docker", "image", "inspect", reference, "--format",
    "{{json .Config}}|{{json .RootFS}}|{{.Os}}|{{.Architecture}}"]);
  return new Bun.CryptoHasher("sha256").update(content).digest("hex");
}

/** Creates a directory bundle: complete packages, Bun and actual docker-save bytes. */
export async function createBundle(input: BundleOptions): Promise<BundleManifest> {
  const options = createSchema.parse(input);
  const version = await checked([options.bun, "--version"]);
  if (version !== "1.4.4") throw new ArtifactError("BUN_VERSION_REQUIRED", version);
  const key = createPrivateKey(await readFile(options.signingKey));
  if (key.asymmetricKeyType !== "ed25519") throw new ArtifactError("ED25519_KEY_REQUIRED", options.signingKey);
  const images = [];
  for (const reference of options.images) {
    const architecture = await checked(["docker", "image", "inspect", reference, "--format", "{{.Architecture}}"]);
    const expected = process.arch === "x64" ? "amd64" : process.arch;
    if (architecture !== expected) throw new ArtifactError("IMAGE_ARCHITECTURE_MISMATCH", `${reference}: ${architecture}`);
    const id = z.string().regex(/^sha256:[a-f0-9]{64}$/).parse(
      await checked(["docker", "image", "inspect", reference, "--format", "{{.Id}}"]));
    images.push({ reference, id, contentDigest: await imageContent(reference) });
  }
  const root = await freshDirectory(options.output);
  const payload = join(root, "payload");
  await mkdir(payload, { mode: 0o700 });
  await mkdir(join(payload, "release"), { mode: 0o700 });
  await copyRelease(options.source, join(payload, "release"));
  await mkdir(join(payload, "runtime"), { mode: 0o700 });
  await copyFile(resolve(options.bun), join(payload, "runtime/bun"));
  if (options.environments) {
    await writeFile(join(payload, "environments.json"), JSON.stringify(options.environments, null, 2) + "\n",
      { mode: 0o600, flag: "wx" });
  }
  await checked(["docker", "image", "save", "--platform", `linux/${process.arch === "x64" ? "amd64" : process.arch}`,
    "--output", join(payload, "images.tar"), ...options.images]);
  const manifest = bundleManifestSchema.parse({
    format: "quire-airgap-v1", bun: version, platform: process.platform,
    architecture: process.arch, images, files: await inventory(payload),
  });
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(join(root, "manifest.json"), bytes, { flag: "wx", mode: 0o600 });
  await writeFile(join(root, "manifest.sig"), sign(null, bytes, key), { flag: "wx", mode: 0o600 });
  return manifest;
}

/** Trust comes from the separately provisioned public key, never a bundled key. */
export async function verifyBundle(root: string, publicKey: string): Promise<BundleManifest> {
  const bytes = await readFile(join(root, "manifest.json"));
  const key = createPublicKey(await readFile(publicKey));
  if (key.asymmetricKeyType !== "ed25519" ||
      !verify(null, bytes, key, await readFile(join(root, "manifest.sig")))) {
    throw new ArtifactError("BUNDLE_SIGNATURE_INVALID", root);
  }
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  const manifest = bundleManifestSchema.parse(parsed);
  if (manifest.platform !== process.platform || manifest.architecture !== process.arch) {
    throw new ArtifactError("BUNDLE_ARCHITECTURE_MISMATCH", manifest.architecture);
  }
  const actual = await inventory(join(root, "payload"));
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) {
    throw new ArtifactError("BUNDLE_CONTENT_MISMATCH", root);
  }
  return manifest;
}

export async function loadBundle(root: string, publicKey: string): Promise<void> {
  const manifest = await verifyBundle(root, publicKey);
  await checked(["docker", "image", "load", "--input", join(root, "payload/images.tar")]);
  for (const image of manifest.images) {
    if (await imageContent(image.reference) !== image.contentDigest) {
      throw new ArtifactError("BUNDLE_IMAGE_MISMATCH", image.reference);
    }
  }
}

if (import.meta.main) {
  const args = parseArgs({ allowPositionals: true, strict: true, options: {
    source: { type: "string" }, output: { type: "string" }, bun: { type: "string", default: process.execPath },
    "signing-key": { type: "string" }, "public-key": { type: "string" },
    environments: { type: "string" },
    image: { type: "string", multiple: true, default: [] },
  } });
  const action = z.string().min(1).parse(args.positionals[0]);
  const root = args.positionals[1];
  switch (action) {
    case "create":
      {
      const result = await createBundle(createSchema.parse({
        source: args.values.source, output: args.values.output, bun: args.values.bun,
        signingKey: args.values["signing-key"], images: args.values.image,
        ...(args.values.environments ? {
          environments: z.array(EnvironmentSchema).parse(await Bun.file(args.values.environments).json()),
        } : {}),
      }));
      console.info(JSON.stringify({ files: result.files.length, images: result.images, architecture: result.architecture }));
      break;
      }
    case "verify":
      {
      const result = await verifyBundle(z.string().min(1).parse(root),
        z.string().min(1).parse(args.values["public-key"]));
      console.info(JSON.stringify({ files: result.files.length, images: result.images, architecture: result.architecture }));
      break;
      }
    case "load":
      await loadBundle(z.string().min(1).parse(root), z.string().min(1).parse(args.values["public-key"]));
      break;
    default: throw new ArtifactError("USAGE", "airgap.ts create|verify|load [bundle] --public-key <trusted-key>");
  }
}
