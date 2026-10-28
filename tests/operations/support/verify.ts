import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const evidence = join(root, "docs/evidence/p2o-support");
const checks = [
  { name: "support-tests", command: ["bun", "test", "tests/operations/support"] },
  { name: "support-strict", command: ["node_modules/.bin/tsc", "--noEmit", "--pretty", "false", "-p", "tests/operations/support/tsconfig.json"] },
  { name: "support-lint", command: ["node_modules/.bin/oxlint", "--type-aware", "--deny-warnings",
    "services/operations/support", "scripts/ops/doctor.ts", "tests/operations/support"] },
] as const;

if (import.meta.main) {
  await mkdir(evidence, { recursive: true });
  const results: { readonly name: string; readonly exit: number }[] = [];
  for (const check of checks) {
    const child = Bun.spawn([...check.command], {
      cwd: root, env: { ...process.env, QUIRE_SUPPORT_EVIDENCE: evidence },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    const transcript = `$ ${check.command.join(" ")}\n${stdout}${stderr}\nEXIT ${exit}\n`;
    await writeFile(join(evidence, `${check.name}.log`), transcript);
    console.log(transcript);
    results.push({ name: check.name, exit });
  }
  const dataDir = await mkdtemp(join(tmpdir(), "quire-p2o-support-doctor-cli-"));
  const api = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null, { status: 204 }) });
  const port = Number(api.url.port);
  try {
    const child = Bun.spawn(["bun", "scripts/ops/doctor.ts"], {
      cwd: root, env: { ...process.env, QUIRE_DATA_DIR: dataDir, QUIRE_PROFILE: "local",
        QUIRE_HOST: "127.0.0.1", QUIRE_PORT: String(port), NODE_ENV: "test", QUIRE_SECRET_KEY: undefined },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    const transcript = `$ QUIRE_DATA_DIR=<owned temporary root> bun scripts/ops/doctor.ts\n${stdout}${stderr}\nEXIT ${exit}\n`;
    await writeFile(join(evidence, "doctor-cli.log"), transcript);
    console.log(transcript);
    results.push({ name: "doctor-cli", exit });
  } finally {
    await api.stop(true);
    await rm(dataDir, { recursive: true, force: true });
    await writeFile(join(evidence, "doctor-cli-cleanup.json"), JSON.stringify({ dataDir, port, closed: true }, null, 2));
  }
  await writeFile(join(evidence, "checks.json"), JSON.stringify({ bun: Bun.version, results }, null, 2));
  process.exitCode = results.every(result => result.exit === 0) ? 0 : 1;
}
