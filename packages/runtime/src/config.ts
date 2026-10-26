import { mkdir, chmod, readFile, writeFile, open } from "node:fs/promises";
import { resolve, join } from "node:path";
import { z } from "zod";
import { StorageError } from "./errors";

const ConfigSchema = z.object({
  dataDir: z.string().min(1), host: z.string().min(1), port: z.coerce.number().int().min(1).max(65535),
  publicUrl: z.url(), production: z.boolean(),
  profile: z.enum(["local", "scale"]), compilerBackend: z.enum(["bwrap", "docker"]),
  maxRequestBytes: z.coerce.number().int().positive(),
}).readonly();
export type RuntimeConfig = z.infer<typeof ConfigSchema>;
export function loadConfig(env: Readonly<Record<string, string | undefined>> = process.env): RuntimeConfig {
  return ConfigSchema.parse({
    dataDir: resolve(env["QUIRE_DATA_DIR"] ?? ".data"), host: env["QUIRE_HOST"] ?? "127.0.0.1",
    port: env["QUIRE_PORT"] ?? "3001", publicUrl: env["QUIRE_PUBLIC_URL"] ?? "http://localhost:5173",
    production: env["NODE_ENV"] === "production",
    profile: env["QUIRE_PROFILE"] ?? "local", compilerBackend: env["QUIRE_COMPILER_BACKEND"] ?? "bwrap",
    maxRequestBytes: env["QUIRE_MAX_REQUEST_BYTES"] ?? 64 * 1024 * 1024,
  });
}
export async function prepareData(config: RuntimeConfig): Promise<void> {
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  await chmod(config.dataDir, 0o700);
  for (const name of ["blobs", "git", "mail", "work"]) {
    await mkdir(join(config.dataDir, name), { recursive: true, mode: 0o700 });
  }
}
export async function loadSecretKey(config: RuntimeConfig): Promise<Uint8Array> {
  const schema = z.string().regex(/^[0-9a-f]{64}$/);
  const configured = process.env["QUIRE_SECRET_KEY"];
  if (configured) return Buffer.from(schema.parse(configured), "hex");
  if (config.production) throw new StorageError("SECRET_KEY_REQUIRED", config.dataDir);
  const path = join(config.dataDir, "secret.key");
  try {
    return Buffer.from(schema.parse((await readFile(path, "utf8")).trim()), "hex");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  try {
    await writeFile(path, key + "\n", { mode: 0o600, flag: "wx" });
    const file = await open(path, "r");
    try { await file.sync(); } finally { await file.close(); }
    const directory = await open(config.dataDir, "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    return Buffer.from(schema.parse((await readFile(path, "utf8")).trim()), "hex");
  }
  return Buffer.from(key, "hex");
}
