import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const password = "bootstrap-template-development-password";
export async function seedCommand(dataDir: string, script: "db:migrate" | "seed") {
  const child = Bun.spawn([resolve("node_modules/.bin/bun"), "run", script], {
    cwd: resolve("."), stdout: "pipe", stderr: "pipe",
    env: { ...process.env, NODE_ENV: "development", QUIRE_PROFILE: "local",
      QUIRE_HOST: "127.0.0.1", QUIRE_DATA_DIR: dataDir, QUIRE_SEED_PASSWORD: password },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  console.info("BOOTSTRAP_COMMAND", { script, dataDir, code, stdout, stderr });
  if (code !== 0) throw new Error(`${script} exited ${code}: ${stderr}`);
}
/** Uses exactly the documented migrate and seed entrypoints on an empty owned root. */
export async function cleanBootstrap() {
  const dataDir = await mkdtemp(join(tmpdir(), "quire-p40-bootstrap-template-"));
  try {
    await seedCommand(dataDir, "db:migrate");
    await seedCommand(dataDir, "seed");
    return { dataDir, password, async [Symbol.asyncDispose]() {
      await rm(dataDir, { recursive: true, force: true });
      console.info("BOOTSTRAP_ROOT_CLEANED", dataDir);
    } };
  } catch (error) {
    await rm(dataDir, { recursive: true, force: true });
    throw error;
  }
}
