import { createPrivateKey, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { DigestSchema } from "@quire/contracts";
import { InstallationRolesSchema } from "../../services/operations/installation/binding";
import { canonicalJson, controlDigest } from "../../services/operations/installation/protocol";
import { Package, ReleaseManifest } from "../../services/operations/updates/model";

const ReleaseInput = ReleaseManifest.unwrap().omit({ packageDigest: true, packageBytes: true });
const Inventory = z.object({
  assets: z.array(z.strictObject({ path: z.string(), digest: DigestSchema })).min(1),
}).passthrough();

/** Operator-only signing tool; never imported by an application or installation role. */
export function signAdmissionRelease(input: {
  readonly package: z.input<typeof Package>;
  readonly manifest: z.input<typeof InstallationRolesSchema>;
  readonly release: z.input<typeof ReleaseInput>;
}, key: KeyObject) {
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") throw new Error("ED25519_PRIVATE_KEY_REQUIRED");
  const pack = Package.parse(input.package);
  const manifest = InstallationRolesSchema.parse(input.manifest);
  const release = ReleaseInput.parse(input.release);
  const names = pack.files.map(file => file.path);
  if (new Set(names).size !== names.length || names.some(path => path.split("/").some(part => part === "." || part === "..")) ||
      !pack.files.some(file => file.path === pack.entrypoint && file.executable)) throw new Error("ADMISSION_PACKAGE_INVALID");
  const roles = pack.files.find(file => file.path === "installation-roles.json");
  const runtime = pack.files.find(file => file.path === "installation-runtime.json");
  if (!roles || !runtime) throw new Error("ADMISSION_PACKAGE_INVENTORY_REQUIRED");
  const original = InstallationRolesSchema.parse(JSON.parse(Buffer.from(roles.data, "base64").toString("utf8")));
  if (original.installationId !== manifest.installationId) throw new Error("ADMISSION_INSTALLATION_MISMATCH");
  const inventory = Inventory.parse(JSON.parse(Buffer.from(runtime.data, "base64").toString("utf8")));
  if (!inventory.assets.some(asset => asset.path === roles.path) ||
      !inventory.assets.some(asset => asset.path === pack.entrypoint)) throw new Error("ADMISSION_PACKAGE_INVENTORY_REQUIRED");
  for (const asset of inventory.assets) {
    const assetFile = pack.files.find(file => file.path === asset.path);
    if (!assetFile || controlDigest(Buffer.from(assetFile.data, "base64")) !== asset.digest) throw new Error("ADMISSION_PACKAGE_ASSET_CHANGED");
  }
  const metadata = canonicalJson(manifest);
  const nextInventory = canonicalJson({ ...inventory, assets: inventory.assets.map(asset =>
    asset.path === roles.path ? { ...asset, digest: controlDigest(metadata) } : asset) });
  const next = { ...pack, files: pack.files.map(file => file.path === roles.path
    ? { ...file, data: Buffer.from(metadata).toString("base64") }
    : file.path === runtime.path ? { ...file, data: Buffer.from(nextInventory).toString("base64") } : file) };
  const packageBytes = Buffer.from(JSON.stringify(next));
  const signedRelease = ReleaseManifest.parse({ ...release,
    packageDigest: controlDigest(packageBytes), packageBytes: packageBytes.length });
  const payload = Buffer.from(JSON.stringify({ expiresAt: release.expiresAt, releases: [signedRelease] }));
  return { packageBytes, release: signedRelease,
    feed: { payload: payload.toString("base64"), signature: sign(null, payload, key).toString("base64") } };
}

if (import.meta.main) {
  try {
    const [packagePath, manifestPath, releasePath, keyPath] = z.tuple([
      z.string().min(1), z.string().min(1), z.string().min(1), z.string().min(1),
    ]).parse(process.argv.slice(2));
    const signed = signAdmissionRelease({
      package: Package.parse(JSON.parse(await readFile(packagePath, "utf8"))),
      manifest: InstallationRolesSchema.parse(JSON.parse(await readFile(manifestPath, "utf8"))),
      release: ReleaseInput.parse(JSON.parse(await readFile(releasePath, "utf8"))),
    }, createPrivateKey(await readFile(keyPath)));
    console.log(JSON.stringify({ package: signed.packageBytes.toString("utf8"), release: signed.release, feed: signed.feed }, null, 2));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(error.message); process.exitCode = 1;
  }
}
