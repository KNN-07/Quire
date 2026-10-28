import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { z } from "zod";

/** Retained terminal evidence; secrets are removed before either output sink. */
export async function record(name: string, command: readonly string[]): Promise<number> {
  const target = z.string().regex(/^[a-z0-9-]+$/).parse(name);
  const secrets = Object.entries(process.env).filter(([key]) =>
    /PASSWORD|SECRET|TOKEN|BEARER|ACCESS_KEY/.test(key)).map(([, value]) => value)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  for (const file of ["runtime.env", "compose.env"]) {
    const path = `/tmp/quire-p2o-deployment-compose/${file}`;
    if (await Bun.file(path).exists()) {
      const values = (await readFile(path, "utf8")).split("\n");
      for (const entry of values) {
        const [key, value] = entry.split("=");
        if (key && value && /PASSWORD|SECRET|TOKEN|BEARER/.test(key)) secrets.push(value);
      }
    }
  }
  const redact = (text: string) => secrets.reduce((value, secret) =>
    secret ? value.replaceAll(secret, "[REDACTED]") : value, text);
  const child = Bun.spawn([...command], {
    stdout: "pipe", stderr: "pipe", stdin: "ignore", signal: AbortSignal.timeout(600_000),
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  for (const file of ["compose-proof.json", "cluster-proof.json", "compose-backup-proof.json", "cluster-backup-proof.json"]) {
    const path = `/tmp/quire-p2o-deployment-compose/${file}`;
    if (await Bun.file(path).exists()) {
      const state = z.object({ cookie: z.string(), csrf: z.string().optional() }).parse(await Bun.file(path).json());
      secrets.push(state.cookie);
      if (state.csrf) secrets.push(state.csrf);
    }
  }
  const log = redact(`COMMAND ${command.join(" ")}\nEXIT ${exit}\nSTDOUT\n${stdout}\nSTDERR\n${stderr}`);
  const directory = resolve("docs/evidence/p2o-deployment");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${target}.log`), log);
  console.info(log);
  return exit;
}
if (import.meta.main) {
  const name = z.string().min(1).parse(process.argv[2]);
  const command = z.array(z.string()).min(1).parse(process.argv.slice(3));
  process.exitCode = await record(name, command);
}
