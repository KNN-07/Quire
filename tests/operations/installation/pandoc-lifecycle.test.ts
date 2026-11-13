import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("installed converter lifecycle boundary scenarios run in an isolated process", async () => {
  const child = Bun.spawn([process.execPath, "test", "--timeout", "30000",
    fileURLToPath(new URL("./pandoc-lifecycle.case.ts", import.meta.url))], {
    env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  expect(code, stdout + stderr).toBe(0);
  expect(stdout + stderr).toContain("4 pass");
}, 45000);

test("installed conversion profile selection scenarios run in an isolated process", async () => {
  const child = Bun.spawn([process.execPath, "test", "--timeout", "30000",
    fileURLToPath(new URL("./pandoc-authority.case.ts", import.meta.url))], {
    env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  expect(code, stdout + stderr).toBe(0);
  expect(stdout + stderr).toContain("2 pass");
}, 45000);
