import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = join(tmpdir(), `quire-e2e-${crypto.randomUUID()}`);
const baseURL = process.env["QUIRE_WEB_HOST"] === "::1" ? "http://[::1]:5173" : "http://localhost:5173";
export default defineConfig({
  testDir: "..", testMatch: ["e2e/**/*.spec.ts", "ui-editor/**/*.spec.ts", "ui-product/**/*.spec.ts"], workers: 1,
  use: { baseURL, viewport: { width: 1440, height: 900 } },
  outputDir: "../../docs/evidence/p0-foundation/playwright",
  globalTeardown: "./cleanup.ts",
  metadata: { dataDir },
  webServer: {
    command: "bun run dev", cwd: fileURLToPath(new URL("../..", import.meta.url)),
    url: baseURL, reuseExistingServer: false,
    env: { QUIRE_DATA_DIR: dataDir }, timeout: 30_000,
  },
});
