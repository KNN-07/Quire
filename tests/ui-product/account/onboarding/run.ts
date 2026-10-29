import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../..");
const evidence = resolve(root, "docs/evidence/p34-onboarding");
const label = process.argv[2];
const command = process.argv.slice(3);
if (!label || !/^[a-z0-9-]+$/.test(label) || command.length === 0) throw new Error("Usage: run.ts <label> <command> [args...]");
await mkdir(evidence, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-");
const output = Bun.file(resolve(evidence, `${stamp}-${label}.log`)).writer();
const sources = [
  "apps/web/src/features/account/auth.tsx", "apps/web/src/features/account/starting-point.tsx",
  "apps/web/src/features/account/onboarding-progress.ts", "services/accounts/identity/index.ts",
  "services/accounts/identity/onboarding.ts", "services/accounts/identity/onboarding-migration.ts",
  "packages/contracts/src/accounts.ts", "packages/contracts/src/routes-accounts.ts",
  "tests/accounts/onboarding/persistence.test.ts", "tests/ui-product/account/onboarding/browser.test.ts",
  "tests/ui-product/account/onboarding/providers.test.ts",
  "apps/web/src/features/projects/OperationStatus.tsx", "apps/web/src/features/projects/NewProjectDialog.tsx",
  "tests/ui-editor/shared/application.ts",
  "tests/ui-product/account/onboarding/run.ts", "tests/ui-product/account/onboarding/tsconfig.json",
  "tests/accounts/onboarding/tsconfig.json",
  "services/accounts/identity/onboarding-imports.ts", "tests/accounts/onboarding/imports.test.ts",
  "apps/web/src/features/account/onboarding-import.ts",
  "apps/web/src/features/account/onboarding-return.ts", "tests/ui-product/account/onboarding/billing-return.test.ts",
  "apps/web/src/features/marketing/pricing-selection.ts", "apps/web/src/features/account/billing.tsx",
  "apps/web/src/features/account/OnboardingImportDialog.tsx", "apps/web/src/features/projects/ProjectsPage.tsx",
  "services/adapters/identity/state.ts", "tests/adapters/identity/onboarding-return.test.ts",
  "tests/ui-product/account/onboarding/import-layout.test.ts",
];
async function hashes(phase: string) {
  await output.write(`${phase} ${new Date().toISOString()}\n`);
  for (const path of sources) {
    const file = Bun.file(resolve(root, path));
    if (await file.exists()) await output.write(`${new Bun.CryptoHasher("sha256").update(await file.arrayBuffer()).digest("hex")}  ${path}\n`);
  }
}
await output.write(`COMMAND ${JSON.stringify(command)}\nCWD ${root}\nBUN ${Bun.version}\n`);
await hashes("START");
const child = Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe" });
async function copy(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      await output.write(value);
      await Bun.write(Bun.stdout, value);
    }
  } finally { reader.releaseLock(); }
}
const [exit] = await Promise.all([child.exited, copy(child.stdout), copy(child.stderr)]);
await hashes("END");
await output.write(`EXIT ${exit}\n`);
await output.end();
console.info(`ONBOARDING_CHECK_EXIT ${label} ${exit}`);
if (exit !== 0) throw new Error(`${label} exited ${exit}; raw receipt is ${stamp}-${label}.log`);
